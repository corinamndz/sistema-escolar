const { ApiError } = require('../../utils/ApiError');
const { notify } = require('../notifications/notify');
const { isAdmin } = require('../../middlewares/admin.middleware');
const coordinatorScope = require('../access/coordinatorScope');

/**
 * Materias pendientes (arrastres), migración 090.
 *
 * Nacen al PROMOVER: cada materia reprobada de la boleta congelada abre una
 * pendencia, en paralelo a la matrícula regular del año nuevo. Un profesor
 * asignado define su plan especial (momentos en cantidad libre) y califica:
 *
 *   aprueba un momento  → se registra la nota, la materia queda liberada y los
 *                         momentos siguientes ya no hacen falta;
 *   reprueba un momento → se abre el siguiente; si no quedan, la pendencia queda
 *                         reprobada.
 *
 * Solo se puede calificar el momento abierto, o corregir el último calificado
 * (lo que había queda en grade_history). La boleta del año reprobado no se toca.
 *
 * Acceso por rol, como en períodos y planillas:
 *   Administrador  todo · Coordinador  los alumnos de su nivel
 *   Profesor       solo las materias que tiene asignadas
 */

const MAX_MOMENTS = 12;
const OPEN = ['pending', 'in_progress'];
const num = (v) => (v === null || v === undefined ? null : Number(v));

/** Quién pide: { kind, level, staffId }. 403 si no es Administrador, Coordinador ni docente. */
async function actorOf(req) {
  if (req.carryoverActor) return req.carryoverActor;
  const { db, tenantId, user } = req;
  let actor;
  if (await isAdmin(db, tenantId, user.id)) actor = { kind: 'admin', staffId: null, level: null };
  else {
    const coord = await coordinatorScope.getCoordinatorScope(req);
    if (coord) {
      coordinatorScope.assertHasLevel(coord);
      actor = { kind: 'coordinator', staffId: coord.staffId, level: coord.level };
    } else {
      const staff = await db('staff').where({ tenant_id: tenantId, user_id: user.id, staff_type: 'teaching' }).first('id');
      if (!staff) throw ApiError.forbidden('No tienes acceso a las materias pendientes.');
      actor = { kind: 'teacher', staffId: staff.id, level: null };
    }
  }
  req.carryoverActor = actor;
  return actor;
}

const canManage = (actor, row) => actor.kind === 'admin' || (actor.kind === 'coordinator' && (!row || row.level_code === actor.level));
const canWork = (actor, row) => canManage(actor, row) || (actor.staffId && row.teacher_id === actor.staffId);

/** Pendencias con su alumno, de dónde vienen y dónde cursa ahora. */
function baseQuery(trx, tenantId) {
  return trx('subject_carryovers as c')
    .join('students as s', 's.id', 'c.student_id')
    .join('enrollments as se', 'se.id', 'c.source_enrollment_id')
    .join('sections as ssec', 'ssec.id', 'se.section_id')
    .join('grades as sg', 'sg.id', 'ssec.grade_id')
    .join('school_periods as sp', 'sp.id', 'ssec.school_period_id')
    .leftJoin('enrollments as te', 'te.id', 'c.enrollment_id')
    .leftJoin('sections as tsec', 'tsec.id', 'te.section_id')
    .leftJoin('grades as tg', 'tg.id', 'tsec.grade_id')
    .leftJoin('school_periods as tp', 'tp.id', 'tsec.school_period_id')
    .leftJoin('staff as st', 'st.id', 'c.teacher_id')
    .where('c.tenant_id', tenantId)
    .select(
      'c.*',
      's.first_name',
      's.last_name',
      's.national_id',
      's.status as student_status',
      'sg.name as source_grade_name',
      'sp.name as source_period_name',
      'tg.name as current_grade_name',
      'tsec.name as current_section_name',
      'tp.name as current_period_name',
      trx.raw('COALESCE(tg.level_code, sg.level_code) AS level_code'),
      trx.raw("NULLIF(concat_ws(' ', st.first_name, st.last_name), '') AS teacher_name")
    );
}

/** Añade los momentos a cada pendencia, y normaliza los números. */
async function withMoments(trx, rows) {
  if (!rows.length) return [];
  const moments = await trx('carryover_moments as m')
    .leftJoin('users as u', 'u.id', 'm.graded_by')
    .whereIn('m.carryover_id', rows.map((r) => r.id))
    .orderBy('m.position')
    .select('m.*', 'u.full_name as graded_by_name');
  return rows.map((r) => ({
    ...r,
    source_final_grade: num(r.source_final_grade),
    passing_grade: num(r.passing_grade),
    final_grade: num(r.final_grade),
    moments: moments.filter((m) => m.carryover_id === r.id).map((m) => ({ ...m, grade: num(m.grade) })),
  }));
}

async function loadOne(trx, tenantId, id, { lock = false } = {}) {
  if (lock) await trx('subject_carryovers').where({ id, tenant_id: tenantId }).forUpdate().first('id');
  const row = await baseQuery(trx, tenantId).where('c.id', id).first();
  if (!row) throw ApiError.notFound('Materia pendiente no encontrada.');
  return (await withMoments(trx, [row]))[0];
}

async function loadForWork(req, id, opts) {
  const actor = await actorOf(req);
  const row = await loadOne(req.db, req.tenantId, id, opts);
  // Sin acceso, igual que si no existiera.
  if (!canWork(actor, row)) throw ApiError.notFound('Materia pendiente no encontrada.');
  return { actor, row };
}

async function loadForManage(req, id, opts) {
  const { actor, row } = await loadForWork(req, id, opts);
  if (!canManage(actor, row)) throw ApiError.forbidden('Solo la dirección o la coordinación del nivel pueden hacer esto.');
  return { actor, row };
}

/** Materias reprobadas de alumnos promovidos que aún no tienen su pendencia. */
function candidatesQuery(trx, tenantId) {
  return trx('enrollment_subject_results as r')
    .join('enrollments as e', 'e.id', 'r.enrollment_id')
    .join('students as s', 's.id', 'e.student_id')
    .join('sections as sec', 'sec.id', 'e.section_id')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .join('school_periods as sp', 'sp.id', 'sec.school_period_id')
    .join('enrollments as ne', 'ne.id', 'e.next_enrollment_id')
    .where({ 'r.tenant_id': tenantId, 'r.passed': false, 'e.status': 'promoted', 's.status': 'active' })
    .whereNotExists(trx('subject_carryovers as c').whereRaw('c.source_enrollment_id = r.enrollment_id AND c.subject_key = r.subject_key'));
}

/**
 * GET /carryovers → { can_manage, items, candidates }
 * El profesor ve solo las suyas; el coordinador, las de su nivel.
 */
async function list(req) {
  const actor = await actorOf(req);
  const { db: trx, tenantId } = req;
  const rows = await baseQuery(trx, tenantId)
    .modify((q) => {
      if (actor.kind === 'teacher') q.where('c.teacher_id', actor.staffId);
      if (actor.kind === 'coordinator') {
        q.where((w) => {
          w.whereRaw('COALESCE(tg.level_code, sg.level_code) = ?', [actor.level]);
          if (actor.staffId) w.orWhere('c.teacher_id', actor.staffId);
        });
      }
    })
    .orderBy(['s.last_name', 's.first_name', 'c.subject_name']);
  let candidates = [];
  if (actor.kind !== 'teacher') {
    candidates = await candidatesQuery(trx, tenantId)
      .modify((q) => actor.kind === 'coordinator' && q.where('g.level_code', actor.level))
      .orderBy(['s.last_name', 's.first_name', 'r.subject_name'])
      .select('r.enrollment_id', 'r.subject_name', 'r.final_grade', 's.first_name', 's.last_name', 'g.name as grade_name', 'sp.name as period_name');
  }
  return { can_manage: actor.kind !== 'teacher', items: await withMoments(trx, rows), candidates: candidates.map((c) => ({ ...c, final_grade: num(c.final_grade) })) };
}

/** Profesores que se pueden asignar. */
async function listTeachers(req) {
  await actorOf(req);
  return req.db('staff').where({ tenant_id: req.tenantId, staff_type: 'teaching', status: 'active' }).orderBy(['first_name', 'last_name']).select('id', 'first_name', 'last_name');
}

/**
 * Abre las pendencias de una matrícula promovida, una por materia reprobada de su
 * boleta congelada. No repite las que ya existen. → cuántas abrió.
 */
async function openForEnrollment(trx, tenantId, userId, enrollmentId) {
  const enr = await trx('enrollments').where({ id: enrollmentId, tenant_id: tenantId }).first('id', 'student_id', 'status', 'next_enrollment_id', 'evaluation_rules');
  if (!enr || enr.status !== 'promoted' || !enr.next_enrollment_id) return 0;
  const failed = await trx('enrollment_subject_results').where({ enrollment_id: enr.id, passed: false }).select('subject_key', 'subject_id', 'subject_name', 'final_grade');
  if (!failed.length) return 0;
  const passing = enr.evaluation_rules?.passing_grade ?? 10;
  const inserted = await trx('subject_carryovers')
    .insert(
      failed.map((f) => ({
        tenant_id: tenantId,
        student_id: enr.student_id,
        source_enrollment_id: enr.id,
        enrollment_id: enr.next_enrollment_id,
        subject_key: f.subject_key,
        subject_id: f.subject_id,
        subject_name: f.subject_name,
        source_final_grade: f.final_grade,
        passing_grade: passing,
        created_by: userId,
      }))
    )
    .onConflict(['source_enrollment_id', 'subject_key'])
    .ignore()
    .returning('id');
  return inserted.length;
}

/** POST /carryovers/sync — abre lo que falte (alumnos promovidos antes de existir este módulo). */
async function syncCandidates(req) {
  const actor = await actorOf(req);
  if (actor.kind === 'teacher') throw ApiError.forbidden('Solo la dirección o la coordinación pueden abrir materias pendientes.');
  const ids = await candidatesQuery(req.db, req.tenantId)
    .modify((q) => actor.kind === 'coordinator' && q.where('g.level_code', actor.level))
    .distinct('r.enrollment_id')
    .pluck('r.enrollment_id');
  let opened = 0;
  for (const id of ids) opened += await openForEnrollment(req.db, req.tenantId, req.user.id, id);
  return { opened };
}

/** PUT /carryovers/:id/teacher — asigna (o quita) el profesor. */
async function assignTeacher(req, id, teacherId) {
  const { row } = await loadForManage(req, id, { lock: true });
  if (!OPEN.includes(row.status) && row.status !== 'failed') throw ApiError.conflict('Esta materia pendiente ya está cerrada.');
  if (teacherId) {
    const teacher = await req.db('staff').where({ id: teacherId, tenant_id: req.tenantId, staff_type: 'teaching', status: 'active' }).first('id');
    if (!teacher) throw ApiError.badRequest('Elige un profesor activo.', [{ path: 'teacherId', message: 'Profesor inválido.' }]);
  }
  await req.db('subject_carryovers').where({ id }).update({ teacher_id: teacherId || null, updated_at: req.db.fn.now() });
  return loadOne(req.db, req.tenantId, id);
}

/**
 * PUT /carryovers/:id/plan — diseña el plan especial. `moments` son los momentos
 * AÚN SIN CALIFICAR, en orden: los calificados no se tocan. El primero queda
 * abierto y los demás, bloqueados. Una pendencia reprobada solo se reabre (con
 * momentos nuevos) por decisión de la dirección o la coordinación.
 */
async function savePlan(req, id, moments) {
  const { actor, row } = await loadForWork(req, id, { lock: true });
  const trx = req.db;
  if (!OPEN.includes(row.status) && row.status !== 'failed') throw ApiError.conflict('Esta materia pendiente ya está cerrada: su plan no se puede cambiar.');
  if (row.status === 'failed' && moments.length && !canManage(actor, row)) {
    throw ApiError.forbidden('El alumno ya completó el plan: agregar momentos es decisión de la dirección o la coordinación.');
  }
  const graded = row.moments.filter((m) => ['passed', 'failed'].includes(m.status));
  if (graded.length + moments.length < 1) throw ApiError.badRequest('Define al menos un momento.', [{ path: 'moments', message: 'Requerido.' }]);
  if (graded.length + moments.length > MAX_MOMENTS) throw ApiError.badRequest(`Máximo ${MAX_MOMENTS} momentos por materia.`, [{ path: 'moments', message: 'Demasiados momentos.' }]);

  await trx('carryover_moments').where({ carryover_id: id }).whereNotIn('status', ['passed', 'failed']).delete();
  if (moments.length) {
    await trx('carryover_moments').insert(
      moments.map((m, i) => ({
        tenant_id: req.tenantId,
        carryover_id: id,
        position: graded.length + i + 1,
        name: m.name,
        description: m.description || null,
        scheduled_on: m.scheduledOn || null,
        status: i === 0 ? 'open' : 'locked',
      }))
    );
    await trx('subject_carryovers').where({ id }).update({ status: 'in_progress', final_grade: null, resolved_at: null, updated_at: trx.fn.now() });
  } else {
    // Quitó los momentos que faltaban: el último calificado era reprobado (si no, ya estaría cerrada).
    await trx('subject_carryovers').where({ id }).update({ status: 'failed', final_grade: graded[graded.length - 1].grade, resolved_at: trx.fn.now(), updated_at: trx.fn.now() });
  }
  return loadOne(trx, req.tenantId, id);
}

async function notifyFamilies(trx, tenantId, row, title, body) {
  const guardianIds = await trx('student_guardians').where({ student_id: row.student_id }).pluck('guardian_id');
  await notify(trx, tenantId, {
    event: 'subject_carryover',
    guardianIds,
    title,
    body,
    links: { guardians: `/portal/students/${row.student_id}?tab=grades` },
    linkLabel: 'Ver materias pendientes',
  });
}

/**
 * POST /carryovers/moments/:momentId/grade — el corazón del flujo progresivo.
 * Califica el momento abierto o corrige el último calificado; en una corrección,
 * lo que venía después vuelve a calcularse.
 */
async function gradeMoment(req, momentId, { grade, notes = null }) {
  const trx = req.db;
  const moment = await trx('carryover_moments').where({ id: momentId, tenant_id: req.tenantId }).first('id', 'carryover_id');
  if (!moment) throw ApiError.notFound('Momento no encontrado.');
  const { row } = await loadForWork(req, moment.carryover_id, { lock: true });
  const id = row.id;
  if (!OPEN.includes(row.status) && !['passed', 'failed'].includes(row.status)) {
    throw ApiError.conflict(row.status === 'suspended' ? 'El alumno está retirado: reactívalo para continuar.' : 'Esta materia pendiente está anulada.');
  }
  const target = row.moments.find((m) => m.id === momentId);
  const lastGraded = [...row.moments].reverse().find((m) => ['passed', 'failed'].includes(m.status));
  const correcting = ['passed', 'failed'].includes(target.status);
  if (correcting && lastGraded.id !== target.id) throw ApiError.conflict('Solo se puede corregir el último momento calificado.');
  if (!correcting && target.status !== 'open') throw ApiError.conflict('Este momento aún no está habilitado: el alumno debe presentar antes el anterior.');

  const patch = { grade, notes: notes || null, graded_by: req.user.id, graded_at: trx.fn.now() };
  if (correcting) {
    patch.grade_history = JSON.stringify([...(target.grade_history || []), { grade: target.grade, notes: target.notes, by: target.graded_by_name || null, at: target.graded_at }]);
    // Lo que seguía se recalcula abajo.
    await trx('carryover_moments').where({ carryover_id: id }).where('position', '>', target.position).update({ status: 'locked' });
  }

  const passed = grade >= row.passing_grade;
  await trx('carryover_moments').where({ id: momentId }).update({ ...patch, status: passed ? 'passed' : 'failed' });
  const later = row.moments.filter((m) => m.position > target.position);
  let title;
  let body;
  const who = `${row.first_name} ${row.last_name}`;
  if (passed) {
    if (later.length) await trx('carryover_moments').where({ carryover_id: id }).where('position', '>', target.position).update({ status: 'not_needed' });
    await trx('subject_carryovers').where({ id }).update({ status: 'passed', final_grade: grade, resolved_at: trx.fn.now(), updated_at: trx.fn.now() });
    title = 'Materia pendiente aprobada';
    body = `${who} aprobó ${row.subject_name} en ${target.name}: la materia queda liberada.`;
  } else if (later.length) {
    await trx('carryover_moments').where({ id: later[0].id }).update({ status: 'open' });
    await trx('subject_carryovers').where({ id }).update({ status: 'in_progress', final_grade: null, resolved_at: null, updated_at: trx.fn.now() });
    title = 'Materia pendiente: siguiente momento';
    body = `${who} no aprobó ${row.subject_name} en ${target.name}. Se habilitó ${later[0].name}.`;
  } else {
    await trx('subject_carryovers').where({ id }).update({ status: 'failed', final_grade: grade, resolved_at: trx.fn.now(), updated_at: trx.fn.now() });
    title = 'Materia pendiente no aprobada';
    body = `${who} completó los momentos de ${row.subject_name} sin aprobarla. El colegio indicará cómo continuar.`;
  }
  await notifyFamilies(trx, req.tenantId, row, correcting ? `${title} (nota corregida)` : title, body);
  return loadOne(trx, req.tenantId, id);
}

/** POST /carryovers/:id/cancel — anula una pendencia abierta (error, equivalencia), con motivo. */
async function cancel(req, id, reason) {
  const { row } = await loadForManage(req, id, { lock: true });
  if (!OPEN.includes(row.status) && row.status !== 'failed') throw ApiError.conflict('Esta materia pendiente ya está cerrada.');
  await req.db('subject_carryovers').where({ id }).update({ status: 'cancelled', cancel_reason: reason, resolved_at: req.db.fn.now(), updated_at: req.db.fn.now() });
  return loadOne(req.db, req.tenantId, id);
}

/** Estado de una pendencia que vuelve a estar viva, según lo que lleve su plan. */
function liveStatus(moments) {
  if (moments.some((m) => m.status === 'open')) return { status: 'in_progress', final_grade: null, resolved_at: null };
  const last = moments[moments.length - 1];
  if (last?.status === 'failed') return { status: 'failed', final_grade: last.grade };
  return { status: 'pending', final_grade: null, resolved_at: null };
}

/** POST /carryovers/:id/reinstate — deshace una anulación. */
async function reinstate(req, id) {
  const { row } = await loadForManage(req, id, { lock: true });
  if (row.status !== 'cancelled') throw ApiError.conflict('Esta materia pendiente no está anulada.');
  await req.db('subject_carryovers').where({ id }).update({ ...liveStatus(row.moments), cancel_reason: null, updated_at: req.db.fn.now() });
  return loadOne(req.db, req.tenantId, id);
}

// ---------- Otros módulos ----------

/** Al retirar a un alumno, sus pendencias abiertas quedan en suspenso. */
async function suspendForStudent(trx, tenantId, studentId) {
  return trx('subject_carryovers').where({ tenant_id: tenantId, student_id: studentId }).whereIn('status', OPEN).update({ status: 'suspended', updated_at: trx.fn.now() });
}

/** Al reactivarlo, siguen donde iban. */
async function resumeForStudent(trx, tenantId, studentId) {
  const rows = await trx('subject_carryovers').where({ tenant_id: tenantId, student_id: studentId, status: 'suspended' }).select('id');
  for (const { id } of rows) {
    const moments = await trx('carryover_moments').where({ carryover_id: id }).orderBy('position').select('status', 'grade');
    await trx('subject_carryovers').where({ id }).update({ ...liveStatus(moments), updated_at: trx.fn.now() });
  }
  return rows.length;
}

/** Al deshacer una promoción, sus pendencias se van, salvo que ya tengan notas. */
async function dropForPromotionUndo(trx, tenantId, enrollmentId) {
  const ids = await trx('subject_carryovers').where({ tenant_id: tenantId, source_enrollment_id: enrollmentId }).pluck('id');
  if (!ids.length) return;
  const graded = await trx('carryover_moments').whereIn('carryover_id', ids).whereIn('status', ['passed', 'failed']).first('id');
  if (graded) throw ApiError.conflict('El alumno ya tiene notas en sus materias pendientes: no se puede deshacer la promoción.');
  await trx('subject_carryovers').whereIn('id', ids).delete();
}

/** Portal: las pendencias del alumno, sin datos internos. */
async function listForStudent(trx, tenantId, studentId) {
  const rows = await baseQuery(trx, tenantId).where('c.student_id', studentId).whereNot('c.status', 'cancelled').orderBy('c.subject_name');
  return (await withMoments(trx, rows)).map((c) => ({
    id: c.id,
    subject_name: c.subject_name,
    status: c.status,
    source_grade_name: c.source_grade_name,
    source_period_name: c.source_period_name,
    source_final_grade: c.source_final_grade,
    passing_grade: c.passing_grade,
    final_grade: c.final_grade,
    teacher_name: c.teacher_name,
    moments: c.moments.map((m) => ({ id: m.id, position: m.position, name: m.name, description: m.description, scheduled_on: m.scheduled_on, status: m.status, grade: m.grade, notes: m.notes })),
  }));
}

module.exports = {
  MAX_MOMENTS,
  actorOf,
  list,
  listTeachers,
  openForEnrollment,
  syncCandidates,
  assignTeacher,
  savePlan,
  gradeMoment,
  cancel,
  reinstate,
  suspendForStudent,
  resumeForStudent,
  dropForPromotionUndo,
  listForStudent,
};
