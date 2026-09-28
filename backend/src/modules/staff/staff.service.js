const { ApiError } = require('../../utils/ApiError');
const { deactivateStaffUser } = require('./staffAccess.service');

/** Personal con el estado de su usuario de acceso (null = sin usuario). */
async function list(trx, tenantId, { staffType } = {}) {
  const query = trx('staff as s')
    .leftJoin('users as u', 'u.id', 's.user_id')
    .where('s.tenant_id', tenantId)
    .select(
      's.*',
      'u.username as access_username',
      'u.status as access_status',
      'u.last_login_at as access_last_login_at'
    )
    .orderBy(['s.last_name', 's.first_name']);
  if (staffType) query.andWhere('s.staff_type', staffType);
  return query;
}

async function getById(trx, tenantId, id) {
  const staff = await trx('staff').where({ id, tenant_id: tenantId }).first();
  if (!staff) throw ApiError.notFound('Personal no encontrado.');
  return staff;
}

async function create(trx, tenantId, data) {
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
    })
    .returning('*');
  return staff;
}

async function update(trx, tenantId, id, data) {
  await getById(trx, tenantId, id);
  const payload = {
    staff_type: data.staffType,
    first_name: data.firstName,
    last_name: data.lastName,
    national_id: data.nationalId,
    phone: data.phone,
    email: data.email,
    hired_at: data.hiredAt,
    status: data.status,
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

module.exports = { list, getById, create, update, remove };
