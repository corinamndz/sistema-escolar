/**
 * Datos de demostración: mensualidades PAGADAS para que la morosidad se vea
 * sana en una presentación (tarjeta «Morosidad del mes» del inicio y módulo Pagos).
 *
 *   node scripts/seed-demo-payments.js                       ensayo: no guarda nada
 *   node scripts/seed-demo-payments.js --aplicar             marca las cuotas como pagadas
 *   node scripts/seed-demo-payments.js --deshacer            ensayo de la vuelta atrás
 *   node scripts/seed-demo-payments.js --deshacer --aplicar  las devuelve EXACTAMENTE como estaban
 *
 * Opciones: --colegio=demo  --anio=2026-2027
 *           --al-dia=85             % del mes en curso que queda pagado (morosidad ≈ el resto)
 *           --al-dia-anteriores=93  % pagado de los meses anteriores del año
 *           --en-revision=2         del mes en curso, cuántas quedan «Reportadas» (para aprobar en vivo)
 *           --sin-recibos           no genera los PDF de recibo
 *
 * Qué hace (solo mensualidades VENCIDAS sin pagar del año, hasta el mes en curso;
 * no toca las ya pagadas, reportadas, pendientes sin vencer, anuladas ni las de
 * pagos agrupados):
 *   - Las marca como pagadas como lo haría la administración: fecha de pago entre
 *     la emisión y el vencimiento (casi siempre a tiempo), método (transferencia,
 *     pago móvil, depósito o efectivo) con referencia bancaria, y el equivalente
 *     en bolívares con la tasa BCV registrada de ESE día (como markAsPaid).
 *   - Genera su recibo PDF (storage/receipts/<id>.pdf) para que «Ver comprobante» funcione.
 *   - Las familias que quedan morosas son las mismas en todos los meses (más
 *     creíble): quien debe noviembre también debe octubre.
 *   - NO envía correos ni avisos a las familias (no usa markAsPaid).
 *
 * Antes de cambiar nada guarda un respaldo de cada cuota en
 * storage/demo-backups/payments-<fecha>.json; --deshacer lo usa para restaurar
 * cada cuota tal cual estaba (solo si nadie la cambió después) y borra los
 * recibos que creó este script.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { db, withTenantTransaction } = require('../src/config/database');
const payments = require('../src/modules/payments/payment.service');

const SEED = 'demo-presentacion-pagos';
const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const has = (flag) => process.argv.includes(`--${flag}`);
const APPLY = has('aplicar');
const UNDO = has('deshacer');
const RECEIPTS = !has('sin-recibos');
const SLUG = arg('colegio', 'demo');
const YEAR = arg('anio', '2026-2027');
const CURRENT_PCT = Number(arg('al-dia', '85'));
const PAST_PCT = Number(arg('al-dia-anteriores', '93'));
const IN_REVIEW = Number(arg('en-revision', '2'));

const BACKUP_DIR = process.env.DEMO_BACKUP_DIR || path.join(__dirname, '..', 'storage', 'demo-backups');
const RECEIPTS_DIR = path.join(__dirname, '..', 'storage', 'receipts');
const COLUMNS = ['status', 'paid_at', 'receipt_url', 'email_sent_at', 'reported_at', 'report_method', 'report_reference', 'report_paid_on', 'report_note', 'ref_currency', 'ref_rate', 'ref_rate_date', 'ref_amount'];

/** Pseudoaleatorio pero fijo: el mismo ensayo da siempre el mismo resultado. */
const hash = (s) => [...String(s)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
const pick = (seed, list) => list[hash(seed) % list.length];
const ymd = (d) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : String(d).slice(0, 10));
const addDays = (s, n) => {
  const d = new Date(`${s}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const METHODS = ['transfer', 'transfer', 'transfer', 'transfer', 'mobile_payment', 'mobile_payment', 'mobile_payment', 'deposit', 'cash'];
const reference = (seed, method) => (method === 'cash' ? null : String(1e7 + (hash(`ref${seed}`) % 9e11)).slice(0, method === 'mobile_payment' ? 8 : 11));
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)} %` : '—');

async function statusByMonth(trx, tenantId, periodId) {
  const { rows } = await trx.raw(
    `SELECT to_char(billing_month, 'YYYY-MM') AS m, (${payments.DISPLAY_STATUS_SQL}) AS st, count(*)::int AS n
       FROM payments p
      WHERE p.tenant_id = ? AND p.school_period_id = ? AND p.kind = 'tuition' AND p.cancelled_at IS NULL
        AND p.billing_month <= date_trunc('month', current_date)
      GROUP BY 1, 2 ORDER BY 1, 2`,
    [tenantId, periodId]
  );
  const months = {};
  rows.forEach((r) => {
    months[r.m] = months[r.m] || {};
    months[r.m][r.st] = r.n;
  });
  return months;
}

function printMonths(title, months) {
  console.log(`\n${title}`);
  Object.entries(months).forEach(([m, s]) => {
    const billed = ['paid', 'pending', 'overdue', 'reported'].reduce((n, k) => n + (s[k] || 0), 0);
    console.log(`  ${m}: ${billed} cuotas · pagadas ${s.paid || 0} · reportadas ${s.reported || 0} · pendientes ${s.pending || 0} · vencidas ${s.overdue || 0}  → morosidad ${pct(s.overdue || 0, billed)}`);
  });
}

async function seed(trx, tenant, period) {
  printMonths('Antes:', await statusByMonth(trx, tenant.id, period.id));

  const rows = await trx('payments as p')
    .where({ 'p.tenant_id': tenant.id, 'p.school_period_id': period.id, 'p.kind': 'tuition' })
    .whereNull('p.cancelled_at')
    .whereRaw("p.billing_month <= date_trunc('month', current_date)")
    .select('p.*', trx.raw(`(${payments.DISPLAY_STATUS_SQL}) AS display_status`))
    .orderBy(['p.billing_month', 'p.id']);
  const { rows: today } = await trx.raw("SELECT to_char(date_trunc('month', current_date), 'YYYY-MM') AS m, current_date::text AS d");
  const currentMonth = today[0].m;
  const todayStr = today[0].d;

  // Quiénes quedan morosos: un orden fijo por alumno. Los últimos de la lista
  // deben el mes en curso; un subconjunto de ellos, también los anteriores.
  const studentRank = new Map([...new Set(rows.map((r) => r.student_id))].sort((a, b) => hash(`${SEED}${a}`) - hash(`${SEED}${b}`)).map((id, i) => [id, i]));

  const changes = [];
  const byMonth = new Map();
  rows.forEach((r) => {
    const m = ymd(r.billing_month).slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(r);
  });

  for (const [m, list] of byMonth) {
    const isCurrent = m === currentMonth;
    const billed = list.filter((r) => ['paid', 'pending', 'overdue', 'reported'].includes(r.display_status)).length;
    const targetPaid = Math.ceil((billed * (isCurrent ? CURRENT_PCT : PAST_PCT)) / 100);
    let needPaid = Math.max(0, targetPaid - list.filter((r) => r.display_status === 'paid').length);
    let needReview = isCurrent ? IN_REVIEW : 0;
    // Candidatas: vencidas, sin pago agrupado. Primero las de los alumnos «buenos pagadores».
    const candidates = list.filter((r) => r.display_status === 'overdue' && !r.batch_id).sort((a, b) => studentRank.get(a.student_id) - studentRank.get(b.student_id));
    for (const r of candidates) {
      const issue = ymd(r.issue_date || r.billing_month);
      const due = ymd(r.due_date);
      if (needPaid > 0) {
        // Pagó entre la emisión y el vencimiento (algunos, 1–3 días tarde), nunca en el futuro.
        const span = Math.max(0, Math.round((new Date(due) - new Date(issue)) / 86400000));
        const late = hash(`late${r.id}`) % 10 === 0 ? 1 + (hash(`l${r.id}`) % 3) : 0;
        let paidOn = addDays(issue, (hash(`d${r.id}`) % (span + 1)) + late);
        if (paidOn > todayStr) paidOn = todayStr;
        const method = pick(`m${r.id}`, METHODS);
        changes.push({ row: r, kind: 'paid', paidOn, method, reference: reference(r.id, method) });
        needPaid -= 1;
      } else if (needReview > 0) {
        const method = pick(`m${r.id}`, ['transfer', 'mobile_payment']);
        changes.push({ row: r, kind: 'reported', paidOn: todayStr, method, reference: reference(r.id, method) });
        needReview -= 1;
      }
    }
  }

  // Tasa BCV de la fecha de pago (la última registrada en o antes de ese día), como markAsPaid.
  const rates = await trx('exchange_rates').where({ tenant_id: tenant.id, base_currency: 'USD', quote_currency: 'VES' }).orderBy('rate_date').select('id', 'rate_date', 'rate');
  const rateOn = (d) => [...rates].reverse().find((x) => ymd(x.rate_date) <= d) || rates[0] || null;

  const now = Date.now();
  for (const c of changes) {
    const r = c.row;
    if (c.kind === 'paid') {
      const rate = r.currency === 'USD' ? rateOn(c.paidOn) : null;
      const at = new Date(`${c.paidOn}T${String(9 + (hash(`h${r.id}`) % 8)).padStart(2, '0')}:${String(hash(`n${r.id}`) % 60).padStart(2, '0')}:00-04:00`);
      c.set = {
        status: 'paid',
        paid_at: at.getTime() > now ? new Date(now - 60000) : at,
        report_method: c.method,
        report_reference: c.reference,
        report_paid_on: c.paidOn,
        ref_currency: rate ? 'VES' : r.currency,
        ref_rate: rate ? rate.rate : null,
        ref_rate_date: rate ? ymd(rate.rate_date) : null,
        ref_amount: rate ? (Math.round(Number(r.amount) * Number(rate.rate) * 100) / 100).toFixed(2) : r.amount,
      };
    } else {
      c.set = { reported_at: new Date(now - (1 + (hash(`r${r.id}`) % 20)) * 3600000), report_method: c.method, report_reference: c.reference, report_paid_on: c.paidOn };
    }
  }

  const paidCount = changes.filter((c) => c.kind === 'paid').length;
  console.log(`\nCambios: ${paidCount} cuota(s) → pagadas · ${changes.length - paidCount} → reportadas (en revisión)`);
  const methods = {};
  changes.filter((c) => c.kind === 'paid').forEach((c) => { methods[c.method] = (methods[c.method] || 0) + 1; });
  console.log('  métodos:', JSON.stringify(methods));
  if (!changes.length) return { changes, backup: null };

  // Aplicar dentro de la transacción y mostrar el resultado (se revierte si es ensayo).
  for (const c of changes) await trx('payments').where({ id: c.row.id, tenant_id: tenant.id }).update(c.set);
  printMonths(APPLY ? 'Después:' : 'Después (ensayo):', await statusByMonth(trx, tenant.id, period.id));

  return {
    changes,
    backup: {
      seed: SEED,
      tenant: SLUG,
      period: period.name,
      created_at: new Date().toISOString(),
      rows: changes.map((c) => ({
        id: c.row.id,
        kind: c.kind,
        before: Object.fromEntries(COLUMNS.map((k) => [k, c.row[k] instanceof Date ? c.row[k].toISOString() : c.row[k]])),
        set: Object.fromEntries(Object.entries(c.set).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])),
        receipt_existed: fs.existsSync(path.join(RECEIPTS_DIR, `${c.row.id}.pdf`)),
      })),
    },
  };
}

async function undo(trx, tenant) {
  const files = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).filter((f) => /^payments-.*\.json$/.test(f)).sort() : [];
  const file = files.pop();
  if (!file) {
    console.log('No hay respaldos de este script: nada que deshacer.');
    return null;
  }
  const backup = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, file), 'utf8'));
  if (backup.tenant !== SLUG) throw new Error(`El respaldo ${file} es del colegio "${backup.tenant}", no de "${SLUG}".`);
  console.log(`Respaldo: ${file} (${backup.rows.length} cuotas, ${backup.created_at})`);
  const period = await trx('school_periods').where({ tenant_id: tenant.id, name: backup.period }).first('id', 'name');
  if (period) printMonths('Antes:', await statusByMonth(trx, tenant.id, period.id));

  let restored = 0;
  const skipped = [];
  const receipts = [];
  for (const b of backup.rows) {
    const cur = await trx('payments').where({ id: b.id, tenant_id: tenant.id }).first();
    // Solo si sigue como la dejó el script (nadie la tocó después).
    const same = cur && (b.kind === 'paid' ? cur.status === 'paid' && cur.report_reference === b.set.report_reference && ymd(cur.report_paid_on) === b.set.report_paid_on : cur.status === 'pending' && cur.reported_at && cur.report_reference === b.set.report_reference);
    if (!same) {
      skipped.push(b.id);
      continue;
    }
    await trx('payments').where({ id: b.id, tenant_id: tenant.id }).update(b.before);
    restored += 1;
    if (b.kind === 'paid' && !b.receipt_existed) receipts.push(path.join(RECEIPTS_DIR, `${b.id}.pdf`));
  }
  console.log(`\nSe restauran ${restored} cuota(s)${skipped.length ? ` · ${skipped.length} se dejan como están porque alguien las cambió después` : ''}.`);
  if (period) printMonths(APPLY ? 'Después:' : 'Después (ensayo):', await statusByMonth(trx, tenant.id, period.id));
  return { file, receipts };
}

async function main() {
  const tenant = await db('tenants').where({ slug: SLUG }).first('id', 'name');
  if (!tenant) throw new Error(`No existe el colegio "${SLUG}".`);
  console.log(`${UNDO ? 'DESHACER' : 'DATOS DE DEMOSTRACIÓN'} · ${tenant.name} · ${APPLY ? 'APLICANDO' : 'ensayo (no se guarda nada)'}`);
  const ROLLBACK = new Error('ensayo');
  let result = null;
  const created = []; // recibos escritos en esta corrida (para limpiarlos si algo falla)
  try {
    await withTenantTransaction(tenant.id, async (trx) => {
      if (UNDO) {
        result = await undo(trx, tenant);
      } else {
        const period = await trx('school_periods').where({ tenant_id: tenant.id, name: YEAR }).first('id', 'name');
        if (!period) throw new Error(`No existe el año escolar "${YEAR}".`);
        result = await seed(trx, tenant, period);
        if (APPLY && result.backup) {
          fs.mkdirSync(BACKUP_DIR, { recursive: true });
          result.backupFile = path.join(BACKUP_DIR, `payments-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
          fs.writeFileSync(result.backupFile, JSON.stringify(result.backup, null, 1));
          if (RECEIPTS) {
            for (const c of result.changes.filter((x) => x.kind === 'paid')) {
              const file = path.join(RECEIPTS_DIR, `${c.row.id}.pdf`);
              const existed = fs.existsSync(file);
              await payments.regenerateReceipt(trx, tenant.id, c.row.id);
              if (!existed) created.push(file);
            }
            console.log(`Recibos PDF generados: ${created.length}`);
          }
        }
      }
      if (!APPLY) throw ROLLBACK;
    });
  } catch (err) {
    if (err !== ROLLBACK) {
      created.forEach((f) => fs.rmSync(f, { force: true }));
      if (result?.backupFile) fs.rmSync(result.backupFile, { force: true });
      throw err;
    }
  }

  if (APPLY && UNDO && result) {
    result.receipts.forEach((f) => fs.rmSync(f, { force: true }));
    fs.renameSync(path.join(BACKUP_DIR, result.file), path.join(BACKUP_DIR, `${result.file}.deshecho`));
    console.log(`Recibos borrados: ${result.receipts.length}. Respaldo marcado como deshecho.`);
  }
  if (APPLY && !UNDO && result?.backupFile) console.log(`Respaldo: ${result.backupFile}`);
  if (!APPLY) console.log(`\nPara ${UNDO ? 'deshacerlo' : 'aplicarlo'} de verdad, agrega --aplicar.`);
  await db.destroy();
}

// Pruebas: require() del script expone seed/undo sin ejecutarlo.
if (require.main === module) {
  main().catch(async (err) => {
    console.error('\nError:', err.message);
    await db.destroy();
    process.exit(1);
  });
}
module.exports = { seed, undo, BACKUP_DIR };
