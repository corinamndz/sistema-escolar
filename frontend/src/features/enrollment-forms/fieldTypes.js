/**
 * Tipos de campo de las planillas de inscripción (backend:
 * enrollmentForm.service → FIELD_TYPES). `defaults`: cómo nace cada uno al
 * agregarlo en el diseñador.
 */
export const FIELD_TYPES = {
  section: { label: 'Sección', icon: 'layers', hint: 'Título que agrupa preguntas', defaults: { label: 'Nueva sección' } },
  short_text: { label: 'Texto corto', icon: 'type', defaults: { label: 'Pregunta de texto' } },
  long_text: { label: 'Párrafo', icon: 'alignLeft', defaults: { label: 'Pregunta de párrafo' } },
  number: { label: 'Número', icon: 'hash', defaults: { label: 'Pregunta numérica' } },
  date: { label: 'Fecha', icon: 'calendar', defaults: { label: 'Fecha' } },
  email: { label: 'Correo', icon: 'mail', defaults: { label: 'Correo electrónico' } },
  phone: { label: 'Teléfono', icon: 'phone', defaults: { label: 'Teléfono' } },
  select: { label: 'Lista desplegable', icon: 'chevronDown', defaults: { label: 'Elige una opción', options: ['Opción 1', 'Opción 2'] } },
  radio: { label: 'Opción única', icon: 'circleDot', defaults: { label: 'Elige una opción', options: ['Sí', 'No'] } },
  checkboxes: { label: 'Varias opciones', icon: 'listBullet', defaults: { label: 'Marca las que apliquen', options: ['Opción 1', 'Opción 2'] } },
  checkbox: { label: 'Casilla (acepto)', icon: 'checkSquare', defaults: { label: 'Acepto los términos' } },
  // Una por planilla: va en la esquina superior derecha del PDF.
  photo: { label: 'Foto del alumno', icon: 'image', hint: 'Una por planilla', defaults: { label: 'Foto del alumno (tipo carnet)', help: 'De frente, fondo claro. JPG o PNG.' } },
};

/**
 * Datos del sistema que precargan un campo al re-inscribir a un alumno ya
 * registrado (backend: enrollmentForm.service → PREFILL_SOURCES).
 * Sin elegir = automático (se deduce del texto de la pregunta).
 */
const TEXTY = ['short_text', 'long_text'];
export const PREFILL_SOURCES = [
  { key: 'student.first_name', label: 'Alumno · nombres', types: TEXTY },
  { key: 'student.last_name', label: 'Alumno · apellidos', types: TEXTY },
  { key: 'student.full_name', label: 'Alumno · nombre completo', types: TEXTY },
  { key: 'student.national_id', label: 'Alumno · cédula / identificador', types: [...TEXTY, 'number'] },
  { key: 'student.birth_date', label: 'Alumno · fecha de nacimiento', types: ['date'] },
  { key: 'student.grade', label: 'Alumno · grado actual', types: [...TEXTY, 'select', 'radio'] },
  { key: 'student.section', label: 'Alumno · grado y sección actual', types: TEXTY },
  { key: 'guardian.first_name', label: 'Representante · nombres', types: TEXTY },
  { key: 'guardian.last_name', label: 'Representante · apellidos', types: TEXTY },
  { key: 'guardian.full_name', label: 'Representante · nombre completo', types: TEXTY },
  { key: 'guardian.national_id', label: 'Representante · cédula', types: [...TEXTY, 'number'] },
  { key: 'guardian.phone', label: 'Representante · teléfono', types: [...TEXTY, 'phone'] },
  { key: 'guardian.email', label: 'Representante · correo', types: [...TEXTY, 'email'] },
  { key: 'guardian.relationship', label: 'Representante · parentesco', types: [...TEXTY, 'select', 'radio'] },
];
/**
 * De quién son los datos de una SECCIÓN (backend: enrollmentForm.service →
 * sectionScopeOf). Las preguntas heredan el de su sección al precargar: así
 * «Nombre y Apellido» bajo «Representantes» se llena con el representante.
 */
export const SECTION_SCOPES = {
  student: { label: 'Datos del alumno', short: 'Alumno' },
  guardian: { label: 'Datos del representante legal', short: 'Representante' },
  none: { label: 'Otra persona o tema (no precargar)', short: 'No se precarga' },
};
const plain = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
/** Tipo de sección elegido o deducido del título (mismo criterio que el servidor); null = sin pista. */
export function sectionScopeOf(section) {
  if (SECTION_SCOPES[section.scope]) return section.scope;
  const l = plain(`${section.label} ${section.help || ''}`);
  if (/emergencia/.test(l)) return 'none';
  if (/representante|acudiente|tutor|familia|padres|responsable/.test(l)) return 'guardian';
  if (/contacto|salud|medic|alergia|retir|autoriz/.test(l)) return 'none';
  if (/alumno|estudiante|aspirante|nino|nina/.test(l)) return 'student';
  return null;
}

/** Tipos de campo que nunca se precargan con un dato del sistema. */
export const NO_PREFILL = ['section', 'checkbox', 'checkboxes', 'photo'];

export const WITH_OPTIONS = ['select', 'radio', 'checkboxes'];
export const WITH_PLACEHOLDER = ['short_text', 'long_text', 'number', 'email', 'phone'];

/** Identificador único y estable para un campo nuevo (a-z, 0-9, _). */
export const newFieldId = (type) => `${type.slice(0, 6)}_${Math.random().toString(36).slice(2, 8)}`;

export const newField = (type) => ({ id: newFieldId(type), type, ...structuredClone(FIELD_TYPES[type].defaults), ...(type !== 'section' ? { required: false } : {}) });

export const SUBMISSION_STATUS = {
  // Asignada al representante al promover al alumno; aún no la llena (no cuenta como recibida).
  pending: { label: 'Por llenar', variant: 'info' },
  submitted: { label: 'En revisión', variant: 'warning' },
  changes_requested: { label: 'Por corregir', variant: 'danger' },
  approved: { label: 'Aprobada', variant: 'success' },
  rejected: { label: 'Rechazada', variant: 'neutral' },
};

export const FORM_STATUS = {
  draft: { label: 'Borrador', variant: 'neutral' },
  published: { label: 'Publicada', variant: 'success' },
  closed: { label: 'Cerrada', variant: 'warning' },
};

/** Validación en el navegador (la misma regla que el servidor) para marcar errores antes de enviar. */
export function validateLocally(fields, answers) {
  const errors = {};
  fields.forEach((f) => {
    if (f.type === 'section') return;
    const v = answers[f.id];
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) || v === false;
    if (empty) {
      if (f.required) errors[f.id] = f.type === 'checkbox' ? 'Debes marcar esta casilla.' : 'Este campo es obligatorio.';
      return;
    }
    if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim())) errors[f.id] = 'Correo inválido.';
    if (f.type === 'phone' && !/^[0-9+()\-\s.]{7,25}$/.test(String(v).trim())) errors[f.id] = 'Teléfono inválido.';
    if (f.type === 'number' && !Number.isFinite(Number(v))) errors[f.id] = 'Escribe un número.';
  });
  return errors;
}
