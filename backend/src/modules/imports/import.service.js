const { ApiError } = require('../../utils/ApiError');
const { buildTemplate, readRows } = require('./excel');

const IMPORTERS = Object.fromEntries(
  [
    require('./importers/students.importer'),
    require('./importers/staff.importer'),
    require('./importers/subjects.importer'),
    require('./importers/scores.importer'),
    require('./importers/schoolPeriods.importer'),
    require('./importers/grades.importer'),
    require('./importers/classrooms.importer'),
    require('./importers/sections.importer'),
  ].map((imp) => [imp.type, imp])
);

function getImporter(type) {
  const importer = IMPORTERS[type];
  if (!importer) throw ApiError.notFound('Tipo de importación no soportado.');
  return importer;
}

/** Plantilla .xlsx del tipo pedido (algunas dependen del colegio: grados, plan…). */
async function generateTemplate(trx, tenantId, type, params = {}, actor = {}) {
  const importer = getImporter(type);
  const ctx = await importer.prepare(trx, tenantId, params, actor);
  const buffer = await buildTemplate({ columns: ctx.columns, ...ctx.template });
  return { buffer, fileName: ctx.template.fileName || importer.fileName };
}

/** Mensaje legible para un error al guardar una fila (mismo criterio que el error handler global). */
function rowErrorMessage(err) {
  if (err instanceof ApiError) return err.message;
  if (err.name === 'ZodError') return err.issues.map((i) => i.message).join(' ');
  const raw = err.message || '';
  if (err.code === '23514' && !err.constraint) return raw.slice(raw.lastIndexOf(' - ') + (raw.includes(' - ') ? 3 : 0));
  if (err.code === '23505') return 'Ya existe un registro con esos datos.';
  if (err.code === '23503' || err.code === '23001') return 'El dato está en uso o hace referencia a un dato que no existe.';
  if (err.code === '23514') return 'Los datos no cumplen una regla de validación.';
  // eslint-disable-next-line no-console
  console.error('Error importando fila:', err);
  return 'Error inesperado al guardar esta fila.';
}

const plural = (n, noun) => `${n} ${n === 1 ? noun.one : noun.many}`;

/** "2 fallaron (1 por cédula duplicada, 1 por sección sin cupo)" */
function reasonsSummary(rows) {
  const counts = {};
  rows.forEach((r) => {
    const reason = r.errors.find((e) => e.reason)?.reason || 'datos inválidos';
    counts[reason] = (counts[reason] || 0) + 1;
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `${n} por ${reason}`)
    .join(', ');
}

/**
 * Valida (y, con `commit`, importa) un archivo.
 *
 * 1. Lee y valida TODAS las filas antes de escribir nada: obligatorios,
 *    formatos, duplicados (contra la base y dentro del archivo) y relaciones
 *    (representantes, secciones, alumnos del plan…).
 * 2. En modo commit guarda solo las filas válidas, cada una en su propio
 *    SAVEPOINT: si una falla en la base (ej. alguien llenó la sección en el
 *    medio), se revierte solo esa fila y las demás siguen.
 *
 * Devuelve un reporte por fila + totales + un mensaje de resumen.
 */
async function runImport(trx, tenantId, type, { buffer, originalName, params = {}, commit = false, actor = {} }) {
  const importer = getImporter(type);
  // `actor.permissions`: permisos efectivos del usuario (algunos importadores
  // hacen más si el usuario tiene permisos extra, ej. asignar docentes).
  const ctx = await importer.prepare(trx, tenantId, params, actor);
  const rows = await readRows(buffer, originalName, ctx.columns);
  if (rows.length === 0) {
    throw ApiError.badRequest('El archivo no tiene filas con datos. Completa la hoja "Datos" a partir de la fila 2.');
  }

  const headerOf = Object.fromEntries(ctx.columns.map((c) => [c.key, c.header]));
  const state = {};
  const results = rows.map(({ rowNumber, values }) => {
    state.row = rowNumber;
    const { data, errors, label, skip } = importer.validate(values, ctx, state);
    return {
      row: rowNumber,
      label,
      status: errors.length ? 'invalid' : skip ? 'skipped' : 'valid',
      errors: errors.map((e) => ({ ...e, columnLabel: headerOf[e.column] || null })),
      data,
    };
  });

  let changes = 0;
  if (commit) {
    for (const r of results) {
      if (r.status !== 'valid') continue;
      try {
        const out = await trx.transaction((sp) => importer.insert(sp, tenantId, r.data, ctx));
        r.status = 'imported';
        r.notes = out?.notes || [];
        changes += out?.count ?? 1;
      } catch (err) {
        r.status = 'failed';
        r.errors = [{ column: null, columnLabel: null, reason: 'error al guardar', message: rowErrorMessage(err) }];
      }
    }
  }

  const count = (...statuses) => results.filter((r) => statuses.includes(r.status)).length;
  const summary = {
    total: results.length,
    valid: count('valid', 'imported'),
    imported: count('imported'),
    invalid: count('invalid', 'failed'),
    skipped: count('skipped'),
    changes,
  };

  const bad = results.filter((r) => r.status === 'invalid' || r.status === 'failed');
  const noun = importer.noun;
  let message;
  if (commit) {
    message = summary.imported
      ? `Se ${summary.imported === 1 ? 'importó' : 'importaron'} ${plural(summary.imported, noun)} con éxito`
      : `No se importó ningún ${noun.one}`;
    if (type === 'scores' && summary.imported) message += ` (${changes} nota${changes === 1 ? '' : 's'})`;
    if (bad.length) message += ` y ${bad.length} ${bad.length === 1 ? 'falló' : 'fallaron'} (${reasonsSummary(bad)})`;
    message += '.';
  } else {
    message = `${summary.valid} de ${summary.total} filas están listas para importar`;
    if (bad.length) message += `; ${bad.length} ${bad.length === 1 ? 'tiene' : 'tienen'} errores (${reasonsSummary(bad)})`;
    if (summary.skipped) message += `; ${summary.skipped} sin cambios`;
    message += '.';
  }

  return {
    type,
    label: importer.label,
    committed: commit,
    message,
    summary,
    // `data` es interno (ids, referencias): no viaja al cliente.
    rows: results.map(({ data, ...r }) => r),
  };
}

module.exports = { getImporter, generateTemplate, runImport, IMPORTERS };
