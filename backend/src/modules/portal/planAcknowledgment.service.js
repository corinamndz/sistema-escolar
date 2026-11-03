const crypto = require('crypto');
const { ApiError } = require('../../utils/ApiError');
const grades = require('./grades.service');

/**
 * Constancia de lectura del plan de evaluación (migración 069).
 *
 * La versión de un plan es el SHA-256 de lo que la familia ve: actividades,
 * tipo, ponderación, puntaje, instrumento, estrategia, referencias, criterios e
 * indicadores, la fecha en la sección del alumno y el tema del contenido
 * programático que evalúa cada una. Si el docente cambia algo de eso, la
 * versión cambia y las confirmaciones anteriores quedan "de una versión
 * anterior". No entran los ids (recrear algo idéntico no cambia la versión).
 */
function fingerprint(detail) {
  const activities = detail.activities.map((a) => ({
    title: a.title,
    category: a.category,
    weight: Number(a.weight_percent),
    max: Number(a.max_score),
    instrument: a.instrument || null,
    strategy: a.strategy || null,
    refs: a.content_refs || [],
    criteria: (a.criteria || []).map((c) => ({ title: c.title, indicators: c.indicators.map((i) => [i.description, Number(i.points)]) })),
    date: a.section_dates?.[0]?.applied_on ? String(a.section_dates[0].applied_on).slice(0, 10) : null,
    topic: a.programmatic_content ? [a.programmatic_content.unit, a.programmatic_content.topic] : null,
  }));
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ subject: detail.subject, term: detail.term_number, activities }))
    .digest('hex');
  // Resumen legible de lo que se confirmó (constancia; no se usa para comparar).
  const snapshot = {
    subject: detail.subject,
    term_name: detail.term_name,
    grade_name: detail.grade_name,
    section: detail.section?.name,
    teacher_name: detail.teacher_name,
    total_weight: detail.total_weight,
    activities: activities.map((a) => ({ title: a.title, weight: a.weight, date: a.date, topic: a.topic ? a.topic.join(' · ') : null })),
  };
  return { hash, snapshot };
}

/** 'confirmed' (esta versión) | 'outdated' (confirmó una anterior) | 'pending'. */
function statusOf(latest, currentHash) {
  if (!latest) return 'pending';
  return latest.plan_hash === currentHash ? 'confirmed' : 'outdated';
}

async function guardianOfUser(trx, tenantId, userId) {
  const guardian = await trx('guardians').where({ tenant_id: tenantId, user_id: userId }).first('id', 'first_name', 'last_name');
  if (!guardian) throw ApiError.forbidden('Solo los representantes pueden confirmar la lectura del plan.');
  return guardian;
}

const present = (row) =>
  row ? { acknowledged_at: row.acknowledged_at, ip_address: row.ip_address, plan_hash: row.plan_hash } : null;

/** Estado de confirmación del representante para el plan que está viendo (se agrega al detalle del portal). */
async function stateFor(trx, tenantId, userId, studentId, detail) {
  const guardian = await trx('guardians').where({ tenant_id: tenantId, user_id: userId }).first('id');
  if (!guardian) return null;
  const { hash } = fingerprint(detail);
  const latest = await trx('evaluation_plan_acknowledgments')
    .where({ tenant_id: tenantId, plan_id: detail.id, student_id: studentId, guardian_id: guardian.id })
    .orderBy('acknowledged_at', 'desc')
    .first();
  return { status: statusOf(latest, hash), last: present(latest) };
}

/**
 * El representante confirma "He leído y acepto el plan de evaluación". Se
 * valida igual que al verlo (su alumno, sin bloqueo por deuda, plan publicado)
 * y se guarda la versión que tiene en pantalla. Confirmar dos veces la misma
 * versión no crea otro registro.
 */
async function acknowledge(trx, tenantId, userId, studentId, planId, { ip, userAgent } = {}) {
  const guardian = await guardianOfUser(trx, tenantId, userId);
  const detail = await grades.getStudentPlanDetail(trx, tenantId, studentId, planId);
  const { hash, snapshot } = fingerprint(detail);
  await trx('evaluation_plan_acknowledgments')
    .insert({
      tenant_id: tenantId,
      plan_id: planId,
      student_id: studentId,
      guardian_id: guardian.id,
      user_id: userId,
      ip_address: ip ? String(ip).slice(0, 64) : null,
      user_agent: userAgent ? String(userAgent).slice(0, 300) : null,
      plan_hash: hash,
      snapshot: JSON.stringify(snapshot),
    })
    .onConflict(['plan_id', 'student_id', 'guardian_id', 'plan_hash'])
    .ignore();
  return stateFor(trx, tenantId, userId, studentId, detail);
}

/**
 * Reporte para Dirección y docentes: cada alumno inscrito en las secciones del
 * plan y cada uno de sus representantes, con su estado de confirmación.
 *   confirmed  confirmó la versión vigente (fecha, hora e IP)
 *   outdated   confirmó una versión anterior (el plan cambió después)
 *   pending    aún no confirma
 *   no_access  no tiene acceso al portal (no puede confirmar)
 * `published` = false si las familias todavía no ven el plan (revisión sin aprobar).
 */
async function report(trx, tenantId, planId) {
  const plan = await trx('evaluation_plans as ep')
    .join('terms as t', 't.id', 'ep.term_id')
    .leftJoin('subjects as sub', 'sub.id', 'ep.subject_id')
    .where({ 'ep.id': planId, 'ep.tenant_id': tenantId })
    .first('ep.id', 'ep.review_status', 't.name as term_name', trx.raw('COALESCE(sub.name, ep.subject) AS subject'));
  if (!plan) throw ApiError.notFound('Plan de evaluación no encontrado.');

  const sections = await trx('evaluation_plan_sections as x')
    .join('sections as sec', 'sec.id', 'x.section_id')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .where('x.plan_id', planId)
    .select('sec.id', 'sec.name', 'g.name as grade_name', 'g.grading_scale');

  // Versión vigente por sección (las fechas pueden ser distintas en cada una).
  const versionBySection = new Map();
  let published = true;
  for (const s of sections) {
    try {
      versionBySection.set(s.id, fingerprint(await grades.buildPlanDetail(trx, tenantId, planId, s)).hash);
    } catch (err) {
      if (err.statusCode !== 404) throw err;
      published = false; // sin aprobar (revisión activa): las familias aún no lo ven
    }
  }

  const rows = await trx('enrollments as e')
    .join('students as st', 'st.id', 'e.student_id')
    .join('sections as sec', 'sec.id', 'e.section_id')
    .join('student_guardians as sg', 'sg.student_id', 'st.id')
    .join('guardians as g', 'g.id', 'sg.guardian_id')
    .leftJoin('users as u', 'u.id', 'g.user_id')
    // Inscritos en la sección (también los de años ya cerrados: promovidos, repitientes…), salvo retirados.
    .where({ 'e.tenant_id': tenantId })
    .whereNot('e.status', 'withdrawn')
    .whereIn('e.section_id', sections.map((s) => s.id))
    .select(
      'st.id as student_id',
      trx.raw("st.last_name || ', ' || st.first_name AS student_name"),
      'sec.id as section_id',
      'sec.name as section_name',
      'g.id as guardian_id',
      trx.raw("g.first_name || ' ' || g.last_name AS guardian_name"),
      'g.email as guardian_email',
      'sg.relationship',
      trx.raw("(g.user_id IS NOT NULL AND u.status = 'active') AS has_portal")
    )
    .orderBy([{ column: 'st.last_name' }, { column: 'st.first_name' }, { column: 'g.last_name' }]);

  const acks = await trx('evaluation_plan_acknowledgments')
    .where({ tenant_id: tenantId, plan_id: planId })
    .orderBy('acknowledged_at', 'desc')
    .select('student_id', 'guardian_id', 'acknowledged_at', 'ip_address', 'user_agent', 'plan_hash');
  const latestOf = new Map();
  const countOf = new Map();
  for (const a of acks) {
    const k = `${a.student_id}|${a.guardian_id}`;
    if (!latestOf.has(k)) latestOf.set(k, a);
    countOf.set(k, (countOf.get(k) || 0) + 1);
  }

  const items = rows.map((r) => {
    const k = `${r.student_id}|${r.guardian_id}`;
    const latest = latestOf.get(k) || null;
    const current = versionBySection.get(r.section_id);
    let status = current ? statusOf(latest, current) : latest ? 'outdated' : 'pending';
    if (status === 'pending' && !r.has_portal) status = 'no_access';
    return {
      id: k, // clave de fila (alumno + representante)
      ...r,
      status,
      acknowledged_at: latest?.acknowledged_at || null,
      ip_address: latest?.ip_address || null,
      user_agent: latest?.user_agent || null,
      confirmations: countOf.get(k) || 0,
    };
  });
  const totals = { total: items.length, confirmed: 0, outdated: 0, pending: 0, no_access: 0 };
  items.forEach((i) => (totals[i.status] += 1));
  const students = new Set(items.map((i) => i.student_id));
  const studentsConfirmed = new Set(items.filter((i) => i.status === 'confirmed').map((i) => i.student_id));

  return {
    plan: { id: plan.id, subject: plan.subject, term_name: plan.term_name, sections: sections.map((s) => s.name) },
    published,
    totals: { ...totals, students: students.size, students_confirmed: studentsConfirmed.size },
    items,
  };
}

module.exports = { acknowledge, stateFor, report, fingerprint };
