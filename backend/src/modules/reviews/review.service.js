const { ApiError } = require('../../utils/ApiError');
const teacherScope = require('../access/teacherScope');
const coordinatorScope = require('../access/coordinatorScope');
const { isAdmin } = require('../../middlewares/admin.middleware');
const { getEffectivePermissions } = require('../../middlewares/permission.middleware');

/**
 * Revisión y aprobación (migración 058) de Planes de evaluación y Contenido
 * programático entre el Docente y quien revisa.
 *
 *   borrador ─enviar─▶ en_revision ─aprobar─▶ aprobado
 *                         └─devolver (con observaciones)─▶ observado ─reenviar─▶ en_revision
 *   Cualquier cambio a algo en_revision o aprobado lo devuelve a borrador (trigger).
 *
 * Quién hace qué (por cada plan o programa):
 *   Revisor   el Coordinador de SU nivel (el del grado de la sección o del programa)
 *             o el Director (Administrador / quien edita roles).
 *   Docente   quien tiene el plan o la materia en su carga (alcance del docente).
 *   Lectura   cualquier otro con acceso a Planes (sin restricción de carga ni nivel).
 * Un coordinador de otro nivel o un docente sin esa carga reciben 404.
 */

const STATUS_LABELS = { borrador: 'Borrador', en_revision: 'En revisión', observado: 'Con observaciones', aprobado: 'Aprobado' };
const ROLE_LABELS = { docente: 'Docente', coordinacion: 'Coordinación', direccion: 'Dirección', sistema: 'Sistema' };
const LEVEL_NAMES = coordinatorScope.LEVEL_LABELS;

// ---------------------------------------------------------------------------
// Objetivo de la revisión: un plan o el programa de una materia en un grado
// ---------------------------------------------------------------------------

async function loadPlanTarget(trx, tenantId, planId) {
  const plan = await trx('evaluation_plans as ep')
    .join('sections as sec', 'sec.id', 'ep.section_id')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .join('terms as t', 't.id', 'ep.term_id')
    .join('staff as st', 'st.id', 'ep.teacher_id')
    .leftJoin('subjects as sub', 'sub.id', 'ep.subject_id')
    .where({ 'ep.id': planId, 'ep.tenant_id': tenantId })
    .select(
      'ep.id',
      'ep.subject_id',
      'ep.teacher_id',
      'ep.review_status as status',
      'ep.submitted_at',
      'ep.submitted_by',
      'ep.reviewed_at',
      'ep.reviewed_by',
      'g.level_code',
      'g.name as grade_name',
      'sec.name as section_name',
      't.name as term_name',
      trx.raw('COALESCE(sub.name, ep.subject) AS subject_name'),
      trx.raw("st.first_name || ' ' || st.last_name AS teacher_name"),
      trx.raw('(SELECT count(*)::int FROM evaluation_activities a WHERE a.evaluation_plan_id = ep.id) AS activity_count'),
      trx.raw('(SELECT COALESCE(sum(a.weight_percent), 0)::float FROM evaluation_activities a WHERE a.evaluation_plan_id = ep.id) AS total_weight')
    )
    .first();
  if (!plan) throw ApiError.notFound('Plan de evaluación no encontrado.');
  const sectionIds = await trx('evaluation_plan_sections').where({ plan_id: planId }).pluck('section_id');
  return {
    type: 'plan',
    key: { planId },
    ...plan,
    sectionIds: sectionIds.length ? sectionIds : [],
    title: `${plan.subject_name} · ${plan.grade_name} ${plan.section_name} · ${plan.term_name}`,
  };
}

async function loadContentTarget(trx, tenantId, gradeId, subjectId) {
  const pair = await trx('grade_subjects as gs')
    .join('grades as g', 'g.id', 'gs.grade_id')
    .join('subjects as s', 's.id', 'gs.subject_id')
    .where({ 'gs.grade_id': gradeId, 'gs.subject_id': subjectId, 'g.tenant_id': tenantId })
    .select('g.level_code', 'g.name as grade_name', 's.name as subject_name')
    .first();
  if (!pair) throw ApiError.notFound('La materia no se dicta en ese grado.');
  const review = await trx('programmatic_content_reviews').where({ tenant_id: tenantId, grade_id: gradeId, subject_id: subjectId }).first();
  const items = await trx('programmatic_content').where({ tenant_id: tenantId, grade_id: gradeId, subject_id: subjectId }).count('* as n').first();
  return {
    type: 'content',
    key: { gradeId, subjectId },
    id: review?.id || null,
    status: review?.status || 'borrador',
    submitted_at: review?.submitted_at || null,
    submitted_by: review?.submitted_by || null,
    reviewed_at: review?.reviewed_at || null,
    reviewed_by: review?.reviewed_by || null,
    level_code: pair.level_code,
    grade_name: pair.grade_name,
    subject_name: pair.subject_name,
    item_count: Number(items.n),
    title: `${pair.subject_name} · ${pair.grade_name}`,
  };
}

// ---------------------------------------------------------------------------
// Papel del usuario frente a ESE plan o programa
// ---------------------------------------------------------------------------

/** 'reviewer' | 'author' | 'viewer' (404 si no puede verlo). */
async function roleFor(req, target) {
  const perms = req.permissions || (await getEffectivePermissions(req.db, req.tenantId, req.user.id));
  if (perms.roles?.can_update || (await isAdmin(req.db, req.tenantId, req.user.id))) return { role: 'reviewer', as: 'direccion' };

  const coord = await coordinatorScope.getCoordinatorScope(req);
  if (coord) {
    coordinatorScope.assertHasLevel(coord);
    if (coord.level !== target.level_code) throw ApiError.notFound(`${target.type === 'plan' ? 'Plan' : 'Contenido'} no encontrado o fuera de tu nivel de coordinación.`);
    return { role: 'reviewer', as: 'coordinacion' };
  }

  const scope = await teacherScope.getTeacherScope(req);
  if (scope) {
    const covers =
      target.type === 'plan'
        ? target.teacher_id === scope.staffId || teacherScope.coversPlan(scope, { subject_id: target.subject_id }, target.sectionIds)
        : (await teacherScope.teachingPairs(req)).has(`${target.key.gradeId}|${target.key.subjectId}`);
    if (!covers) throw ApiError.notFound(`${target.type === 'plan' ? 'Plan' : 'Contenido'} no encontrado o fuera de tu carga docente.`);
    return { role: 'author', as: 'docente' };
  }
  return { role: 'viewer', as: null };
}

const canDo = (role, status) => ({
  submit: role === 'author' && ['borrador', 'observado'].includes(status),
  review: role === 'reviewer' && status === 'en_revision',
  comment: role === 'author' || role === 'reviewer',
});

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

async function commentsOf(trx, target) {
  if (target.type === 'content' && !target.id) return [];
  return trx('review_comments')
    .where(target.type === 'plan' ? { plan_id: target.id } : { content_review_id: target.id })
    .orderBy('created_at')
    .select('id', 'user_id', 'author_name', 'author_role', 'kind', 'body', 'created_at')
    .then((rows) => rows.map((c) => ({ ...c, author_role_label: ROLE_LABELS[c.author_role] || null })));
}

async function nameOf(trx, userId) {
  if (!userId) return null;
  const u = await trx('users').where({ id: userId }).first('full_name', 'username');
  return u?.full_name || u?.username || null;
}

async function present(req, target, role) {
  const can = canDo(role.role, target.status);
  return {
    type: target.type,
    ...target.key,
    title: target.title,
    level_code: target.level_code,
    level_name: LEVEL_NAMES[target.level_code] || null,
    teacher_name: target.teacher_name || null,
    status: target.status,
    status_label: STATUS_LABELS[target.status],
    submitted_at: target.submitted_at,
    submitted_by_name: await nameOf(req.db, target.submitted_by),
    reviewed_at: target.reviewed_at,
    reviewed_by_name: await nameOf(req.db, target.reviewed_by),
    my_role: role.role,
    can,
    comments: await commentsOf(req.db, target),
  };
}

const loadTarget = (req, type, key) => (type === 'plan' ? loadPlanTarget(req.db, req.tenantId, key.planId) : loadContentTarget(req.db, req.tenantId, key.gradeId, key.subjectId));

async function getReview(req, type, key) {
  const target = await loadTarget(req, type, key);
  return present(req, target, await roleFor(req, target));
}

// ---------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------

/** Programa: crea su registro de revisión la primera vez que se usa. */
async function ensureContentReview(trx, tenantId, target) {
  if (target.id) return target.id;
  const [row] = await trx('programmatic_content_reviews')
    .insert({ tenant_id: tenantId, grade_id: target.key.gradeId, subject_id: target.key.subjectId })
    .onConflict(['tenant_id', 'grade_id', 'subject_id'])
    .merge({ tenant_id: tenantId })
    .returning('id');
  target.id = row.id;
  return row.id;
}

async function addEntry(req, target, role, { kind, body = null }) {
  const id = target.type === 'plan' ? target.id : await ensureContentReview(req.db, req.tenantId, target);
  await req.db('review_comments').insert({
    tenant_id: req.tenantId,
    ...(target.type === 'plan' ? { plan_id: id } : { content_review_id: id }),
    user_id: req.user.id,
    author_name: await nameOf(req.db, req.user.id),
    author_role: role.as || (role.role === 'author' ? 'docente' : null),
    kind,
    body: body?.trim() || null,
  });
}

async function setStatus(req, target, status, extra) {
  if (target.type === 'plan') {
    await req.db('evaluation_plans').where({ id: target.id }).update({ review_status: status, ...extra });
  } else {
    const id = await ensureContentReview(req.db, req.tenantId, target);
    await req.db('programmatic_content_reviews').where({ id }).update({ status, ...extra });
  }
  target.status = status;
  Object.assign(target, extra);
}

const whatOf = (target) => (target.type === 'plan' ? 'el plan' : 'el contenido');

/** Docente: borrador u observado → en_revision. */
async function submit(req, type, key, { comment } = {}) {
  const target = await loadTarget(req, type, key);
  const role = await roleFor(req, target);
  if (role.role !== 'author') throw ApiError.forbidden('Solo el docente a cargo envía a revisión.');
  if (!canDo(role.role, target.status).submit) throw ApiError.conflict(`No se puede enviar: ${whatOf(target)} está ${STATUS_LABELS[target.status].toLowerCase()}.`);
  if (target.type === 'plan') {
    if (!target.activity_count) throw ApiError.unprocessable('Agrega al menos una actividad antes de enviar el plan a revisión.');
    if (Math.abs(target.total_weight - 100) > 0.01) {
      throw ApiError.unprocessable(`Las actividades deben sumar 100 % para enviar el plan a revisión (suman ${Number(target.total_weight.toFixed(2))} %).`);
    }
  } else if (!target.item_count) {
    throw ApiError.unprocessable('Agrega al menos una unidad o tema antes de enviar el contenido a revisión.');
  }
  const resend = target.status === 'observado';
  await setStatus(req, target, 'en_revision', { submitted_at: req.db.fn.now(), submitted_by: req.user.id });
  await addEntry(req, target, role, { kind: 'submitted', body: comment || (resend ? 'Reenviado tras ajustar las observaciones.' : null) });
  return getReview(req, type, key);
}

/** Revisor: en_revision → observado (con observaciones obligatorias) o → aprobado. */
async function review(req, type, key, { decision, comment }) {
  const target = await loadTarget(req, type, key);
  const role = await roleFor(req, target);
  if (role.role !== 'reviewer') throw ApiError.forbidden('Solo el coordinador del nivel o el Director revisan.');
  if (target.status !== 'en_revision') throw ApiError.conflict(`${whatOf(target).replace(/^el /, 'El ')} no está en revisión (está ${STATUS_LABELS[target.status].toLowerCase()}).`);
  if (decision === 'observe' && !comment?.trim()) {
    throw ApiError.badRequest('Escribe las observaciones para el docente.', [{ path: 'comment', message: 'Obligatorio al devolver.' }]);
  }
  const status = decision === 'approve' ? 'aprobado' : 'observado';
  await setStatus(req, target, status, { reviewed_at: req.db.fn.now(), reviewed_by: req.user.id });
  await addEntry(req, target, role, { kind: decision === 'approve' ? 'approved' : 'observed', body: comment });
  return getReview(req, type, key);
}

/** Docente o revisor: comentario en el hilo (sin cambiar el estado). */
async function comment(req, type, key, { body }) {
  const target = await loadTarget(req, type, key);
  const role = await roleFor(req, target);
  if (!canDo(role.role, target.status).comment) throw ApiError.forbidden('Solo el docente a cargo y quien revisa pueden comentar.');
  await addEntry(req, target, role, { kind: 'comment', body });
  return getReview(req, type, key);
}

// ---------------------------------------------------------------------------
// Bandeja del revisor: lo que espera revisión en su alcance
// ---------------------------------------------------------------------------

async function inbox(req) {
  const perms = req.permissions || (await getEffectivePermissions(req.db, req.tenantId, req.user.id));
  const director = perms.roles?.can_update || (await isAdmin(req.db, req.tenantId, req.user.id));
  const coord = director ? null : await coordinatorScope.getCoordinatorScope(req);
  if (!director && !coord) return { reviewer: false, items: [] };
  coordinatorScope.assertHasLevel(coord);
  const level = coord?.level || null;

  const plans = await req
    .db('evaluation_plans as ep')
    .join('sections as sec', 'sec.id', 'ep.section_id')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .join('terms as t', 't.id', 'ep.term_id')
    .join('staff as st', 'st.id', 'ep.teacher_id')
    .leftJoin('subjects as sub', 'sub.id', 'ep.subject_id')
    .leftJoin('users as u', 'u.id', 'ep.submitted_by')
    .where({ 'ep.tenant_id': req.tenantId, 'ep.review_status': 'en_revision' })
    .modify((q) => level && q.andWhere('g.level_code', level))
    .select(
      'ep.id as plan_id',
      'ep.submitted_at',
      'g.level_code',
      req.db.raw("COALESCE(sub.name, ep.subject) || ' · ' || g.name || ' ' || sec.name || ' · ' || t.name AS title"),
      req.db.raw("st.first_name || ' ' || st.last_name AS teacher_name"),
      req.db.raw('COALESCE(u.full_name, u.username) AS submitted_by_name')
    )
    .orderBy('ep.submitted_at');
  const contents = await req
    .db('programmatic_content_reviews as r')
    .join('grades as g', 'g.id', 'r.grade_id')
    .join('subjects as s', 's.id', 'r.subject_id')
    .leftJoin('users as u', 'u.id', 'r.submitted_by')
    .where({ 'r.tenant_id': req.tenantId, 'r.status': 'en_revision' })
    .modify((q) => level && q.andWhere('g.level_code', level))
    .select('r.grade_id', 'r.subject_id', 'r.submitted_at', 'g.level_code', req.db.raw("s.name || ' · ' || g.name AS title"), req.db.raw('COALESCE(u.full_name, u.username) AS submitted_by_name'))
    .orderBy('r.submitted_at');

  const items = [
    ...plans.map((p) => ({ type: 'plan', planId: p.plan_id, title: p.title, teacher_name: p.teacher_name, submitted_by_name: p.submitted_by_name, submitted_at: p.submitted_at, level_name: LEVEL_NAMES[p.level_code] })),
    ...contents.map((c) => ({ type: 'content', gradeId: c.grade_id, subjectId: c.subject_id, title: c.title, submitted_by_name: c.submitted_by_name, submitted_at: c.submitted_at, level_name: LEVEL_NAMES[c.level_code] })),
  ].sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at));
  return { reviewer: true, level: level ? { code: level, name: LEVEL_NAMES[level] } : null, items };
}

module.exports = { STATUS_LABELS, getReview, submit, review, comment, inbox };
