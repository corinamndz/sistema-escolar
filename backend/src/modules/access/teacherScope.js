const { ApiError } = require('../../utils/ApiError');
const { getEffectivePermissions } = require('../../middlewares/permission.middleware');

/**
 * Alcance del DOCENTE: qué secciones y materias le corresponden según la carga
 * docente (teacher_sections / teacher_subject_sections).
 *
 * Un usuario está RESTRINGIDO a su carga si:
 *   - está vinculado a un registro de personal docente (staff.staff_type =
 *     'teaching') o tiene el rol "Docente", y
 *   - NO tiene la acción especial `grading.view_all_sections` (pensada para
 *     coordinadores y dirección: el Administrador la tiene).
 * Para los demás usuarios el alcance es `null` (sin restricción adicional a
 * sus permisos de módulo).
 *
 * Qué cubre la carga docente:
 *   - Docente de aula (Inicial/Primaria, titular o auxiliar): todas las
 *     materias de su sección, salvo las asignadas a un especialista.
 *   - Profesor por materia (Secundaria, o especialista en Primaria): solo esa
 *     materia en esa sección.
 * Un alumno es visible si tiene una inscripción en una sección de su carga.
 */

const TEACHER_ROLE = 'Docente';

/** Alcance del usuario de la petición (se calcula una vez por petición). */
async function getTeacherScope(req) {
  if (req.teacherScope !== undefined) return req.teacherScope;
  const { db, tenantId, user } = req;
  const permissions = req.permissions || (await getEffectivePermissions(db, tenantId, user.id));

  let scope = null;
  if (!permissions.grading?.extra_actions?.view_all_sections) {
    const staff = await db('staff').where({ tenant_id: tenantId, user_id: user.id }).select('id', 'staff_type').first();
    const roleNames = await db('roles as r').join('user_roles as ur', 'ur.role_id', 'r.id').where('ur.user_id', user.id).pluck('r.name');
    const isTeacher = staff?.staff_type === 'teaching' || roleNames.includes(TEACHER_ROLE);
    if (isTeacher) scope = await loadAssignments(db, tenantId, staff?.id || null);
  }
  req.teacherScope = scope;
  return scope;
}

async function loadAssignments(db, tenantId, staffId) {
  const homeroom = staffId ? await db('teacher_sections').where({ tenant_id: tenantId, staff_id: staffId }).pluck('section_id') : [];
  const bySubject = staffId
    ? await db('teacher_subject_sections').where({ tenant_id: tenantId, staff_id: staffId }).select('section_id', 'subject_id')
    : [];
  // Materias de las secciones de aula que dicta OTRO profesor (especialista): no son del docente de aula.
  const specialists = homeroom.length
    ? await db('teacher_subject_sections').where('tenant_id', tenantId).whereIn('section_id', homeroom).whereNot('staff_id', staffId).select('section_id', 'subject_id')
    : [];

  const subjects = new Map();
  bySubject.forEach((a) => subjects.set(a.section_id, (subjects.get(a.section_id) || new Set()).add(a.subject_id)));
  return {
    staffId,
    homeroom: new Set(homeroom),
    subjects,
    specialistTaken: new Set(specialists.map((s) => `${s.section_id}|${s.subject_id}`)),
    sectionIds: [...new Set([...homeroom, ...bySubject.map((a) => a.section_id)])],
  };
}

/** ¿La sección está en la carga del docente? (sin alcance → siempre). */
function coversSection(scope, sectionId) {
  return !scope || scope.sectionIds.includes(sectionId);
}

/** ¿La materia (subjectId; null = área de texto libre de aula) en esa sección es del docente? */
function coversSubject(scope, sectionId, subjectId) {
  if (!scope) return true;
  if (subjectId && scope.subjects.get(sectionId)?.has(subjectId)) return true;
  if (!scope.homeroom.has(sectionId)) return false;
  return !subjectId || !scope.specialistTaken.has(`${sectionId}|${subjectId}`);
}

const notFound = (what) => ApiError.notFound(`${what} no encontrado o no asignado a tu carga docente.`);

/** Limita una consulta de alumnos (alias de la columna id) a los inscritos en la carga del docente. */
function restrictStudents(query, scope, studentIdColumn = 's.id', { activeOnly = true } = {}) {
  if (!scope) return query;
  return query.whereExists(function enrolledInScope() {
    this.from('enrollments as scope_e')
      .whereRaw(`scope_e.student_id = ${studentIdColumn}`)
      .whereIn('scope_e.section_id', scope.sectionIds);
    if (activeOnly) this.andWhere('scope_e.status', 'active');
  });
}

/** 404 si el alumno no tiene ninguna inscripción en una sección de la carga del docente. */
async function assertStudentAccess(req, studentId) {
  const scope = await getTeacherScope(req);
  if (!scope) return;
  const ok = await req.db('enrollments').where({ tenant_id: req.tenantId, student_id: studentId }).whereIn('section_id', scope.sectionIds).first();
  if (!ok) throw notFound('Alumno');
}

/** 404 si la sección no está en la carga del docente. */
async function assertSectionAccess(req, sectionId) {
  const scope = await getTeacherScope(req);
  if (!coversSection(scope, sectionId)) throw notFound('Sección');
}

/** ¿El plan (con sus secciones) tiene al menos una sección donde esa materia es del docente? */
function coversPlan(scope, plan, sectionIds) {
  return !scope || sectionIds.some((sectionId) => coversSubject(scope, sectionId, plan.subject_id));
}

/** 404 si el plan de evaluación no corresponde a la carga del docente. */
async function assertPlanAccess(req, planId) {
  const scope = await getTeacherScope(req);
  if (!scope) return;
  const plan = await req.db('evaluation_plans').where({ id: planId, tenant_id: req.tenantId }).select('id', 'subject_id').first();
  if (!plan) return; // el servicio responde su propio 404
  const sectionIds = await req.db('evaluation_plan_sections').where({ plan_id: planId }).pluck('section_id');
  if (!coversPlan(scope, plan, sectionIds)) throw notFound('Plan de evaluación');
}

/** Igual que assertPlanAccess partiendo de una actividad, un proyecto o una competencia. */
async function assertActivityAccess(req, activityId) {
  const a = await req.db('evaluation_activities').where({ id: activityId, tenant_id: req.tenantId }).select('evaluation_plan_id').first();
  if (a) await assertPlanAccess(req, a.evaluation_plan_id);
}
async function assertProjectAccess(req, projectId) {
  const p = await req.db('pedagogical_projects').where({ id: projectId, tenant_id: req.tenantId }).select('evaluation_plan_id').first();
  if (p) await assertPlanAccess(req, p.evaluation_plan_id);
}
async function assertCompetencyAccess(req, competencyId) {
  const c = await req.db('project_competencies').where({ id: competencyId, tenant_id: req.tenantId }).select('pedagogical_project_id').first();
  if (c) await assertProjectAccess(req, c.pedagogical_project_id);
}

/** Middleware: valida el recurso del parámetro de ruta contra la carga del docente. */
const guardParam = (assertFn, param) => async (req, res, next) => {
  try {
    await assertFn(req, req.params[param]);
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Middleware: módulos vedados al docente (pagos, cierre y promoción). Responde
 * 403 aunque un administrador le haya dado el permiso al rol por error.
 */
async function denyTeachers(req, res, next) {
  try {
    if (await getTeacherScope(req)) {
      throw ApiError.forbidden('Los docentes no tienen acceso a este módulo.');
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  TEACHER_ROLE,
  getTeacherScope,
  coversSection,
  coversSubject,
  coversPlan,
  restrictStudents,
  assertStudentAccess,
  assertSectionAccess,
  assertPlanAccess,
  assertActivityAccess,
  assertProjectAccess,
  assertCompetencyAccess,
  guardParam,
  denyTeachers,
};
