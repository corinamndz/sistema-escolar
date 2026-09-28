const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db, withTenantTransaction } = require('../../config/database');
const { ApiError } = require('../../utils/ApiError');
const { invalidatePermissionsCache } = require('../../middlewares/permission.middleware');

const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS) || 10;

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, tenantId: user.tenant_id, username: user.username, roleIds: user.roleIds },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

function signRefreshToken(user) {
  return jwt.sign(
    { sub: user.id, tenantId: user.tenant_id, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' }
  );
}

/**
 * El login es el único flujo que corre ANTES de saber el tenant por JWT: el
 * cliente manda `tenantSlug` (en producción normalmente se resuelve solo,
 * por el subdominio: colegio1.miapp.com). `tenants` no tiene RLS (es el
 * registro raíz de colegios), así que este lookup no necesita transacción
 * con `app.tenant_id` fijado.
 */
async function login({ tenantSlug, username, password }) {
  // Los slugs son minúsculas: "Demo" o " demo " deben encontrar el mismo colegio
  // (igual que el branding público del login).
  const slug = String(tenantSlug || '').trim().toLowerCase();
  const tenant = await db('tenants').where({ slug, status: 'active' }).first();
  if (!tenant) {
    throw ApiError.unauthorized('Colegio no encontrado o inactivo.');
  }

  // Los usuarios del portal (representantes) usan su correo como usuario y se
  // guardan en minúsculas: "Maria@Correo.com" debe poder iniciar sesión igual.
  // Los usuarios que no son correo se comparan tal cual, como siempre.
  const lookup = typeof username === 'string' && username.includes('@') ? username.trim().toLowerCase() : username;

  return withTenantTransaction(tenant.id, async (trx) => {
    const user = await trx('users')
      .where({ tenant_id: tenant.id, username: lookup })
      .first();

    if (!user || user.status !== 'active') {
      throw ApiError.unauthorized('Usuario o contraseña incorrectos.');
    }

    const passwordOk = await bcrypt.compare(password, user.password_hash);
    if (!passwordOk) {
      throw ApiError.unauthorized('Usuario o contraseña incorrectos.');
    }

    const roleRows = await trx('user_roles').where({ user_id: user.id }).select('role_id');
    const roleIds = roleRows.map((r) => r.role_id);

    await trx('users').where({ id: user.id }).update({ last_login_at: trx.fn.now() });

    const enriched = { ...user, roleIds };
    const accessToken = signAccessToken(enriched);
    const refreshToken = signRefreshToken(enriched);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.full_name,
        tenantId: tenant.id,
        tenantName: tenant.name,
        tenantSlug: tenant.slug,
      },
    };
  });
}

async function refresh({ refreshToken }) {
  let payload;
  try {
    payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
  } catch (err) {
    throw ApiError.unauthorized('Refresh token inválido o expirado.');
  }
  if (payload.type !== 'refresh') {
    throw ApiError.unauthorized('Token no es de tipo refresh.');
  }

  return withTenantTransaction(payload.tenantId, async (trx) => {
    const user = await trx('users').where({ id: payload.sub }).first();
    if (!user || user.status !== 'active') {
      throw ApiError.unauthorized('Usuario ya no está activo.');
    }
    const roleRows = await trx('user_roles').where({ user_id: user.id }).select('role_id');
    const accessToken = signAccessToken({ ...user, roleIds: roleRows.map((r) => r.role_id) });
    return { accessToken };
  });
}

/** Crea un usuario dentro del tenant actual (llamado por el módulo de Roles o al dar de alta personal). */
async function createUser(trx, tenantId, { username, password, fullName, roleIds = [] }) {
  const existing = await trx('users').where({ tenant_id: tenantId, username }).first();
  if (existing) {
    throw ApiError.conflict('Ya existe un usuario con ese nombre de usuario en este colegio.');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const [user] = await trx('users')
    .insert({ tenant_id: tenantId, username, password_hash: passwordHash, full_name: fullName })
    .returning(['id', 'username', 'full_name', 'status', 'created_at']);

  if (roleIds.length > 0) {
    await trx('user_roles').insert(roleIds.map((roleId) => ({ user_id: user.id, role_id: roleId })));
  }

  return user;
}

async function changePassword(trx, tenantId, userId, { currentPassword, newPassword }) {
  const user = await trx('users').where({ id: userId, tenant_id: tenantId }).first();
  if (!user) throw ApiError.notFound('Usuario no encontrado.');

  const ok = await bcrypt.compare(currentPassword, user.password_hash);
  if (!ok) throw ApiError.unauthorized('La contraseña actual no es correcta.');

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await trx('users').where({ id: userId }).update({ password_hash: passwordHash });
  invalidatePermissionsCache(tenantId, userId);
}

/**
 * Perfil del usuario autenticado, con la MISMA forma (camelCase) que el
 * `user` del login: el frontend reemplaza el usuario del login por esta
 * respuesta, así que cualquier campo con otro nombre se "pierde" (antes
 * `full_name` hacía que el saludo mostrara el correo en vez del nombre).
 *
 * El nombre no va en el JWT a propósito: el token dura horas y un cambio de
 * nombre no se vería hasta volver a iniciar sesión.
 */
async function getMe(trx, tenantId, userId) {
  const user = await trx('users as u')
    .join('tenants as t', 't.id', 'u.tenant_id')
    .leftJoin('guardians as g', function joinGuardian() {
      this.on('g.user_id', 'u.id').andOn('g.tenant_id', 'u.tenant_id');
    })
    .where({ 'u.id': userId, 'u.tenant_id': tenantId })
    .select(
      'u.id',
      'u.username',
      'u.full_name',
      'u.status',
      'u.last_login_at',
      't.id as tenant_id',
      't.name as tenant_name',
      't.slug as tenant_slug',
      'g.id as guardian_id'
    )
    .first();
  if (!user) throw ApiError.notFound('Usuario no encontrado.');

  const roles = await trx('roles as r')
    .join('user_roles as ur', 'ur.role_id', 'r.id')
    .where('ur.user_id', userId)
    .select('r.id', 'r.name');

  return {
    id: user.id,
    username: user.username,
    fullName: user.full_name,
    status: user.status,
    lastLoginAt: user.last_login_at,
    tenantId: user.tenant_id,
    tenantName: user.tenant_name,
    tenantSlug: user.tenant_slug,
    // Si el usuario es un representante (portal de padres), su id de representante.
    guardianId: user.guardian_id || null,
    roles,
  };
}

module.exports = { login, refresh, createUser, changePassword, getMe };
