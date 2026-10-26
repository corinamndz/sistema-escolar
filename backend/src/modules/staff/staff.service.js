const { ApiError } = require('../../utils/ApiError');
const { deactivateStaffUser } = require('./staffAccess.service');
const { restrictStaffToLevel } = require('../access/coordinatorScope');

/** Etiquetas de staff.level_availability (migración 046). */
const LEVEL_AVAILABILITY_LABELS = { initial: 'Inicial', primary: 'Primaria', secondary: 'Secundaria', all: 'Todos los niveles' };

/**
 * ¿Existe staff.level_availability (migración 046)? Mientras no, el personal
 * se guarda sin ella y todos los docentes cuentan como disponibles en todo.
 */
let levelColumnReady = false;
async function hasLevelColumn(trx) {
  if (levelColumnReady) return true;
  // La tabla que resuelve el search_path (esquema del colegio o public), no cualquier "staff" de la base.
  const { rows } = await trx.raw("SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('staff') AND attname = 'level_availability' AND NOT attisdropped) AS ok");
  levelColumnReady = rows[0].ok;
  return levelColumnReady;
}

/** ¿Puede el docente trabajar en ese nivel? (sin la columna, o 'all': sí). */
const availableFor = (staff, levelCode) => !staff?.level_availability || staff.level_availability === 'all' || staff.level_availability === levelCode;

/** Personal con el estado de su usuario de acceso (null = sin usuario). */
async function list(trx, tenantId, { staffType, coordinator = null } = {}) {
  const query = trx('staff as s')
    .leftJoin('users as u', 'u.id', 's.user_id')
    .where('s.tenant_id', tenantId)
    .select(
      's.*',
      'u.username as access_username',
      'u.status as access_status',
      'u.last_login_at as access_last_login_at'
    )
    .orderBy(['s.first_name', 's.last_name']); // orden alfabético por el nombre que se muestra (Nombre Apellido)
  if (staffType) query.andWhere('s.staff_type', staffType);
  // Coordinador: SOLO los docentes de su nivel (disponibles para él, o "todos los niveles" con carga en él).
  if (coordinator) restrictStaffToLevel(query, trx, coordinator.level, 's');
  return query;
}

async function getById(trx, tenantId, id) {
  const staff = await trx('staff').where({ id, tenant_id: tenantId }).first();
  if (!staff) throw ApiError.notFound('Personal no encontrado.');
  return staff;
}

/**
 * Tipo "Coordinador" (migración 048): exige su etapa (initial | primary | secondary).
 * Los demás tipos no la llevan (salvo un docente con el rol Coordinador, que la
 * recibe al asignarle el rol en su acceso).
 */
const COORDINATION_LEVELS = { initial: 'Inicial', primary: 'Primaria', secondary: 'Secundaria' };
function assertCoordinationLevel(staffType, level) {
  if (staffType === 'coordinator' && !COORDINATION_LEVELS[level]) {
    throw ApiError.badRequest('Indica el nivel de coordinación (Inicial, Primaria o Secundaria).', [{ path: 'coordinationLevel', message: 'Obligatorio para un coordinador.' }]);
  }
}

async function create(trx, tenantId, data) {
  assertCoordinationLevel(data.staffType, data.coordinationLevel);
  const [staff] = await trx('staff')
    .insert({
      tenant_id: tenantId,
      user_id: data.userId || null,
      staff_type: data.staffType,
      first_name: data.firstName,
      last_name: data.lastName,
      national_id: data.nationalId,
      phone: data.phone,
      email: data.email,
      hired_at: data.hiredAt,
      coordination_level: data.staffType === 'coordinator' ? data.coordinationLevel : null,
      // Solo el personal docente se asigna a secciones; el resto queda en "todos" (no se usa).
      ...((await hasLevelColumn(trx)) ? { level_availability: data.staffType === 'teaching' ? data.levelAvailability || 'all' : 'all' } : {}),
    })
    .returning('*');
  return staff;
}

async function update(trx, tenantId, id, data) {
  const current = await getById(trx, tenantId, id);
  const nextType = data.staffType ?? current.staff_type;
  const nextLevel = data.coordinationLevel !== undefined ? data.coordinationLevel : current.coordination_level;
  assertCoordinationLevel(nextType, nextLevel);
  let coordinationLevel;
  if (nextType === 'coordinator') coordinationLevel = nextLevel;
  else if (current.staff_type === 'coordinator') coordinationLevel = (await hasCoordinatorRole(trx, current.user_id)) ? current.coordination_level : null;
  const payload = {
    staff_type: data.staffType,
    first_name: data.firstName,
    last_name: data.lastName,
    national_id: data.nationalId,
    phone: data.phone,
    email: data.email,
    hired_at: data.hiredAt,
    status: data.status,
    coordination_level: coordinationLevel,
    level_availability: (await hasLevelColumn(trx)) ? data.levelAvailability : undefined,
  };
  Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);

  const [updated] = await trx('staff').where({ id }).update(payload).returning('*');
  // Un empleado inactivo no debe seguir entrando al sistema.
  if (data.status === 'inactive') await deactivateStaffUser(trx, tenantId, updated);
  // Mantener el nombre del usuario sincronizado con el del empleado.
  if (updated.user_id && (data.firstName || data.lastName)) {
    await trx('users').where({ id: updated.user_id }).update({ full_name: `${updated.first_name} ${updated.last_name}` });
  }
  return updated;
}

/** ¿Su usuario tiene el rol Coordinador? (entonces conserva su etapa aunque cambie de tipo). */
async function hasCoordinatorRole(trx, userId) {
  if (!userId) return false;
  const row = await trx('user_roles as ur').join('roles as r', 'r.id', 'ur.role_id').where({ 'ur.user_id': userId, 'r.name': 'Coordinador' }).first('r.id');
  return Boolean(row);
}

async function remove(trx, tenantId, id) {
  const staff = await getById(trx, tenantId, id);
  // En secuencia: la transacción usa una sola conexión y pg no admite consultas concurrentes en ella.
  const homeroom = await trx('teacher_sections').where({ tenant_id: tenantId, staff_id: id }).count('id as n').first();
  const subjects = await trx('teacher_subject_sections').where({ tenant_id: tenantId, staff_id: id }).count('id as n').first();
  const plans = await trx('evaluation_plans').where({ tenant_id: tenantId, teacher_id: id }).count('id as n').first();
  const assignments = Number(homeroom.n) + Number(subjects.n);
  if (assignments > 0) {
    throw ApiError.conflict(
      `No se puede eliminar: tiene ${assignments} asignación(es) docente(s). Reasígnalas desde "Asignación docente" o márcalo como inactivo.`
    );
  }
  if (Number(plans.n) > 0) {
    throw ApiError.conflict(`No se puede eliminar: es responsable de ${plans.n} plan(es) de evaluación. Márcalo como inactivo.`);
  }
  await trx('staff').where({ id }).delete();
  // Su usuario se conserva (auditoría) pero ya no puede iniciar sesión.
  await deactivateStaffUser(trx, tenantId, staff);
}

module.exports = { COORDINATION_LEVELS, list, getById, create, update, remove, hasLevelColumn, availableFor, LEVEL_AVAILABILITY_LABELS };
