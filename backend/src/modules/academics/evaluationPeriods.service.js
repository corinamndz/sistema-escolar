const { ApiError } = require('../../utils/ApiError');
const { logAudit } = require('../../services/audit/audit.service');

/**
 * Períodos de evaluación de un año escolar (tabla `terms`, migración 086): cada
 * colegio define cuántos tiene, cómo se llaman y sus fechas. Se guardan juntos:
 * la lista recibida es la configuración final del año, y su orden, la posición
 * de cada período (term_number).
 *
 * Un período con planes de evaluación, sanciones o ajustes de notas no se puede
 * eliminar: borrarlo arrastraría sus planes y notas.
 */

const MAX_TERMS = 12;
const DEFAULT_TERMS = 3;

const ymd = (d) => (d ? String(d).slice(0, 10) : null);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(new Date(`${v}T00:00:00`).getTime());
const norm = (s) => String(s || '').trim().toLowerCase();

/** Períodos del año en orden, con lo que depende de cada uno. */
async function listWithUsage(trx, tenantId, schoolPeriodId) {
  return trx('terms as t')
    .where({ 't.tenant_id': tenantId, 't.school_period_id': schoolPeriodId })
    .orderByRaw('t.term_number NULLS LAST, t.start_date NULLS LAST, t.name')
    .select(
      't.id',
      't.name',
      't.term_number',
      't.start_date',
      't.end_date',
      't.weight_percent',
      't.closed_at',
      trx.raw('(SELECT count(*)::int FROM evaluation_plans p WHERE p.term_id = t.id) AS plan_count'),
      trx.raw('(SELECT count(*)::int FROM student_sanctions s WHERE s.term_id = t.id) AS sanction_count'),
      trx.raw('(SELECT count(*)::int FROM grade_audit_logs l WHERE l.term_id = t.id) AS adjustment_count')
    );
}

async function loadPeriod(trx, tenantId, schoolPeriodId, { lock = false } = {}) {
  const q = trx('school_periods').where({ id: schoolPeriodId, tenant_id: tenantId });
  if (lock) q.forUpdate();
  const period = await q.first('id', 'name', 'start_date', 'end_date', 'closed_at', 'term_average_mode');
  if (!period) throw ApiError.notFound('Año escolar no encontrado.');
  return period;
}

/** Configuración del año para el formulario. */
async function getConfig(trx, tenantId, schoolPeriodId) {
  const period = await loadPeriod(trx, tenantId, schoolPeriodId);
  return {
    school_period: { id: period.id, name: period.name, start_date: ymd(period.start_date), end_date: ymd(period.end_date), closed: Boolean(period.closed_at), weighted: period.term_average_mode === 'weighted' },
    terms: await listWithUsage(trx, tenantId, schoolPeriodId),
    max_terms: MAX_TERMS,
  };
}

/** Reglas de la lista completa. Errores por campo: terms.<i>.name | startDate | endDate. */
function validate(terms, period) {
  const errors = [];
  const fail = (i, field, message) => errors.push({ path: `terms.${i}.${field}`, message });
  const names = new Map();
  terms.forEach((t, i) => {
    const key = norm(t.name);
    if (!key) fail(i, 'name', 'Escribe el nombre.');
    else if (names.has(key)) fail(i, 'name', 'Ya hay un período con ese nombre.');
    names.set(key, i);
    if (!isDate(t.startDate)) fail(i, 'startDate', 'Indica la fecha de inicio.');
    if (!isDate(t.endDate)) fail(i, 'endDate', 'Indica la fecha de fin.');
    if (isDate(t.startDate) && isDate(t.endDate) && t.startDate > t.endDate) fail(i, 'endDate', 'Debe ser posterior al inicio.');
    if (isDate(t.startDate) && ymd(period.start_date) && t.startDate < ymd(period.start_date)) fail(i, 'startDate', `El año escolar empieza el ${ymd(period.start_date)}.`);
    if (isDate(t.endDate) && ymd(period.end_date) && t.endDate > ymd(period.end_date)) fail(i, 'endDate', `El año escolar termina el ${ymd(period.end_date)}.`);
  });
  // Sin solapes: cada día pertenece a un solo período (las sanciones ubican su período por fecha).
  const dated = terms.map((t, i) => ({ ...t, i })).filter((t) => isDate(t.startDate) && isDate(t.endDate) && t.startDate <= t.endDate);
  dated.forEach((a) => {
    const other = dated.find((b) => b.i < a.i && a.startDate <= b.endDate && b.startDate <= a.endDate);
    if (other) fail(a.i, 'startDate', `Se solapa con «${other.name.trim()}».`);
  });
  return errors;
}

/**
 * Guarda la configuración completa del año.
 *   terms [{ id?, name, startDate, endDate }]  (con id: existente; sin id: nuevo)
 * → { terms, warnings }
 */
async function saveConfig(trx, tenantId, userId, schoolPeriodId, { terms }) {
  const period = await loadPeriod(trx, tenantId, schoolPeriodId, { lock: true });
  if (period.closed_at) throw ApiError.conflict(`El año escolar ${period.name} está finalizado: sus períodos ya no se pueden cambiar.`);
  if (!terms.length) throw ApiError.badRequest('El año debe tener al menos un período.', [{ path: 'terms', message: 'Agrega un período.' }]);
  if (terms.length > MAX_TERMS) throw ApiError.badRequest(`Máximo ${MAX_TERMS} períodos por año.`, [{ path: 'terms', message: `Máximo ${MAX_TERMS}.` }]);

  const errors = validate(terms, period);
  if (errors.length) throw ApiError.badRequest('Revisa los períodos marcados.', errors);

  const current = await listWithUsage(trx, tenantId, schoolPeriodId);
  const unknown = terms.find((t) => t.id && !current.some((c) => c.id === t.id));
  if (unknown) throw ApiError.badRequest('Uno de los períodos no pertenece a este año escolar.');

  const removed = current.filter((c) => !terms.some((t) => t.id === c.id));
  const blocked = removed.filter((c) => c.plan_count || c.sanction_count || c.adjustment_count);
  if (blocked.length) {
    const detail = blocked
      .map((c) => {
        const parts = [c.plan_count && `${c.plan_count} plan(es) de evaluación`, c.sanction_count && `${c.sanction_count} sanción(es)`, c.adjustment_count && `${c.adjustment_count} ajuste(s) de notas`].filter(Boolean);
        return `«${c.name}» tiene ${parts.join(', ')}`;
      })
      .join('; ');
    throw ApiError.conflict(`No se puede eliminar: ${detail}. Muévelos o elimínalos primero.`);
  }
  if (removed.length) await trx('terms').whereIn('id', removed.map((c) => c.id)).delete();

  // En dos pasos: nombre y posición son únicos en el año, y un intercambio chocaría a mitad de camino.
  const kept = terms.filter((t) => t.id);
  for (const t of kept) await trx('terms').where({ id: t.id }).update({ term_number: null, name: `~${t.id}` });
  const saved = [];
  for (const [i, t] of terms.entries()) {
    const values = { name: t.name.trim(), term_number: i + 1, start_date: t.startDate, end_date: t.endDate };
    if (t.id) await trx('terms').where({ id: t.id }).update(values);
    else await trx('terms').insert({ ...values, tenant_id: tenantId, school_period_id: schoolPeriodId });
    saved.push(values.name);
  }

  // Avisos: lo guardado es válido, pero conviene revisarlo.
  const warnings = [];
  const after = await listWithUsage(trx, tenantId, schoolPeriodId);
  if (period.term_average_mode === 'weighted') {
    const sum = Math.round(after.reduce((n, t) => n + Number(t.weight_percent || 0), 0) * 100) / 100;
    if (sum !== 100 || after.some((t) => !t.weight_percent)) warnings.push(`El año usa promedio ponderado y los pesos ya no suman 100 % (suman ${sum} %): se calculará con promedio aritmético hasta que los corrijas en la normativa de evaluación.`);
  }
  const { n: outside } = await trx('evaluation_activities as a')
    .join('evaluation_plans as ep', 'ep.id', 'a.evaluation_plan_id')
    .join('terms as t', 't.id', 'ep.term_id')
    .where({ 't.school_period_id': schoolPeriodId })
    .whereNotNull('a.planned_date')
    .andWhere((w) => w.whereRaw('a.planned_date < t.start_date').orWhereRaw('a.planned_date > t.end_date'))
    .count('a.id as n')
    .first();
  if (Number(outside)) warnings.push(`${outside} actividad(es) tienen una fecha estimada fuera de su período: revísalas en sus planes.`);

  await logAudit(trx, {
    tenantId,
    userId,
    action: 'CONFIGURAR_PERIODOS',
    module: 'academics',
    entity: 'school_periods',
    entityId: schoolPeriodId,
    summary: `Configuró ${terms.length} período(s) de evaluación de ${period.name}: ${saved.join(', ')}`.slice(0, 500),
    diff: {
      antes: current.map((c) => ({ name: c.name, start: ymd(c.start_date), end: ymd(c.end_date) })),
      despues: after.map((c) => ({ name: c.name, start: ymd(c.start_date), end: ymd(c.end_date) })),
    },
  });
  return { terms: after, warnings };
}

/**
 * Períodos de un año recién creado: la misma estructura del año más reciente del
 * colegio (nombres y cantidad, sin fechas). El primer año del colegio nace con 3 períodos.
 */
async function seedTerms(trx, tenantId, schoolPeriodId) {
  const previous = await trx('school_periods as sp')
    .where('sp.tenant_id', tenantId)
    .whereNot('sp.id', schoolPeriodId)
    .whereExists(trx('terms as t').whereRaw('t.school_period_id = sp.id'))
    .orderByRaw('sp.start_date DESC NULLS LAST')
    .first('sp.id');
  const names = previous
    ? await trx('terms').where({ tenant_id: tenantId, school_period_id: previous.id }).orderByRaw('term_number NULLS LAST, name').pluck('name')
    : Array.from({ length: DEFAULT_TERMS }, (_, i) => `Lapso ${i + 1}`);
  for (const [i, name] of names.entries()) {
    await trx('terms').insert({ tenant_id: tenantId, school_period_id: schoolPeriodId, name, term_number: i + 1 });
  }
}

module.exports = { MAX_TERMS, getConfig, saveConfig, seedTerms };
