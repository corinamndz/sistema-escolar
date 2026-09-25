-- =====================================================================
-- Sistema SaaS Multi-tenant de Gestión Escolar
-- Migración inicial: esquema relacional completo (PostgreSQL >= 13)
-- Estrategia de aislamiento: esquema compartido + columna tenant_id en
-- toda tabla de negocio, reforzado con Row Level Security (RLS).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()

-- =====================================================================
-- 1. TENANTS (Colegios) y configuración
-- =====================================================================

CREATE TABLE tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(150) NOT NULL,
  slug        VARCHAR(60) UNIQUE NOT NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'suspended', 'trial')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tenant_settings (
  tenant_id       UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  logo_url        TEXT,
  primary_color   VARCHAR(7)  NOT NULL DEFAULT '#2563EB',
  secondary_color VARCHAR(7)  NOT NULL DEFAULT '#1E293B',
  contact_phone   VARCHAR(30),
  contact_email   VARCHAR(150),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- 2. USUARIOS, ROLES Y PERMISOS (RBAC dinámico por tenant)
-- =====================================================================

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  username      VARCHAR(60) NOT NULL,
  password_hash TEXT NOT NULL,
  full_name     VARCHAR(150) NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'inactive', 'locked')),
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, username)
);

CREATE TABLE roles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       VARCHAR(80) NOT NULL,
  is_system  BOOLEAN NOT NULL DEFAULT false, -- roles base creados al aprovisionar el tenant
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

-- Catálogo GLOBAL de módulos del sistema (no lleva tenant_id: es fijo por versión de app)
CREATE TABLE modules (
  id    SERIAL PRIMARY KEY,
  code  VARCHAR(60) UNIQUE NOT NULL,   -- 'students', 'grading', 'payments', ...
  label VARCHAR(120) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0
);

-- Matriz rol x módulo x permiso, editable por tenant desde la UI de Roles
CREATE TABLE role_permissions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role_id        UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  module_id      INT  NOT NULL REFERENCES modules(id),
  can_create     BOOLEAN NOT NULL DEFAULT false,
  can_read       BOOLEAN NOT NULL DEFAULT false,
  can_update     BOOLEAN NOT NULL DEFAULT false,
  can_delete     BOOLEAN NOT NULL DEFAULT false,
  extra_actions  JSONB NOT NULL DEFAULT '{}', -- {"export": true, "approve_payment": true}
  UNIQUE (role_id, module_id)
);

-- =====================================================================
-- 3. PERSONAL, ALUMNOS Y REPRESENTANTES
-- =====================================================================

CREATE TABLE staff (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  staff_type  VARCHAR(20) NOT NULL
              CHECK (staff_type IN ('administrative', 'teaching', 'support')),
  first_name  VARCHAR(100) NOT NULL,
  last_name   VARCHAR(100) NOT NULL,
  national_id VARCHAR(30),
  phone       VARCHAR(30),
  email       VARCHAR(150),
  hired_at    DATE,
  status      VARCHAR(20) NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'inactive')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE students (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  first_name  VARCHAR(100) NOT NULL,
  last_name   VARCHAR(100) NOT NULL,
  birth_date  DATE,
  national_id VARCHAR(30),
  status      VARCHAR(20) NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'inactive', 'graduated', 'withdrawn')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE guardians (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL, -- login del padre/representante
  first_name  VARCHAR(100) NOT NULL,
  last_name   VARCHAR(100) NOT NULL,
  national_id VARCHAR(30),
  phone       VARCHAR(30),
  email       VARCHAR(150),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE student_guardians (
  student_id   UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  guardian_id  UUID NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
  relationship VARCHAR(30), -- padre, madre, representante legal
  is_primary   BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (student_id, guardian_id)
);

-- =====================================================================
-- 4. ESTRUCTURA ACADÉMICA (aulas, grados, secciones, inscripciones)
-- =====================================================================

CREATE TABLE school_periods (   -- año escolar
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       VARCHAR(30) NOT NULL,   -- "2026-2027"
  start_date DATE,
  end_date   DATE,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (tenant_id, name)
);

CREATE TABLE classrooms (       -- aula física
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       VARCHAR(60) NOT NULL,
  capacity   INT
);

CREATE TABLE grades (           -- grado
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       VARCHAR(60) NOT NULL,   -- "3er grado"
  sort_order INT NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, name)
);

CREATE TABLE sections (         -- sección dentro de un grado, en un año escolar
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  grade_id              UUID NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
  school_period_id      UUID NOT NULL REFERENCES school_periods(id) ON DELETE CASCADE,
  classroom_id          UUID REFERENCES classrooms(id) ON DELETE SET NULL,
  name                  VARCHAR(20) NOT NULL,   -- "A"
  max_students          INT NOT NULL DEFAULT 30 CHECK (max_students > 0),
  lead_teacher_id       UUID REFERENCES staff(id) ON DELETE SET NULL,
  assistant_teacher_id  UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, grade_id, school_period_id, name)
);

CREATE TABLE enrollments (      -- inscripción del alumno en sección/año
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id   UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  section_id   UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  enrolled_at  DATE NOT NULL DEFAULT current_date,
  status       VARCHAR(20) NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'withdrawn')),
  UNIQUE (student_id, section_id)
);

-- =====================================================================
-- 5. PLANES DE EVALUACIÓN Y PROYECTOS PEDAGÓGICOS
-- =====================================================================

CREATE TABLE terms (             -- periodo/lapso dentro de un año escolar
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  school_period_id  UUID NOT NULL REFERENCES school_periods(id) ON DELETE CASCADE,
  name              VARCHAR(30) NOT NULL,   -- "Lapso 1"
  start_date        DATE,
  end_date          DATE,
  UNIQUE (tenant_id, school_period_id, name)
);

CREATE TABLE evaluation_plans (  -- 1 plan por sección+lapso+docente+asignatura
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  section_id   UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  term_id      UUID NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  teacher_id   UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  subject      VARCHAR(100) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (section_id, term_id, teacher_id, subject)
);

CREATE TABLE pedagogical_projects (  -- opcional
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  evaluation_plan_id  UUID NOT NULL REFERENCES evaluation_plans(id) ON DELETE CASCADE,
  title               VARCHAR(200) NOT NULL,
  description         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE project_competencies (  -- N competencias esperadas por proyecto
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pedagogical_project_id   UUID NOT NULL REFERENCES pedagogical_projects(id) ON DELETE CASCADE,
  description              TEXT NOT NULL
);

CREATE TABLE evaluation_activities (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  evaluation_plan_id  UUID NOT NULL REFERENCES evaluation_plans(id) ON DELETE CASCADE,
  title               VARCHAR(200) NOT NULL,
  category            VARCHAR(40) NOT NULL
                      CHECK (category IN ('formative', 'exam', 'project', 'homework', 'other')),
  weight_percent      NUMERIC(5,2) NOT NULL CHECK (weight_percent > 0 AND weight_percent <= 100),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- La restricción "suma de weight_percent por evaluation_plan_id <= 100" es una
-- suma entre filas y NO puede expresarse como CHECK de columna. Se aplica en
-- el servicio (evaluationPlan.service.js, dentro de una transacción con
-- bloqueo de filas) y se refuerza aquí como red de seguridad con un
-- constraint trigger, por si algún proceso escribe fuera del servicio.

CREATE OR REPLACE FUNCTION fn_check_activity_weight_sum() RETURNS TRIGGER AS $$
DECLARE
  total NUMERIC(6,2);
BEGIN
  SELECT COALESCE(SUM(weight_percent), 0) INTO total
  FROM evaluation_activities
  WHERE evaluation_plan_id = NEW.evaluation_plan_id
    AND id <> NEW.id;

  total := total + NEW.weight_percent;

 IF total > 100 THEN
    RAISE EXCEPTION 'La suma de porcentajes del plan excede el 100 por ciento. Total actual: %', total
    USING ERRCODE = 'check_violation';
END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_check_activity_weight_sum
  AFTER INSERT OR UPDATE OF weight_percent, evaluation_plan_id ON evaluation_activities
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_check_activity_weight_sum();

-- =====================================================================
-- 6. CALIFICACIONES Y EVALUACIÓN CUALITATIVA DE COMPETENCIAS
-- =====================================================================

CREATE TABLE activity_scores (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  evaluation_activity_id   UUID NOT NULL REFERENCES evaluation_activities(id) ON DELETE CASCADE,
  student_id               UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  raw_score                NUMERIC(5,2) NOT NULL CHECK (raw_score >= 0),
  max_score                NUMERIC(5,2) NOT NULL DEFAULT 20, -- escala de calificación (20, 100, etc.)
  weighted_score           NUMERIC(6,3) NOT NULL,            -- (raw_score/max_score) * weight_percent
  graded_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (evaluation_activity_id, student_id)
);

CREATE TABLE competency_assessments (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_competency_id    UUID NOT NULL REFERENCES project_competencies(id) ON DELETE CASCADE,
  student_id               UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  result                   VARCHAR(20) NOT NULL
                           CHECK (result IN ('achieved', 'needs_improvement')),
  assessed_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_competency_id, student_id)
);

-- =====================================================================
-- 7. PAGOS (mensualidad)
-- =====================================================================

CREATE TABLE payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id    UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  guardian_id   UUID NOT NULL REFERENCES guardians(id) ON DELETE RESTRICT,
  period_label  VARCHAR(30) NOT NULL,   -- "Mensualidad Octubre 2026"
  amount        NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  currency      VARCHAR(10) NOT NULL DEFAULT 'USD',
  status        VARCHAR(20) NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  paid_at       TIMESTAMPTZ,
  receipt_url   TEXT,
  email_sent_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- 8. AUDITORÍA (recomendado para cambios sensibles)
-- =====================================================================

CREATE TABLE audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  action      VARCHAR(50) NOT NULL,     -- create, update, delete, login...
  entity      VARCHAR(60) NOT NULL,     -- 'payments', 'role_permissions', ...
  entity_id   UUID,
  diff        JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- 9. ÍNDICES
-- =====================================================================

CREATE INDEX idx_users_tenant                  ON users(tenant_id);
CREATE INDEX idx_roles_tenant                  ON roles(tenant_id);
CREATE INDEX idx_role_permissions_tenant_role  ON role_permissions(tenant_id, role_id);
CREATE INDEX idx_staff_tenant                  ON staff(tenant_id);
CREATE INDEX idx_staff_tenant_type             ON staff(tenant_id, staff_type);
CREATE INDEX idx_students_tenant               ON students(tenant_id);
CREATE INDEX idx_guardians_tenant              ON guardians(tenant_id);
CREATE INDEX idx_student_guardians_guardian    ON student_guardians(guardian_id);
CREATE INDEX idx_sections_tenant_period        ON sections(tenant_id, school_period_id);
CREATE INDEX idx_enrollments_tenant_section    ON enrollments(tenant_id, section_id);
CREATE INDEX idx_enrollments_student           ON enrollments(student_id);
CREATE INDEX idx_evaluation_plans_tenant       ON evaluation_plans(tenant_id, section_id, term_id);
CREATE INDEX idx_evaluation_activities_plan    ON evaluation_activities(tenant_id, evaluation_plan_id);
CREATE INDEX idx_activity_scores_tenant        ON activity_scores(tenant_id, evaluation_activity_id);
CREATE INDEX idx_activity_scores_student       ON activity_scores(student_id);
CREATE INDEX idx_competency_assessments_tenant ON competency_assessments(tenant_id, project_competency_id);
CREATE INDEX idx_payments_tenant_student       ON payments(tenant_id, student_id);
CREATE INDEX idx_payments_tenant_status        ON payments(tenant_id, status);
CREATE INDEX idx_audit_logs_tenant             ON audit_logs(tenant_id, created_at DESC);

-- =====================================================================
-- 10. ROW LEVEL SECURITY (segunda capa de aislamiento multi-tenant)
-- La app hace `SET app.tenant_id = '<uuid>'` al inicio de cada request
-- (ver src/middlewares/tenant.middleware.js) y estas políticas garantizan
-- que ninguna query, aunque tenga un bug en el filtro del ORM, pueda leer
-- o escribir filas de otro tenant.
-- =====================================================================

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'users','roles','role_permissions','staff','students','guardians',
      'tenant_settings','school_periods','classrooms','grades','sections',
      'enrollments','terms','evaluation_plans','pedagogical_projects',
      'project_competencies','evaluation_activities','activity_scores',
      'competency_assessments','payments','audit_logs'
    ])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid);',
      t
    );
  END LOOP;
END $$;

-- student_guardians no tiene columna tenant_id propia (se deriva por join
-- contra students/guardians, ambas ya protegidas por RLS), así que se deja
-- fuera del loop anterior: no necesita su propia política.
