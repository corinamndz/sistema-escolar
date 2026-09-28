const bcrypt = require('bcryptjs');

const ROLE_TEMPLATES = {
  Administrador: {
    isSystem: true,
    // Acceso total a todo módulo, incluidas las acciones especiales.
    allModules: { can_create: true, can_read: true, can_update: true, can_delete: true },
    extraActionsAllTrue: true,
  },
  Docente: {
    isSystem: true,
    byModule: {
      dashboard: { can_read: true },
      students: { can_read: true },
      academics: { can_read: true },
      evaluation_plans: { can_create: true, can_read: true, can_update: true, can_delete: true },
      grading: { can_read: true, can_update: true },
    },
  },
  Representante: {
    isSystem: true,
    // Solo el panel: el portal de padres (GET /portal/me, GET /payments/mine) filtra
    // por el usuario autenticado y no necesita permisos de módulo. Dar `payments` o
    // `grading` en lectura expondría los pagos y notas de TODO el colegio, porque
    // esos endpoints administrativos no se filtran por representante.
    byModule: {
      dashboard: { can_read: true },
    },
  },
};

/**
 * Crea un tenant de demostración con sus roles base y un usuario
 * administrador, para poder probar el sistema de inmediato tras `npm run
 * migrate && npm run seed`.
 *
 * Este mismo patrón (crear roles base con `is_system: true`) es lo que se
 * debe correr automáticamente cada vez que se da de alta un colegio nuevo
 * desde el módulo de Tenants — ver recomendaciones de fase 2 en la
 * propuesta de arquitectura.
 */
async function seedDemoTenant(db) {
  const existing = await db('tenants').where({ slug: 'demo' }).first();
  if (existing) {
    console.log('[seed] El tenant "demo" ya existe, se omite.');
    return;
  }

  const [tenant] = await db('tenants')
    .insert({ name: 'Colegio Demo', slug: 'demo', status: 'active' })
    .returning('*');

  // Las tablas de negocio tienen RLS (migrations/001_init.sql): si el rol de
  // base de datos usado para sembrar no es superusuario/dueño de las tablas,
  // hay que fijar `app.tenant_id` para poder insertar en ellas.
  await db.raw("SELECT set_config('app.tenant_id', ?, false)", [tenant.id]);

  await db('tenant_settings').insert({
    tenant_id: tenant.id,
    primary_color: '#2563EB',
    secondary_color: '#1E293B',
    contact_email: 'contacto@colegiodemo.edu',
    contact_phone: '+58 212 0000000',
  });

  const modules = await db('modules');
  const roleIdByName = {};

  for (const [roleName, template] of Object.entries(ROLE_TEMPLATES)) {
    const [role] = await db('roles')
      .insert({ tenant_id: tenant.id, name: roleName, is_system: template.isSystem })
      .returning('*');
    roleIdByName[roleName] = role.id;

    for (const mod of modules) {
      const perm = template.allModules || (template.byModule && template.byModule[mod.code]);
      if (!perm) continue;

      const extraActions = {};
      if (template.extraActionsAllTrue) {
        // El Administrador recibe también todas las acciones especiales del módulo.
        const { MODULES } = require('../src/config/modules');
        const def = MODULES.find((m) => m.code === mod.code);
        (def?.extraActions || []).forEach((action) => {
          extraActions[action] = true;
        });
      }

      await db('role_permissions').insert({
        tenant_id: tenant.id,
        role_id: role.id,
        module_id: mod.id,
        can_create: Boolean(perm.can_create),
        can_read: Boolean(perm.can_read),
        can_update: Boolean(perm.can_update),
        can_delete: Boolean(perm.can_delete),
        extra_actions: extraActions,
      });
    }
  }

  const passwordHash = await bcrypt.hash('Admin123!', Number(process.env.BCRYPT_SALT_ROUNDS) || 10);
  const [adminUser] = await db('users')
    .insert({
      tenant_id: tenant.id,
      username: 'admin',
      password_hash: passwordHash,
      full_name: 'Administrador Demo',
    })
    .returning('*');

  await db('user_roles').insert({ user_id: adminUser.id, role_id: roleIdByName.Administrador });

  console.log('[seed] Tenant "demo" creado.');
  console.log('[seed] Login → tenantSlug: demo, username: admin, password: Admin123!');
}

module.exports = { seedDemoTenant };
