# Frontend — Sistema SaaS Multi-tenant de Gestión Escolar

React + Vite, sin dependencia de un framework de UI (CSS propio con variables de tema por tenant). Layout con sidebar colapsable y responsivo (drawer en móvil). RBAC en la UI: los botones de crear/editar/eliminar solo aparecen si el usuario tiene el permiso correspondiente (el backend igual los valida de nuevo).

## Requisitos

- Node.js >= 18
- El backend corriendo en `http://localhost:4000` (ver `../backend/README.md`)

## Puesta en marcha

```bash
cp .env.example .env   # déjalo vacío para usar el proxy de Vite hacia el backend
npm install
npm run dev             # http://localhost:5173
```

Inicia sesión con:

```
Colegio: demo
Usuario: admin
Contraseña: Admin123!
```

## Estructura

```
src/
├─ api/                  # axiosClient (con refresh automático de token) + un archivo por módulo
├─ app/                  # App.jsx (rutas), ProtectedRoute, PermissionRoute
├─ components/
│  ├─ layout/             # AppLayout, Sidebar (colapsable + drawer móvil), Topbar
│  └─ ui/                 # Button, Input, Select, Table, Modal, Card, Badge, Tabs, Alert…
├─ context/               # AuthContext (sesión + permisos), TenantContext (config del colegio)
├─ theme/                 # ThemeProvider: inyecta los colores del tenant como CSS vars
├─ hooks/                 # useFetch, useMutation (loading/error genéricos)
└─ features/              # un folder por módulo: auth, dashboard, tenant, roles, staff,
                           # students, academics, evaluation-plans, grading, payments
```

## Cómo se conecta con el backend

- `src/api/axiosClient.js` agrega el `Authorization: Bearer <token>` a cada request y, si el
  backend responde 401, intenta refrescar el token una vez antes de forzar logout.
- `AuthContext` guarda el usuario y sus **permisos efectivos** (`GET /auth/me`); el hook
  `can('modulo', 'accion')` decide qué se muestra en el Sidebar y qué botones aparecen en cada
  página.
- `TenantContext` + `ThemeProvider` traen `GET /tenant/settings` y pintan el sidebar/botones con
  los colores del colegio.

## Módulos incluidos

Login · Dashboard · Configuración del colegio (con vista previa) · Roles y matriz de permisos ·
Personal · Alumnos y Representantes (con asociación) · Estructura académica (años, aulas, grados,
secciones con control de cupo, inscripciones) · Planes de evaluación (lapsos, actividades con
barra de progreso del 100%, proyecto pedagógico y competencias) · Calificaciones (grid editable
con acumulado automático, evaluación cualitativa) · Pagos (registro, marcar como pagado con envío
de comprobante por correo, vista "Mis pagos" para representantes).
