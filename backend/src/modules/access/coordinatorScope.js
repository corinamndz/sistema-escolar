const { ApiError } = require('../../utils/ApiError');
const { getEffectivePermissions } = require('../../middlewares/permission.middleware');

/**
 * Alcance del Coordinador (migraciones 047, 056 y 057). Jerarquía: Director
 * (Administrador) > Coordinador > Docente.
 *
 * Un coordinador RESTRINGIDO es un usuario con el rol Coordinador que no puede
 * editar roles (quien edita roles es el Director: sin restricción, aunque
 * también sea coordinador). Su nivel sale de su ficha de personal
 * (staff.coordination_level: initial | primary | secondary).
 *
 * Módulos (permisos del rol, 057): Personal (solo docentes), Contenido
 * programático, Planes de evaluación y Horarios. En todos ve y gestiona SOLO
 * lo de su nivel:
 *   - Secciones del nivel = secciones de grados con level_code = su nivel.
 *   - Docentes del nivel (estricto) = personal docente disponible para ese
 *     nivel, más los de "todos los niveles" que tienen carga (aula, materia o
 *     guía) en una sección de su nivel del período activo. Nunca personal de
 *     otro nivel ni administrativo u obrero.
 * Para planes y contenido se reutiliza el alcance del docente (teacherScope):
 * levelScope() devuelve un objeto de la misma forma que cubre TODAS las
 * secciones y materias del nivel (ver teacherScope.getAccessScope).
 */

const COORDINATOR_ROLE = 'Coordinador';
const LEVEL_LABELS = { initial: 'Inicial', primary: 'Primaria', secondary: 'Secundaria' };

/** { staffId, level, rank } o null si el usuario no es un coordinador restringido. */
async function loadCoordinatorScope(db, tenantId, userId, permissions) {
  const perms = permissions || (await getEffectivePermissions(db, tenantId, userId));
  if (perms.roles?.can_update) return null; // Director: sin restricción
  const roles = await db('roles as r').join('user_roles as ur', 'ur.role_id', 'r.id').where({ 'ur.user_id': userId, 'r.tenant_id': tenantId }).select('r.name', 'r.hierarchy_level');
  const coordinator = roles.find((r) => r.name === COORDINATOR_ROLE);
  if (!coordinator) return null;
  const staff = await db('staff').where({ tenant_id: tenantId, user_id: userId }).first('id', 'coordination_level');
  return { staffId: staff?.id || null, level: staff?.coordination_level || null, rank: coordinator.hierarchy_level ?? 2 };
}

/** Igual, por petición (se calcula una vez). */
async function getCoordinatorScope(req) {
  if (req.coordinatorScope !== undefined) return req.coordinatorScope;
  req.coordinatorScope = await loadCoordinatorScope(req.db, req.tenantId, req.user.id, req.permissions);
  return req.coordinatorScope;
}

/** Sin nivel asignado no puede gestionar nada: lo asigna el Director. */
function assertHasLevel(scope) {
  if (scope && !scope.level) {
    throw ApiError.forbidden('Tu usuario de coordinador no tiene un nivel de coordinación asignado. Pide al Director que lo asigne en Personal.');
  }
}

/** Coordinador con nivel (o null si no es coordinador). Lanza 403 si es coordinador sin nivel. */
async function requireLevel(req) {
  const scope = await getCoordinatorScope(req);
  assertHasLevel(scope);
  return scope;
}

// ---------------------------------------------------------------------------
// Secciones y docentes del nivel
// ---------------------------------------------------------------------------

/** Ids de las secciones del nivel; `activeOnly`: solo años escolares activos y no finalizados. */
async function levelSectionIds(db, tenantId, level, { activeOnly = true, schoolPeriodId = null } = {}) {
  return db('sections as sec')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .join('school_periods as sp', 'sp.id', 'sec.school_period_id')
    .where({ 'sec.tenant_id': tenantId, 'g.level_code': level })
    .modify((q) => {
      if (activeOnly) q.andWhere('sp.is_active', true).whereNull('sp.closed_at');
      if (schoolPeriodId) q.andWhere('sec.school_period_id', schoolPeriodId);
    })
    .pluck('sec.id');
}

/**
 * SQL: el docente `alias.id` tiene carga en una sección del nivel en un año
 * activo (docente de aula, profesor de materia o guía).
 */
function teachesInLevelSql(db, level, alias = 's') {
  const inLevel = `JOIN grades lg ON lg.id = ls.grade_id JOIN school_periods lsp ON lsp.id = ls.school_period_id
                   WHERE lg.level_code = ? AND lsp.is_active AND lsp.closed_at IS NULL`;
  return db.raw(
    `(EXISTS (SELECT 1 FROM teacher_sections lt JOIN sections ls ON ls.id = lt.section_id ${inLevel} AND lt.staff_id = ${alias}.id)
      OR EXISTS (SELECT 1 FROM teacher_subject_sections lt JOIN sections ls ON ls.id = lt.section_id ${inLevel} AND lt.staff_id = ${alias}.id)
      OR EXISTS (SELECT 1 FROM sections ls ${inLevel} AND ls.guide_teacher_id = ${alias}.id))`,
    [level, level, level]
  );
}

/**
 * Limita una consulta de `staff` (alias) a los DOCENTES del nivel: disponibles
 * para ese nivel, o para todos los niveles con carga en él.
 */
function restrictStaffToLevel(query, db, level, alias = 's') {
  return query.andWhere(`${alias}.staff_type`, 'teaching').andWhere((q) =>
    q.where(`${alias}.level_availability`, level).orWhere((w) =>
      w.where((x) => x.where(`${alias}.level_availability`, 'all').orWhereNull(`${alias}.level_availability`)).andWhere(teachesInLevelSql(db, level, alias))
    )
  );
}

/** ¿El empleado es docente del nivel del coordinador? */
async function coversStaffId(db, tenantId, scope, staffId) {
  if (!scope) return true;
  const row = await restrictStaffToLevel(db('staff as s').where({ 's.id': staffId, 's.tenant_id': tenantId }), db, scope.level).first('s.id');
  return Boolean(row);
}

/** 404 (no revela que existe) si el empleado no es un docente de su nivel. */
async function assertStaffAccess(req, staffId) {
  const scope = await requireLevel(req);
  if (!scope) return;
  if (!(await coversStaffId(req.db, req.tenantId, scope, staffId))) {
    throw ApiError.notFound('Personal no encontrado o fuera de tu nivel de coordinación.');
  }
}

/** Middleware: valida `req.params[param]` contra el alcance del coordinador. */
const guardStaff = (param = 'id') => async (req, res, next) => {
  try {
    await assertStaffAccess(req, req.params[param]);
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Alcance con la MISMA forma que el del docente (teacherScope.loadAssignments),
 * pero cubriendo todas las secciones del nivel en años activos y todas sus
 * materias: así planes de evaluación y contenido programático filtran al
 * coordinador con las mismas comprobaciones que al docente.
 */
async function levelScope(req) {
  const scope = await requireLevel(req);
  if (!scope) return null;
  const sectionIds = await levelSectionIds(req.db, req.tenantId, scope.level);
  return {
    kind: 'coordinator',
    level: scope.level,
    staffId: null,
    homeroom: new Set(sectionIds), // "docente de aula" de todo el nivel: cubre todas sus materias
    subjects: new Map(),
    specialistTaken: new Set(),
    guided: new Set(),
    sectionIds,
  };
}

module.exports = {
  COORDINATOR_ROLE,
  LEVEL_LABELS,
  loadCoordinatorScope,
  getCoordinatorScope,
  assertHasLevel,
  requireLevel,
  levelSectionIds,
  teachesInLevelSql,
  restrictStaffToLevel,
  coversStaffId,
  assertStaffAccess,
  guardStaff,
  levelScope,
};
