/**
 * Aplica migrations/*.sql (en orden) contra la base de datos configurada en
 * .env. Se usa un runner propio en vez de `knex migrate:latest` porque el
 * esquema depende de features de SQL crudo (extensiones, funciones plpgsql,
 * constraint triggers, políticas RLS) que el DSL de Knex no expresa bien.
 *
 * Esquemas por colegio
 * --------------------
 * Los colegios con esquema propio (tenants.schema_name, lo crea el Tenant
 * Manager copiando la estructura de public) tienen sus tablas y su propio
 * schema_migrations. Por eso cada migración se aplica en dos fases:
 *   1. public: la plantilla, las tablas globales (tenants, modules…) y los
 *      colegios que aún no tienen esquema propio;
 *   2. cada esquema de colegio, con `search_path = "<esquema>", public` y
 *      `app.tenant_id` = ese colegio, así los nombres sin esquema
 *      ("ALTER TABLE staff …") se resuelven en el esquema del colegio.
 *
 * Errores
 * -------
 *   - Cada migración corre en SU transacción: si falla, no deja nada a medias.
 *   - Falla en public → se detiene todo: public es la plantilla de los colegios
 *     nuevos y tiene las tablas globales de las que dependen los esquemas.
 *   - Falla en el esquema de un colegio → se registra, se dejan pendientes las
 *     migraciones SIGUIENTES de ese colegio (pueden depender de la que falló) y
 *     se sigue con los demás colegios. La próxima corrida la reintenta.
 *   - Todo queda en public.schema_migration_log y en el resumen final; el
 *     proceso termina con código 1 si algo falló (útil en CI / despliegues).
 *   - Un bloqueo consultivo impide dos corridas simultáneas.
 *
 * Reglas para escribir migraciones (se ejecutan una vez POR ESQUEMA):
 *   - Nunca escribir "public." delante de tablas del colegio.
 *   - Lo que toca tablas globales debe ser idempotente (IF NOT EXISTS,
 *     ON CONFLICT DO NOTHING…): se vuelve a ejecutar en cada esquema.
 *     O bien, si la migración SOLO toca lo global, marcarla con una línea
 *         -- migrate:scope public
 *     y se aplicará únicamente en public.
 *   - Si se insertan datos por colegio a partir de `tenants`, filtrar con
 *     `WHERE t.id IN (SELECT migration_tenant_ids())`: en public devuelve los
 *     colegios sin esquema propio y en un esquema, solo el suyo.
 *
 * Uso:
 *   npm run migrate                              public + todos los colegios
 *   npm run migrate -- --status                  solo muestra lo pendiente (no aplica nada)
 *   npm run migrate -- --schema colegio_a,col_b  public + solo esos esquemas
 *   npm run migrate -- --public-only             solo public
 *   npm run migrate -- --fail-fast               se detiene en el primer error (CI)
 *   npm run migrate -- --baseline 047_x.sql      registra en public, SIN ejecutarlas, las migraciones
 *                                                hasta esa (incluida) y aplica normalmente las siguientes
 *
 * Base con tablas pero sin historial
 * ----------------------------------
 * Si schema_migrations está vacía pero las tablas ya existen (se vació o se
 * restauró sin ella), NO se reintenta desde 001: fallaría ("la relación
 * tenants ya existe") o, peor, repetiría datos y constraints. El runner se
 * detiene y pide --baseline con la última migración que la estructura ya tiene.
 * Variables: MIGRATION_LOCK_TIMEOUT (por defecto 10s) · MIGRATIONS_DIR (pruebas)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const SCHEMA_RE = /^[a-z][a-z0-9_]{0,62}$/;
const ADVISORY_LOCK_KEY = 74_201_001; // fijo: identifica "migraciones del sistema escolar"
const LOCK_TIMEOUT = process.env.MIGRATION_LOCK_TIMEOUT || '10s';

// Colegios a los que aplica una migración de datos según el esquema en curso (ver arriba).
// to_jsonb(t)->>'schema_name': funciona aunque la columna (migración 003 del admin) no exista.
// plpgsql (no sql): la tabla tenants se resuelve al EJECUTARSE, así la función puede
// crearse antes de la 001 en una base nueva y ya existe cuando una migración la usa.
const HELPERS_SQL = `
CREATE OR REPLACE FUNCTION public.migration_tenant_ids() RETURNS SETOF uuid
LANGUAGE plpgsql STABLE AS $fn$
BEGIN
  RETURN QUERY
  SELECT t.id FROM public.tenants t
  WHERE CASE
    WHEN nullif(current_setting('app.tenant_id', true), '') IS NULL THEN to_jsonb(t)->>'schema_name' IS NULL
    ELSE t.id = current_setting('app.tenant_id', true)::uuid
  END;
END
$fn$;`;

// Historial de cada corrida (global: no tiene tenant_id, el Tenant Manager no la copia a los esquemas).
const LOG_SQL = `
CREATE TABLE IF NOT EXISTS public.schema_migration_log (
  id           BIGSERIAL PRIMARY KEY,
  run_id       TEXT NOT NULL,
  schema_name  TEXT NOT NULL,
  filename     TEXT,
  status       TEXT NOT NULL CHECK (status IN ('applied', 'failed', 'skipped')),
  error        TEXT,
  duration_ms  INT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_schema_migration_log_schema ON public.schema_migration_log (schema_name, created_at DESC);`;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { status: false, publicOnly: false, failFast: false, schemas: null, baseline: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--status' || a === '--dry-run') opts.status = true;
    else if (a === '--public-only') opts.publicOnly = true;
    else if (a === '--fail-fast') opts.failFast = true;
    else if (a === '--baseline') {
      opts.baseline = String(argv[(i += 1)] || '').trim();
      if (!opts.baseline.endsWith('.sql')) throw new Error('--baseline necesita el nombre de la última migración ya presente, p. ej. 047_coordinator_role.sql.');
    }
    else if (a === '--schema' || a === '--schemas') {
      opts.schemas = String(argv[(i += 1)] || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!opts.schemas.length) throw new Error('--schema necesita uno o más nombres separados por coma.');
    } else if (a === '--help' || a === '-h') {
      opts.help = true;
    } else {
      throw new Error(`Opción desconocida: ${a}. Usa --help.`);
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Migraciones en disco
// ---------------------------------------------------------------------------

/** [{ file, sql, publicOnly }] en orden. "-- migrate:scope public" = solo public. */
function loadMigrations(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      const publicOnly = /^\s*--\s*migrate:scope\s+public\s*$/im.test(sql);
      return { file, sql, publicOnly };
    });
}

// ---------------------------------------------------------------------------
// Destinos
// ---------------------------------------------------------------------------

/** Esquemas de colegio registrados: { ready: [{ schema, tenantId, slug }], broken: [{ schema, slug, reason }] }. */
async function tenantSchemas(client) {
  const { rows } = await client.query(`
    SELECT to_jsonb(t)->>'schema_name' AS schema, t.id AS "tenantId", t.slug,
           EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname = to_jsonb(t)->>'schema_name') AS exists,
           to_regclass(format('%I.schema_migrations', to_jsonb(t)->>'schema_name')) IS NOT NULL AS tracked
    FROM tenants t
    WHERE to_jsonb(t)->>'schema_name' IS NOT NULL
    ORDER BY t.slug`);

  const ready = [];
  const broken = [];
  for (const r of rows) {
    if (!SCHEMA_RE.test(r.schema) || r.schema === 'public') broken.push({ ...r, reason: 'nombre de esquema inválido' });
    else if (!r.exists) broken.push({ ...r, reason: 'el esquema no existe en la base' });
    else if (!r.tracked) broken.push({ ...r, reason: 'el esquema no tiene schema_migrations (no se sabe qué migraciones tiene)' });
    else ready.push({ schema: r.schema, tenantId: r.tenantId, slug: r.slug });
  }
  return { ready, broken };
}

/** Acota la transacción en curso a un destino (SET LOCAL). */
async function scopeTransaction(client, target) {
  await client.query(`SELECT set_config('lock_timeout', $1, true)`, [LOCK_TIMEOUT]);
  if (target.schema === 'public') {
    await client.query("SELECT set_config('search_path', 'public', true)");
  } else {
    await client.query("SELECT set_config('search_path', format('%I, public', $1::text), true)", [target.schema]);
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [target.tenantId]);
  }
}

async function appliedSet(client, target) {
  const table = target.schema === 'public' ? 'public.schema_migrations' : `"${target.schema}".schema_migrations`;
  const { rows } = await client.query(`SELECT filename FROM ${table}`);
  return new Set(rows.map((r) => r.filename));
}

async function logResult(client, runId, schema, filename, status, error, durationMs) {
  try {
    await client.query(
      'INSERT INTO public.schema_migration_log (run_id, schema_name, filename, status, error, duration_ms) VALUES ($1, $2, $3, $4, $5, $6)',
      [runId, schema, filename, status, error ? String(error).slice(0, 4000) : null, durationMs ?? null]
    );
  } catch (err) {
    console.error(`[log] No se pudo registrar el resultado de ${schema} · ${filename}: ${err.message}`);
  }
}

/** ¿El destino ya tiene las tablas del sistema escolar aunque su historial esté vacío? */
async function hasUntrackedStructure(client, target, done) {
  if (done.size > 0) return false;
  const table = target.schema === 'public' ? 'public.tenants' : `"${target.schema}".users`;
  return (await client.query('SELECT to_regclass($1) IS NOT NULL AS ok', [table])).rows[0].ok;
}

/** --baseline: registra (sin ejecutar) las migraciones de public hasta `upTo`, incluida. */
async function baselinePublic(client, migrations, upTo, runId) {
  const index = migrations.findIndex((m) => m.file === upTo);
  if (index < 0) throw new Error(`--baseline: no existe la migración "${upTo}" en la carpeta de migraciones.`);
  const files = migrations.slice(0, index + 1).map((m) => m.file);
  await client.query('BEGIN');
  try {
    const { rowCount } = await client.query(
      'INSERT INTO public.schema_migrations (filename) SELECT unnest($1::text[]) ON CONFLICT (filename) DO NOTHING',
      [files]
    );
    await client.query('COMMIT');
    console.log(`[baseline] public: ${rowCount} migración(es) registradas sin ejecutar (hasta ${upTo}).`);
    for (const f of files) await logResult(client, runId, 'public', f, 'skipped', 'baseline: registrada sin ejecutar (la estructura ya la tenía)');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
}

/**
 * Aplica las migraciones pendientes de un destino, en orden, cada una en su
 * transacción. Se detiene en la primera que falle (las siguientes pueden
 * depender de ella) y devuelve el resultado en vez de lanzar.
 */
async function migrateTarget(client, target, migrations, runId) {
  const label = target.schema;
  const result = { schema: label, slug: target.slug, applied: [], pending: [], failed: null };
  const done = await appliedSet(client, target);
  const pending = migrations.filter((m) => !done.has(m.file) && (target.schema === 'public' || !m.publicOnly));

  if (pending.length && (await hasUntrackedStructure(client, target, done))) {
    const message =
      target.schema === 'public'
        ? 'schema_migrations está vacía pero las tablas ya existen (la base se vació o se restauró sin su historial). ' +
          'No se reintenta desde 001. Si la estructura está completa hasta cierta migración, regístrala con: ' +
          'npm run migrate -- --baseline <última_migración_presente>.sql'
        : `el esquema ${label} tiene tablas pero su schema_migrations está vacía; revísalo antes de migrarlo.`;
    result.failed = { file: pending[0].file, error: message };
    result.pending = pending.slice(1).map((x) => x.file);
    console.error(`[error] ${label}: ${message}`);
    await logResult(client, runId, label, pending[0].file, 'failed', message);
    return result;
  }

  for (let i = 0; i < pending.length; i += 1) {
    const m = pending[i];
    const started = Date.now();
    await client.query('BEGIN');
    try {
      await scopeTransaction(client, target);
      // schema_migrations sin esquema: la del colegio (o la de public), por search_path.
      await client.query(m.sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [m.file]);
      await client.query('COMMIT');
      const ms = Date.now() - started;
      result.applied.push(m.file);
      console.log(`[apply] ${label} · ${m.file} (${ms} ms)`);
      await logResult(client, runId, label, m.file, 'applied', null, ms);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      const message = err.code === '55P03' ? `bloqueo no disponible en ${LOCK_TIMEOUT} (la app está usando la tabla; reintenta): ${err.message}` : err.message;
      result.failed = { file: m.file, error: message, code: err.code };
      result.pending = pending.slice(i + 1).map((x) => x.file);
      console.error(`[error] ${label} · ${m.file}: ${message}`);
      await logResult(client, runId, label, m.file, 'failed', `${err.code ? `[${err.code}] ` : ''}${message}`, Date.now() - started);
      for (const skipped of result.pending) await logResult(client, runId, label, skipped, 'skipped', `pendiente: falló ${m.file}`);
      break;
    }
  }
  return result;
}

/** Solo informa qué falta en cada destino (--status). */
async function pendingFor(client, target, migrations) {
  const done = await appliedSet(client, target);
  return migrations.filter((m) => !done.has(m.file) && (target.schema === 'public' || !m.publicOnly)).map((m) => m.file);
}

// ---------------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------------

function printSummary(results, broken, runId) {
  console.log(`\nResumen de la corrida ${runId}`);
  const rows = [
    ...results.map((r) => ({
      esquema: r.schema,
      colegio: r.slug || '(plantilla y colegios sin esquema)',
      aplicadas: r.applied.length,
      estado: r.failed ? 'FALLÓ' : 'al día',
      detalle: r.failed ? `${r.failed.file}: ${r.failed.error.slice(0, 120)}${r.pending.length ? ` (+${r.pending.length} pendiente/s)` : ''}` : '',
    })),
    ...broken.map((b) => ({ esquema: b.schema, colegio: b.slug, aplicadas: 0, estado: 'OMITIDO', detalle: b.reason })),
  ];
  console.table(rows);
}

// ---------------------------------------------------------------------------
// Principal
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
    return 0;
  }

  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'school_saas',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  });
  await client.connect();

  const { rows: lock } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [ADVISORY_LOCK_KEY]);
  if (!lock[0].ok) {
    await client.end();
    throw new Error('Ya hay otra corrida de migraciones en curso sobre esta base. Espera a que termine.');
  }

  const runId = new Date().toISOString();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        filename    TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );`);

    const migrations = loadMigrations(process.env.MIGRATIONS_DIR || path.join(__dirname, '..', 'migrations'));
    const publicTarget = { schema: 'public' };

    // --status: solo informar
    if (opts.status) {
      const hasTenants = (await client.query("SELECT to_regclass('public.tenants') IS NOT NULL AS ok")).rows[0].ok;
      const { ready, broken } = hasTenants ? await tenantSchemas(client) : { ready: [], broken: [] };
      const targets = [publicTarget, ...ready.filter((s) => !opts.schemas || opts.schemas.includes(s.schema))];
      const rows = [];
      for (const t of targets) {
        const p = await pendingFor(client, t, migrations);
        rows.push({ esquema: t.schema, colegio: t.slug || '(plantilla)', pendientes: p.length, siguientes: p.slice(0, 3).join(', ') });
      }
      broken.forEach((b) => rows.push({ esquema: b.schema, colegio: b.slug, pendientes: '?', siguientes: `OMITIDO: ${b.reason}` }));
      console.table(rows);
      return 0;
    }

    await client.query(LOG_SQL);

    if (opts.baseline) await baselinePublic(client, migrations, opts.baseline, runId);

    // 1) public. La función auxiliar va ANTES: en una base nueva, la 053 ya la usa
    //    en esta misma corrida (al ser plpgsql, no necesita que tenants exista aún).
    await client.query(HELPERS_SQL);
    const publicResult = await migrateTarget(client, publicTarget, migrations, runId);

    const results = [publicResult];
    if (publicResult.failed) {
      console.error('\n[abortado] Falló public: no se migran los esquemas de colegio (dependen de public y de sus tablas globales).');
      printSummary(results, [], runId);
      return 1;
    }

    // 2) esquema de cada colegio
    let broken = [];
    if (!opts.publicOnly) {
      const found = await tenantSchemas(client);
      broken = found.broken;
      const unknown = (opts.schemas || []).filter((s) => !found.ready.some((r) => r.schema === s) && !found.broken.some((b) => b.schema === s));
      if (unknown.length) console.warn(`[aviso] Esquemas pedidos que no son de ningún colegio: ${unknown.join(', ')}`);
      for (const b of broken) {
        console.error(`[omitido] ${b.schema} (${b.slug}): ${b.reason}`);
        await logResult(client, runId, b.schema, null, 'failed', b.reason);
      }

      const targets = found.ready.filter((s) => !opts.schemas || opts.schemas.includes(s.schema));
      for (const target of targets) {
        const r = await migrateTarget(client, target, migrations, runId);
        results.push(r);
        if (r.failed && opts.failFast) {
          console.error('\n[abortado] --fail-fast: se detiene en el primer error.');
          break;
        }
      }
    }

    printSummary(results, broken, runId);
    const failures = results.filter((r) => r.failed).length + broken.length;
    if (failures) {
      console.error(`\n${failures} destino(s) con errores. Detalle: SELECT * FROM public.schema_migration_log WHERE run_id = '${runId}';`);
      return 1;
    }
    console.log(`Migraciones al día (public${results.length > 1 ? ` + ${results.length - 1} esquema(s) de colegio` : ''}).`);
    return 0;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => {});
    await client.end();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error('Error corriendo migraciones:', err.message);
    process.exitCode = 1;
  });
