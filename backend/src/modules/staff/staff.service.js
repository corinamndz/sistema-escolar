const { ApiError } = require('../../utils/ApiError');

async function list(trx, tenantId, { staffType } = {}) {
  const query = trx('staff').where({ tenant_id: tenantId }).orderBy(['last_name', 'first_name']);
  if (staffType) query.andWhere({ staff_type: staffType });
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
  return updated;
}

async function remove(trx, tenantId, id) {
  await getById(trx, tenantId, id);
  const referenced = await trx('sections')
    .where({ tenant_id: tenantId })
    .andWhere((qb) => qb.where('lead_teacher_id', id).orWhere('assistant_teacher_id', id))
    .first();
  if (referenced) {
    throw ApiError.conflict('No se puede eliminar: el personal está asignado como docente de una sección.');
  }
  await trx('staff').where({ id }).delete();
}

module.exports = { list, getById, create, update, remove };
