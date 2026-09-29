import { useMemo } from 'react';
import academicsApi from '../../../api/endpoints/academics.api';
import { useFetch } from '../../../hooks/useFetch';

/**
 * Pasos de la configuración académica, en el orden en que dependen entre sí:
 * las secciones necesitan grado + año escolar; Primaria y Secundaria necesitan materias
 * en el plan de estudios antes de poder asignar profesores por materia.
 */
export const SETUP_STEPS = [
  { key: 'period', number: 1, title: 'Año escolar', short: 'Año escolar', icon: 'calendar' },
  { key: 'structure', number: 2, title: 'Grados y aulas', short: 'Grados y aulas', icon: 'school' },
  { key: 'subjects', number: 3, title: 'Materias y plan de estudios', short: 'Materias', icon: 'book' },
  { key: 'sections', number: 4, title: 'Secciones y docentes', short: 'Secciones y docentes', icon: 'users' },
];

/** Una sección está "completa" cuando tiene todos los docentes que exige su nivel. */
export function isSectionStaffed(s) {
  if (s.assignment_mode === 'subjects') {
    const { total = 0, assigned = 0 } = s.subjectCoverage || {};
    return total > 0 && assigned >= total;
  }
  return Boolean(s.teachers?.lead) && (!s.allows_assistant || Boolean(s.teachers?.assistant));
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
export function computeSetup({ periods, classrooms, grades, subjects, sections }) {
  const activePeriods = periods.filter((p) => p.is_active);
  const activeIds = new Set(activePeriods.map((p) => p.id));
  // Grados con plan de estudios por materias (Primaria y Secundaria).
  const curriculumGrades = grades.filter((g) => g.has_curriculum);
  const gradesWithoutPlan = curriculumGrades.filter((g) => !g.subject_count);
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

  let subjectsStep;
  if (grades.length && curriculumGrades.length === 0) {
    subjectsStep = {
      done: true,
      optional: true,
      summary: 'No aplica: solo hay grados de Inicial',
      todo: null,
    };
  } else {
    const done = curriculumGrades.length > 0 && subjects.length > 0 && gradesWithoutPlan.length === 0;
    subjectsStep = {
      done,
      blockedBy: grades.length ? null : 'structure',
      summary: `${plural(subjects.length, 'materia', 'materias')} · ${curriculumGrades.length - gradesWithoutPlan.length}/${curriculumGrades.length} planes`,
      todo: done
        ? null
        : subjects.length === 0
          ? 'Crea el catálogo de materias.'
          : `Arma el plan de estudios de ${plural(gradesWithoutPlan.length, 'grado', 'grados')}: ${gradesWithoutPlan
              .map((g) => g.name)
              .join(', ')}.`,
    };
  }

  const sectionsStep = {
    done: currentSections.length > 0 && staffed.length === currentSections.length,
    blockedBy: !period.done ? 'period' : !structure.done ? 'structure' : null,
    summary: currentSections.length
      ? `${staffed.length}/${currentSections.length} secciones con docentes`
      : 'Sin secciones en el año en curso',
    todo:
      currentSections.length === 0
        ? 'Crea las secciones del año en curso (ej. "1er grado A").'
        : staffed.length < currentSections.length
          ? `Asigna docentes a ${plural(currentSections.length - staffed.length, 'sección', 'secciones')}.`
          : null,
    pendingSections: currentSections.filter((s) => !isSectionStaffed(s)),
  };

  const byKey = { period, structure, subjects: subjectsStep, sections: sectionsStep };
  const steps = SETUP_STEPS.map((s) => ({ ...s, ...byKey[s.key] }));
  const completed = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done) || null;

  return { steps, byKey: Object.fromEntries(steps.map((s) => [s.key, s])), completed, total: steps.length, next, allDone: !next };
}

/**
 * Carga lo necesario para el progreso. `version` fuerza la recarga cuando
 * una pestaña guarda cambios (crear grado, asignar docentes, etc.).
 */
export function useSetupStatus(version) {
  const { data, loading, error } = useFetch(async () => {
    const [periods, classrooms, grades, subjects, sections] = await Promise.all([
      academicsApi.listSchoolPeriods(),
      academicsApi.listClassrooms(),
      academicsApi.listGrades(),
      academicsApi.listSubjects(),
      academicsApi.listSections(),
    ]);
    return { periods, classrooms, grades, subjects, sections };
  }, [version]);

  const status = useMemo(() => (data ? computeSetup(data) : null), [data]);
  return { status, loading: loading && !status, error };
}
