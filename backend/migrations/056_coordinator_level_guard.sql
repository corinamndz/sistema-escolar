-- =====================================================================
-- 056 · Rol Coordinador: nivel de coordinación obligatorio (en la base)
--
-- El nivel que coordina un usuario (initial | primary | secondary) se guarda
-- en su ficha de personal: staff.coordination_level (migración 047), unida al
-- usuario por staff.user_id. La aplicación ya lo exige al dar el rol
-- (Personal → Acceso al sistema); esta migración lo garantiza también en la
-- base, venga el cambio de donde venga:
--
--   Todo usuario ACTIVO con el rol Coordinador debe tener una ficha de
--   personal con coordination_level.
--
-- Triggers de restricción DIFERIDOS (se comprueban al confirmar la
-- transacción): así el servicio puede guardar el nivel y los roles en el
-- orden que le convenga dentro de la misma operación.
-- Corre en public y en cada esquema de colegio (tablas sin esquema: search_path).
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_assert_coordinator_level(p_user_id UUID) RETURNS void AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (
       SELECT 1
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id AND r.name = 'Coordinador'
       WHERE u.id = p_user_id AND u.status = 'active'
     )
     AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.user_id = p_user_id AND s.coordination_level IS NOT NULL)
  THEN
    RAISE EXCEPTION 'El rol Coordinador requiere el nivel de coordinación (Inicial, Primaria o Secundaria) en la ficha de personal del usuario.'
      USING ERRCODE = '23514';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_check_coordinator_level() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'user_roles' THEN
    PERFORM fn_assert_coordinator_level(NEW.user_id);
  ELSIF TG_TABLE_NAME = 'users' THEN
    PERFORM fn_assert_coordinator_level(NEW.id);
  ELSIF TG_TABLE_NAME = 'staff' THEN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      PERFORM fn_assert_coordinator_level(OLD.user_id);
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      PERFORM fn_assert_coordinator_level(NEW.user_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Recibir el rol (o reactivarse) sin nivel / quitar el nivel o la ficha a un coordinador activo.
DROP TRIGGER IF EXISTS trg_coordinator_level_roles ON user_roles;
CREATE CONSTRAINT TRIGGER trg_coordinator_level_roles
  AFTER INSERT ON user_roles DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_check_coordinator_level();

DROP TRIGGER IF EXISTS trg_coordinator_level_users ON users;
CREATE CONSTRAINT TRIGGER trg_coordinator_level_users
  AFTER UPDATE OF status ON users DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_check_coordinator_level();

DROP TRIGGER IF EXISTS trg_coordinator_level_staff ON staff;
CREATE CONSTRAINT TRIGGER trg_coordinator_level_staff
  AFTER UPDATE OF coordination_level, user_id OR DELETE ON staff DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_check_coordinator_level();
