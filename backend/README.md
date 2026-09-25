# Backend — Sistema SaaS Multi-tenant de Gestión Escolar

Node.js + Express + PostgreSQL. Arquitectura por capas (`routes → controllers → services → models` vía Knex), multi-tenant por `tenant_id` + Row Level Security, RBAC dinámico por rol/módulo/acción.

## Requisitos

- Node.js >= 18
- PostgreSQL >= 13

## Puesta en marcha

```bash
cp .env.example .env
# edita .env con tus credenciales de PostgreSQL y SMTP

npm install
npm run migrate   # crea todas las tablas, triggers y políticas RLS (migrations/001_init.sql)
npm run seed      # crea el tenant "demo", sus roles base y el usuario admin
npm run dev       # http://localhost:4000
```

Al terminar el seed verás en consola las credenciales de prueba:

```
tenantSlug: demo
username:   admin
password:   Admin123!
```

## Probar el login

```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"tenantSlug":"demo","username":"admin","password":"Admin123!"}'
```

La respuesta trae `accessToken` — úsalo como `Authorization: Bearer <token>` en el resto de los endpoints (ver `src/routes/index.js` para el listado completo, agrupado por módulo).

## Cómo funciona el multi-tenant

1. `auth.middleware.js` decodifica el JWT y expone `req.user.tenantId`.
2. `tenant.middleware.js` abre una transacción de Postgres por request y hace `SET LOCAL app.tenant_id = '<uuid>'`.
3. Las políticas RLS de `migrations/001_init.sql` filtran automáticamente cualquier `SELECT/INSERT/UPDATE/DELETE` por ese `tenant_id`, aunque un service tenga un bug y olvide el `.where({tenant_id})`.
4. `permission.middleware.js` (`requirePermission('modulo', 'accion')`) valida contra la matriz `role_permissions` antes de dejar pasar el request al controller.

## Módulos incluidos

- **auth** — login, refresh, alta de usuarios, cambio de contraseña.
- **tenants** — configuración del colegio (nombre, logo, colores, contacto).
- **roles** — CRUD de roles + matriz de permisos por módulo.
- **staff** — personal administrativo/docente/obrero.
- **students** — alumnos, representantes y su asociación.
- **academics** — años escolares, aulas, grados, secciones, inscripciones (con control de cupo).
- **evaluation-plans** — lapsos, planes de evaluación, proyectos pedagógicos, competencias y actividades (**valida que la suma de porcentajes no pase de 100%**).
- **grading** — carga de notas por actividad (con acumulado automático) y evaluación cualitativa de competencias.
- **payments** — registro de pagos y, al marcarlos como pagados, generación de PDF + envío de correo con el comprobante.
