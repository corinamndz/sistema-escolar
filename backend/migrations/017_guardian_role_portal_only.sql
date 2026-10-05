-- =====================================================================
-- 017 · El rol Representante solo usa el portal de padres
--
-- Los representantes ven los pagos y calificaciones de SUS hijos desde el
-- portal (/portal/*, /payments/mine), que filtra por la familia. Un permiso
-- administrativo sobre "payments" o "grading" les abría los endpoints del
-- colegio completo (todos los pagos, comprobantes de otras familias, notas de
-- cualquier plan). Se les deja únicamente el panel de inicio.
-- (El backend además ignora esos permisos si volvieran a cargarse.)
-- =====================================================================

DELETE FROM role_permissions rp
USING roles r, modules m
WHERE r.id = rp.role_id AND m.id = rp.module_id
  AND r.name = 'Representante' AND m.code <> 'dashboard';
