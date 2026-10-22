import { useMemo } from 'react';
import academicsApi from '../../../api/endpoints/academics.api';
import { useFetch } from '../../../hooks/useFetch';

/**
 * Pasos de la estructura académica, en el orden en que dependen entre sí: las
 * secciones necesitan grado + año escolar. Los dos primeros forman la
 * CONFIGURACIÓN INICIAL (/configuracion-inicial); las secciones y su personal
 * docente son la operación diaria (/secciones-academicas). Las materias (y sus
 * docentes por sección) tienen su propio módulo.
 */
export const SETUP_STEPS = [
  { key: 'period', number: 1, title: 'Año escolar', short: 'Año escolar', icon: 'calendar' },
  { key: 'structure', number: 2, title: 'Grados y aulas', short: 'Grados y aulas', icon: 'school' },
  { key: 'sections', number: 3, title: 'Secciones y personal docente', short: 'Secciones y docentes', icon: 'users' },
];
/** Pasos del asistente de Configuración inicial. */
export const INITIAL_SETUP_KEYS = ['period', 'structure'];
export const INITIAL_SETUP_STEPS = SETUP_STEPS.filter((s) => INITIAL_SETUP_KEYS.includes(s.key));

/**
 * Una sección está "completa" cuando tiene el personal que exige su nivel:
 * Inicial docente + auxiliar, Primaria docente, Secundaria docente guía.
 * Acepta las dos formas: la del listado de secciones y la del panel por grado.
 */
export function isSectionStaffed(s) {
  if (s.assignment_mode === 'subjects' || s.mode === 'subjects') return Boolean(s.guide_teacher_id || s.guide);
  const lead = s.teachers?.lead || s.homeroom?.lead;
  const assistant = s.teachers?.assistant || s.homeroom?.assistant;
  return Boolean(lead) && (!s.allows_assistant || Boolean(assistant));
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Calcula el estado de cada paso a partir de los datos reales del colegio
 * (no se guarda nada aparte: si alguien borra o crea algo, el progreso se
 * recalcula solo).
 *
 * Cada paso: { done, optional, blockedBy, summary, todo }
 *   - summary: lo que ya hay ("2 grados · 3 aulas")
 *   - todo: la siguiente acción concreta, o null si está completo
 *   - blockedBy: clave del paso previo que falta (para avisar en pantalla)
 */
export function computeSetup({ periods, classrooms, grades, sections }, keys = null) {
  const activePeriods = periods.filter((p) => p.is_active);
  const activeIds = new Set(activePeriods.map((p) => p.id));
  const currentSections = sections.filter((s) => activeIds.has(s.school_period_id));
  const staffed = currentSections.filter(isSectionStaffed);

  const period = {
    done: activePeriods.length > 0,
    summary: activePeriods.length ? `En curso: ${activePeriods.map((p) => p.name).join(', ')}` : 'Sin año escolar',
    todo: activePeriods.length ? null : 'Crea el año escolar en curso (ej. 2026-2027).',
  };

  const structure = {
    done: grades.length > 0,
    summary: `${plural(grades.length, 'grado', 'grados')} · ${plural(classrooms.length, 'aula', 'aulas')}`,
    todo: grades.length ? null : 'Crea los grados que ofrece el colegio en cada nivel.',
  };

  const sectionsStep = {
    done: currentSections.length > 0 && staffed.length === currentSections.length,
    blockedBy: !period.done ? 'period' : !structure.done ? 'structure' : null,
    summary: currentSections.length
      ? `${staffed.length}/${currentSections.length} secciones con su personal docente`
      : 'Sin secciones en el año en curso',
    todo:
      currentSections.length === 0
        ? 'Crea las secciones del año en curso (ej. "1er grado A").'
        : staffed.length < currentSections.length
          ? `Asigna el personal docente de ${plural(currentSections.length - staffed.length, 'sección', 'secciones')}.`
          : null,
    pendingSections: currentSections.filter((s) => !isSectionStaffed(s)),
  };

  const byKey = { period, structure, sections: sectionsStep };
  // `keys`: solo esos pasos cuentan para el progreso (la Configuración inicial usa los dos primeros).
  const steps = SETUP_STEPS.filter((s) => !keys || keys.includes(s.key)).map((s) => ({ ...s, ...byKey[s.key] }));
  const completed = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done) || null;

  // byKey trae TODOS los pasos (también los que no cuentan), para avisos como "falta el año escolar".
  const all = SETUP_STEPS.map((s) => ({ ...s, ...byKey[s.key] }));
  return { steps, byKey: Object.fromEntries(all.map((s) => [s.key, s])), completed, total: steps.length, next, allDone: !next };
}

/**
 * Carga lo necesario para el progreso. `version` fuerza la recarga cuando
 * una pestaña guarda cambios (crear grado, asignar docentes, etc.).
 */
export function useSetupStatus(version, keys = null) {
  const { data, loading, error } = useFetch(async () => {
    const [periods, classrooms, grades, sections] = await Promise.all([
      academicsApi.listSchoolPeriods(),
      academicsApi.listClassrooms(),
      academicsApi.listGrades(),
      academicsApi.listSections(),
    ]);
    return { periods, classrooms, grades, sections };
  }, [version]);

  const keyList = keys ? keys.join(',') : '';
  const status = useMemo(() => (data ? computeSetup(data, keyList ? keyList.split(',') : null) : null), [data, keyList]);
  return { status, loading: loading && !status, error };
}
