-- =====================================================================
-- 068 · El contenido programático pasa a ser de UN año escolar
--
-- Hasta ahora (038) el temario de una materia en un grado valía para todos
-- los años: lo creado en 2026-2027 aparecía también en 2027-2028. Desde aquí
-- cada tema pertenece a un año (programmatic_content.school_period_id), igual
-- que los planes de evaluación (por sus lapsos), y pasar el temario al año
-- siguiente es una acción explícita: "Duplicar para otro año".
--
-- Datos existentes (no se borra nada):
--   1. Cada tema queda en el año de las actividades que lo evalúan (el más
--      antiguo si hay varios).
--   2. Si actividades de OTRO año también lo usan, se crea una copia del tema
--      en ese año y esas actividades pasan a apuntar a la copia.
--   3. Los temas sin actividades van al año en curso del colegio (el que
--      contiene la fecha de hoy; si no, el último iniciado; si no, el primero).
--   Los triggers de revisión y de planes cerrados se apagan durante el
--   traslado: mover datos no es "editar" el programa ni un plan cerrado.
--
-- La revisión del programa (058) también pasa a ser por año: el estado
-- aprobado de 2026-2027 no aprueba el temario de 2027-2028.
--
-- Redes de seguridad:
--   - fn_check_activity_content: el tema de una actividad debe ser del mismo
--     año que el plan (además de la misma materia y grado).
--   - fn_review_reset_content: la edición de un tema reinicia la revisión de
--     SU año.
-- =====================================================================

-- Año "en curso" de un colegio (mismo criterio que lib/schoolPeriods.js del frontend).
CREATE OR REPLACE FUNCTION fn_default_school_period(p_tenant UUID) RETURNS UUID AS $$
  SELECT sp.id
  FROM school_periods sp
  WHERE sp.tenant_id = p_tenant
  ORDER BY
    CASE
      WHEN current_date BETWEEN COALESCE(sp.start_date, '-infinity'::date) AND COALESCE(sp.end_date, 'infinity'::date) THEN 0
      WHEN sp.start_date <= current_date THEN 1
      ELSE 2
    END,
    CASE WHEN sp.start_date <= current_date THEN sp.start_date END DESC NULLS LAST,
    sp.start_date ASC NULLS LAST
  LIMIT 1;
$$ LANGUAGE sql STABLE;

ALTER TABLE programmatic_content
  ADD COLUMN IF NOT EXISTS school_period_id UUID REFERENCES school_periods(id) ON DELETE CASCADE;

ALTER TABLE programmatic_content DISABLE TRIGGER trg_review_reset_content;
ALTER TABLE evaluation_activities DISABLE TRIGGER trg_review_reset_activities;
ALTER TABLE evaluation_activities DISABLE TRIGGER trg_block_closed_plan_activities;

-- 1. Año de las actividades que lo evalúan (el más antiguo).
UPDATE programmatic_content pc
SET school_period_id = u.period_id
FROM (
  SELECT DISTINCT ON (a.programmatic_content_id) a.programmatic_content_id AS content_id, t.school_period_id AS period_id
  FROM evaluation_activities a
  JOIN evaluation_plans ep ON ep.id = a.evaluation_plan_id
  JOIN terms t ON t.id = ep.term_id
  JOIN school_periods sp ON sp.id = t.school_period_id
  WHERE a.programmatic_content_id IS NOT NULL
  ORDER BY a.programmatic_content_id, sp.start_date NULLS LAST
) u
WHERE u.content_id = pc.id AND pc.school_period_id IS NULL;

-- 2. Usado también en otros años: una copia por año y sus actividades apuntan a ella.
DO $$
DECLARE
  r RECORD;
  copy_id UUID;
BEGIN
  FOR r IN
    SELECT DISTINCT pc.id AS content_id, t.school_period_id AS period_id
    FROM programmatic_content pc
    JOIN evaluation_activities a ON a.programmatic_content_id = pc.id
    JOIN evaluation_plans ep ON ep.id = a.evaluation_plan_id
    JOIN terms t ON t.id = ep.term_id
    WHERE t.school_period_id IS DISTINCT FROM pc.school_period_id
  LOOP
    INSERT INTO programmatic_content (tenant_id, grade_id, subject_id, school_period_id, unit, topic, description, sort_order, created_at, updated_at)
    SELECT tenant_id, grade_id, subject_id, r.period_id, unit, topic, description, sort_order, created_at, updated_at
    FROM programmatic_content WHERE id = r.content_id
    RETURNING id INTO copy_id;

    UPDATE evaluation_activities a
    SET programmatic_content_id = copy_id
    FROM evaluation_plans ep JOIN terms t ON t.id = ep.term_id
    WHERE ep.id = a.evaluation_plan_id AND a.programmatic_content_id = r.content_id AND t.school_period_id = r.period_id;
  END LOOP;
END $$;

-- 3. Sin actividades: al año en curso del colegio.
UPDATE programmatic_content SET school_period_id = fn_default_school_period(tenant_id) WHERE school_period_id IS NULL;

ALTER TABLE programmatic_content ENABLE TRIGGER trg_review_reset_content;
ALTER TABLE evaluation_activities ENABLE TRIGGER trg_review_reset_activities;
ALTER TABLE evaluation_activities ENABLE TRIGGER trg_block_closed_plan_activities;

-- Obligatorio desde ahora. (Un colegio con temas pero sin ningún año escolar no
-- puede asignarlos: queda opcional en ese esquema y esos temas no se muestran.)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM programmatic_content WHERE school_period_id IS NULL) THEN
    ALTER TABLE programmatic_content ALTER COLUMN school_period_id SET NOT NULL;
  ELSE
    RAISE NOTICE 'programmatic_content: hay temas sin año escolar (el colegio no tiene años); la columna queda opcional.';
  END IF;
END $$;

DROP INDEX IF EXISTS idx_programmatic_content_grade_subject;
CREATE INDEX IF NOT EXISTS idx_programmatic_content_period
  ON programmatic_content (tenant_id, school_period_id, grade_id, subject_id, sort_order);

-- ---------------------------------------------------------------------
-- Revisión del programa por año
-- ---------------------------------------------------------------------
ALTER TABLE programmatic_content_reviews
  ADD COLUMN IF NOT EXISTS school_period_id UUID REFERENCES school_periods(id) ON DELETE CASCADE;

-- Al año donde está el temario de esa materia y grado (el que tiene más temas); si no hay temas, al año en curso.
UPDATE programmatic_content_reviews r
SET school_period_id = COALESCE(
  (SELECT pc.school_period_id FROM programmatic_content pc
   WHERE pc.grade_id = r.grade_id AND pc.subject_id = r.subject_id AND pc.school_period_id IS NOT NULL
   GROUP BY pc.school_period_id ORDER BY count(*) DESC LIMIT 1),
  fn_default_school_period(r.tenant_id)
)
WHERE r.school_period_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM programmatic_content_reviews WHERE school_period_id IS NULL) THEN
    ALTER TABLE programmatic_content_reviews ALTER COLUMN school_period_id SET NOT NULL;
  END IF;
END $$;
ALTER TABLE programmatic_content_reviews DROP CONSTRAINT IF EXISTS programmatic_content_reviews_tenant_id_grade_id_subject_id_key;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ux_content_reviews_period' AND conrelid = 'programmatic_content_reviews'::regclass) THEN
    ALTER TABLE programmatic_content_reviews ADD CONSTRAINT ux_content_reviews_period UNIQUE (tenant_id, grade_id, subject_id, school_period_id);
  END IF;
END $$;

-- La edición de un tema reinicia la revisión del programa de SU año.
CREATE OR REPLACE FUNCTION fn_review_reset_content() RETURNS trigger AS $$
DECLARE
  r programmatic_content_reviews%ROWTYPE;
  g UUID := COALESCE(NEW.grade_id, OLD.grade_id);
  s UUID := COALESCE(NEW.subject_id, OLD.subject_id);
  p UUID := COALESCE(NEW.school_period_id, OLD.school_period_id);
BEGIN
  SELECT * INTO r FROM programmatic_content_reviews WHERE grade_id = g AND subject_id = s AND school_period_id = p FOR UPDATE;
  IF FOUND AND r.status IN ('en_revision', 'aprobado') THEN
    UPDATE programmatic_content_reviews SET status = 'borrador' WHERE id = r.id;
    INSERT INTO review_comments (tenant_id, content_review_id, author_role, kind, body)
    VALUES (r.tenant_id, r.id, 'sistema', 'reset',
            CASE r.status WHEN 'aprobado' THEN 'El contenido se modificó después de aprobado: vuelve a borrador y necesita una nueva revisión.'
                          ELSE 'El contenido se modificó mientras estaba en revisión: vuelve a borrador; reenvíalo cuando termines.' END);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- El tema de una actividad: misma materia, mismo grado y MISMO AÑO que el plan.
CREATE OR REPLACE FUNCTION fn_check_activity_content() RETURNS trigger AS $$
DECLARE
  plan_subject UUID;
  plan_grade   UUID;
  plan_period  UUID;
  c            programmatic_content%ROWTYPE;
BEGIN
  IF NEW.programmatic_content_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT ep.subject_id, s.grade_id, t.school_period_id INTO plan_subject, plan_grade, plan_period
  FROM evaluation_plans ep
  JOIN sections s ON s.id = ep.section_id
  JOIN terms t ON t.id = ep.term_id
  WHERE ep.id = NEW.evaluation_plan_id;
  SELECT * INTO c FROM programmatic_content WHERE id = NEW.programmatic_content_id;
  IF c.subject_id IS DISTINCT FROM plan_subject OR c.grade_id IS DISTINCT FROM plan_grade THEN
    RAISE EXCEPTION 'El contenido programático no corresponde a la materia y el grado del plan de evaluación.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF c.school_period_id IS DISTINCT FROM plan_period THEN
    RAISE EXCEPTION 'El contenido programático es de otro año escolar que el plan de evaluación.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
