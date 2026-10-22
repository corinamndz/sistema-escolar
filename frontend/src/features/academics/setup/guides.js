import { LEVELS } from '../levels';

/** Textos de ayuda de cada paso de la estructura académica: qué hacer y cómo se conecta con el resto. */
export const SETUP_GUIDES = {
  period: {
    intro:
      'El año escolar es el contenedor de todo un ciclo. Empieza creando el año en curso: sin él no se pueden abrir secciones ni inscribir alumnos.',
    links: [
      'Las secciones, las inscripciones y las notas quedan asociadas a un año escolar.',
      'Al comenzar un nuevo ciclo creas otro año y abres secciones nuevas; el historial del anterior se conserva.',
    ],
  },
  structure: {
    intro:
      'Registra los grados que ofrece el colegio (ej. "Sala 5", "3er grado", "1er año"). Al crear cada grado eliges su nivel educativo, y el nivel define el personal docente de sus secciones:',
    links: [
      `Inicial — ${LEVELS.initial.rule}`,
      `Primaria — ${LEVELS.primary.rule}`,
      `Secundaria — ${LEVELS.secondary.rule}`,
      'Las aulas físicas son opcionales: solo sirven para indicar dónde funciona cada sección.',
    ],
  },
  sections: {
    intro: 'Crea las secciones del año en curso (ej. "3er grado A") y asígnales su personal docente según el nivel de su grado:',
    links: [
      'Inicial: docente y docente auxiliar. Primaria: docente. Secundaria: docente guía.',
      'Al crear una sección se abre directamente la asignación de su personal docente.',
      'Las materias de cada sección y sus docentes se asignan en el módulo de Materias.',
      'Después, inscribe a los alumnos desde el detalle de cada sección.',
    ],
  },
};

/** Rutas de las dos vistas de la estructura académica. */
export const INITIAL_SETUP_PATH = '/configuracion-inicial';
export const ACADEMIC_SECTIONS_PATH = '/secciones-academicas';
