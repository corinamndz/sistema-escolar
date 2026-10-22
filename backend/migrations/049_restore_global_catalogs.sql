-- =====================================================================
-- 049 · Restaurar los catálogos globales (idempotente)
--
-- education_levels, currencies y el módulo "appointments" se cargaron con
-- datos en las migraciones 002, 009, 010, 011, 024 y 042. Si una base se
-- vacía (TRUNCATE) y su historial se re-registra con `migrate --baseline`,
-- esas migraciones no vuelven a correr y los catálogos quedan vacíos:
-- todo grado nuevo falla con "Nivel educativo inválido." y no hay monedas.
--
-- Esta migración deja los catálogos como los dejaron esas migraciones, sin
-- tocar lo que ya exista (ON CONFLICT DO NOTHING). Corre en public y en cada
-- esquema de colegio: los catálogos viven en public (los nombres sin esquema
-- se resuelven ahí) y los permisos de Citas se completan en los roles del
-- esquema en curso.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Niveles educativos (002 + 009 y 024: los tres tienen plan de estudios)
-- ---------------------------------------------------------------------
INSERT INTO education_levels (code, name, sort_order, assignment_mode, allows_assistant, has_curriculum) VALUES
  ('initial',   'Educación Inicial',    1, 'homeroom', true,  true),
  ('primary',   'Educación Primaria',   2, 'homeroom', false, true),
  ('secondary', 'Educación Secundaria', 3, 'subjects', false, true)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------
-- Monedas (010 + 011)
-- ---------------------------------------------------------------------
INSERT INTO currencies (code, name, country, symbol, decimals, locale, official_source, sort_order) VALUES
  ('USD', 'Dólar estadounidense', 'Estados Unidos',       '$',    2, 'es-VE', NULL,  0),
  ('VES', 'Bolívar',              'Venezuela',            'Bs.',  2, 'es-VE', 'bcv', 1),
  ('COP', 'Peso colombiano',      'Colombia',             'COL$', 2, 'es-CO', NULL,  2),
  ('PEN', 'Sol',                  'Perú',                 'S/',   2, 'es-PE', NULL,  3),
  ('ARS', 'Peso argentino',       'Argentina',            'AR$',  2, 'es-AR', NULL,  4),
  ('CLP', 'Peso chileno',         'Chile',                'CLP$', 0, 'es-CL', NULL,  5),
  ('MXN', 'Peso mexicano',        'México',               'MX$',  2, 'es-MX', NULL,  6),
  ('BRL', 'Real',                 'Brasil',               'R$',   2, 'pt-BR', NULL,  7),
  ('BOB', 'Boliviano',            'Bolivia',              'Bs',   2, 'es-BO', NULL,  8),
  ('UYU', 'Peso uruguayo',        'Uruguay',              '$U',   2, 'es-UY', NULL,  9),
  ('PYG', 'Guaraní',              'Paraguay',             '₲',    0, 'es-PY', NULL, 10),
  ('DOP', 'Peso dominicano',      'República Dominicana', 'RD$',  2, 'es-DO', NULL, 11),
  ('CRC', 'Colón',                'Costa Rica',           '₡',    2, 'es-CR', NULL, 12),
  ('GTQ', 'Quetzal',              'Guatemala',            'Q',    2, 'es-GT', NULL, 13),
  ('HNL', 'Lempira',              'Honduras',             'L',    2, 'es-HN', NULL, 14),
  ('NIO', 'Córdoba',              'Nicaragua',            'C$',   2, 'es-NI', NULL, 15),
  ('PAB', 'Balboa',               'Panamá',               'B/.',  2, 'es-PA', NULL, 16),
  ('CUP', 'Peso cubano',          'Cuba',                 'CUP$', 2, 'es-CU', NULL, 17),
  ('HTG', 'Gourde',               'Haití',                'G',    2, 'fr-HT', NULL, 18),
  ('EUR', 'Euro',                 'Unión Europea',        '€',    2, 'es-ES', NULL, 30)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------
-- Módulo Citas con padres (042) y sus permisos en los roles del colegio
-- ---------------------------------------------------------------------
INSERT INTO modules (code, label, sort_order) VALUES ('appointments', 'Citas con padres', 15) ON CONFLICT (code) DO NOTHING;

-- Roles administrativos (los que editan alumnos): los mismos permisos que tienen en Alumnos.
INSERT INTO role_permissions (tenant_id, role_id, module_id, can_create, can_read, can_update, can_delete, extra_actions)
SELECT rp.tenant_id, rp.role_id, (SELECT id FROM modules WHERE code = 'appointments'),
       rp.can_create, rp.can_read, rp.can_update, rp.can_delete, '{}'::jsonb
FROM role_permissions rp
JOIN modules m ON m.id = rp.module_id AND m.code = 'students'
JOIN roles r ON r.id = rp.role_id
WHERE rp.can_update AND r.name NOT IN ('Docente', 'Representante', 'Coordinador')
  AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = rp.role_id AND x.module_id = (SELECT id FROM modules WHERE code = 'appointments'));

-- Docente y Coordinador: consulta (042 y 047).
INSERT INTO role_permissions (tenant_id, role_id, module_id, can_create, can_read, can_update, can_delete, extra_actions)
SELECT r.tenant_id, r.id, (SELECT id FROM modules WHERE code = 'appointments'), false, true, false, false, '{}'::jsonb
FROM roles r
WHERE r.name IN ('Docente', 'Coordinador')
  AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = r.id AND x.module_id = (SELECT id FROM modules WHERE code = 'appointments'));
