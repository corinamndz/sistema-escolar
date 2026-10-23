const f = require('../fields');
const studentService = require('../../students/student.service');

const RELATIONSHIPS = ['Madre', 'Padre', 'Representante Legal', 'Tutor / Familiar', 'Otro'];
const PRIMARY_OPTIONS = ['Automático', 'Sí', 'No'];
const MAX_CHILDREN = 15;

// Cédula sin la letra de nacionalidad: "V30111222" → "30111222".
const digitsOf = (key) => String(key || '').replace(/^[A-Z]+/, '');
const hasLetter = (key) => /^[A-Z]/.test(String(key || ''));

/** "V-30.111.222, V-30111333; 31222333" → ['V-30.111.222', 'V-30111333', '31222333'] */
const splitIds = (v) =>
  String(v ?? '')
    .split(/[,;\n/]+/)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Representantes, opcionalmente vinculados a sus hijos o representados YA
 * registrados (columna "Cédula(s) de los hijos", separadas por comas). Los
 * vínculos van a student_guardians (N:M), igual que al elegirlos en el
 * formulario: un alumno puede tener varios representantes y viceversa.
 *
 * Representante principal de cada hijo:
 *   Automático (por defecto) → lo es si el alumno aún no tiene principal;
 *   Sí → pasa a ser el principal (reemplaza al anterior); No → no lo es.
 */
module.exports = {
  type: 'guardians',
  label: 'Representantes',
  noun: { one: 'representante', many: 'representantes' },
  permission: ['guardians', 'create'],
  fileName: 'plantilla-representantes.xlsx',

  async prepare(trx, tenantId, params, actor = {}) {
    const existing = await trx('guardians')
      .where({ tenant_id: tenantId })
      .whereNotNull('national_id')
      .select('first_name', 'last_name', trx.raw(`${f.ID_KEY_SQL('national_id')} AS k`));
    const students = await trx('students as s')
      .where({ 's.tenant_id': tenantId })
      .whereNotNull('s.national_id')
      .select(
        's.id',
        's.first_name',
        's.last_name',
        's.national_id',
        trx.raw(`${f.ID_KEY_SQL('s.national_id')} AS k`),
        trx.raw('EXISTS (SELECT 1 FROM student_guardians sg WHERE sg.student_id = s.id AND sg.is_primary) AS has_primary')
      );
    const studentsByKey = new Map();
    students.forEach((s) => studentsByKey.set(s.k, [...(studentsByKey.get(s.k) || []), s]));
    // Respaldo por dígitos: "V-31222333" en el archivo y "31222333" guardado (o al revés) son la misma cédula.
    const studentsByDigits = new Map();
    students.forEach((s) => studentsByDigits.set(digitsOf(s.k), [...(studentsByDigits.get(digitsOf(s.k)) || []), s]));
    // Vincular alumnos es editar alumnos (mismo permiso que en el formulario del representante).
    const canLink = Boolean(actor.permissions?.students?.can_update);

    const columns = [
      { key: 'firstName', header: 'Nombres', required: true, width: 20, note: 'Nombres del representante. Máx. 100 caracteres.' },
      { key: 'lastName', header: 'Apellidos', required: true, width: 20, note: 'Apellidos del representante. Máx. 100 caracteres.' },
      { key: 'nationalId', header: 'Cédula', required: true, text: true, width: 16, note: 'Ej.: V-15123456. No puede repetirse con otro representante.', aliases: ['Documento'] },
      { key: 'phone', header: 'Teléfono', text: true, width: 16, note: 'Opcional. Máx. 30 caracteres.' },
      { key: 'email', header: 'Correo', width: 26, note: 'Opcional. Se usa para enviar los comprobantes de pago.' },
      {
        key: 'children',
        header: 'Cédula(s) de los hijos',
        text: true,
        width: 30,
        aliases: ['Cédulas de los hijos', 'Cédula de los hijos', 'Hijos', 'Cédulas de los alumnos'],
        note: `Opcional: puede quedar vacía (el representante se registra sin alumnos). Cédulas de los alumnos que representa, separadas por comas (máx. ${MAX_CHILDREN}); deben estar registrados antes, con su cédula.`,
      },
      { key: 'relationship', header: 'Relación', options: RELATIONSHIPS, width: 20, note: `Con los hijos indicados (la misma para todos). Sugeridas: ${RELATIONSHIPS.join(', ')}.` },
      {
        key: 'primary',
        header: 'Representante principal',
        options: PRIMARY_OPTIONS,
        width: 22,
        note: 'Automático (vacío): será el principal de los hijos que aún no tengan uno. Sí: pasa a ser el principal. No: no lo es. El principal recibe las mensualidades.',
      },
    ];

    return {
      columns,
      canLink,
      existingIds: new Map(existing.map((g) => [g.k, `${g.first_name} ${g.last_name}`])),
      studentsByKey,
      studentsByDigits,
      template: {
        title: 'Plantilla de carga masiva de representantes',
        instructions: [
          'Registra primero a los alumnos (con su cédula): aquí solo se escriben sus cédulas para vincularlos.',
          'Un alumno puede tener varios representantes (madre, padre, tutor): pon su cédula en la fila de cada uno.',
          'Los usuarios del portal de padres no se crean desde este archivo: actívalos luego desde la ficha de cada representante.',
        ],
        examples: [
          { firstName: 'Carmen', lastName: 'Pérez González', nationalId: 'V-14555666', phone: '0414-1112233', email: 'carmen@correo.com', children: 'V-30111222, V-30111333', relationship: 'Madre', primary: 'Automático' },
          { firstName: 'José', lastName: 'Pérez', nationalId: 'V-13444555', phone: '0412-9998877', email: '', children: 'V-30111222', relationship: 'Padre', primary: 'No' },
          { firstName: 'Laura', lastName: 'Gómez', nationalId: 'V-12333444', phone: '', email: '', children: '', relationship: '', primary: '' },
        ],
      },
    };
  },

  validate(v, ctx, state) {
    const notes = [];
    const { data, errors } = f.collect({
      firstName: [f.text, v.firstName, { max: 100, required: true, label: 'Nombres' }],
      lastName: [f.text, v.lastName, { max: 100, required: true, label: 'Apellidos' }],
      nationalId: [f.nationalId, v.nationalId, { label: 'El campo Cédula', required: true }],
      phone: [f.text, v.phone, { max: 30, label: 'El teléfono' }],
      email: [f.email, v.email, { label: 'El correo' }],
      relationship: [f.text, v.relationship, { max: 30, label: 'La relación' }],
      primary: [f.option, v.primary, { options: { Automático: 'auto', Sí: 'yes', No: 'no' }, aliases: { Si: 'yes', Auto: 'auto', X: 'yes' }, label: 'Representante principal' }],
    });
    data.primary ||= 'auto';
    const label = [data.firstName, data.lastName].filter(Boolean).join(' ') || null;

    // Cédula única: contra la base y contra las filas anteriores del archivo.
    if (data.nationalId) {
      const k = f.idKey(data.nationalId);
      state.ids ||= new Map();
      if (ctx.existingIds.has(k)) {
        errors.push({
          column: 'nationalId',
          reason: 'cédula duplicada',
          message: `Ya existe el representante ${ctx.existingIds.get(k)} con la cédula ${data.nationalId}. Para asociarle alumnos, edítalo en Representantes.`,
        });
      } else if (state.ids.has(k)) {
        errors.push({ column: 'nationalId', reason: 'cédula duplicada', message: `La cédula ${data.nationalId} está repetida en la fila ${state.ids.get(k)}.` });
      } else {
        state.ids.set(k, state.row);
      }
    }

    // ---- Hijos (vínculo múltiple) ----
    // Columna ESTRICTAMENTE OPCIONAL: vacía, nula, con espacios o solo separadores
    // (o sin la columna en el archivo) = representante sin hijos. No se busca
    // ningún alumno ni se toca student_guardians; Relación y Principal se ignoran.
    const raw = splitIds(v.children);
    data.children = [];
    data.links = [];
    if (!raw.length) {
      if (data.relationship || v.primary) notes.push('Sin cédulas de hijos: se registra sin alumnos (Relación y Principal no se usan)');
      return { data, errors, label, notes };
    }
    if (!ctx.canLink) {
      errors.push({ column: 'children', reason: 'sin permiso', message: 'Para vincular alumnos necesitas permiso para editar Alumnos. Deja la columna vacía o pide ese permiso.' });
    } else if (raw.length > MAX_CHILDREN) {
      errors.push({ column: 'children', message: `Máximo ${MAX_CHILDREN} alumnos por representante (hay ${raw.length}).` });
    } else {
      const invalid = [];
      const missing = [];
      const ambiguous = [];
      const seen = new Set();
      for (const id of raw) {
        const parsed = f.nationalId(id, { label: 'La cédula' });
        if (parsed.error) {
          invalid.push(id);
          continue;
        }
        const k = f.idKey(parsed.value);
        if (seen.has(k)) continue; // repetida en la misma celda: se toma una vez
        seen.add(k);
        // Exacta; si no, por dígitos cuando a uno de los dos le falta la letra (V-/E- distintas no se mezclan).
        let found = ctx.studentsByKey.get(k) || [];
        if (!found.length) found = (ctx.studentsByDigits.get(digitsOf(k)) || []).filter((s) => !hasLetter(s.k) || !hasLetter(k));
        if (!found.length) missing.push(parsed.value);
        else if (found.length > 1) ambiguous.push(parsed.value);
        else data.children.push(found[0]);
      }
      if (invalid.length) errors.push({ column: 'children', message: `Cédula(s) con formato inválido: ${invalid.join(', ')}.` });
      if (missing.length) {
        errors.push({
          column: 'children',
          reason: 'alumno no registrado',
          message: `No hay alumnos con la(s) cédula(s) ${missing.join(', ')}. Regístralos primero en Alumnos (con su cédula).`,
        });
      }
      if (ambiguous.length) errors.push({ column: 'children', reason: 'alumno ambiguo', message: `Hay más de un alumno con la cédula ${ambiguous.join(', ')}: asócialo desde el formulario.` });
    }

    // Principal de cada hijo (considerando las filas anteriores del archivo).
    if (data.children.length && errors.length === 0) {
      state.primaryBy ||= new Map(); // studentId → fila que lo marcó principal
      data.links = data.children.map((s) => {
        const earlier = state.primaryBy.get(s.id);
        let isPrimary;
        if (data.primary === 'yes') {
          if (earlier) {
            errors.push({ column: 'primary', reason: 'principal repetido', message: `${s.first_name} ${s.last_name} ya tiene principal en la fila ${earlier}: marca "No" en una de las dos.` });
          }
          isPrimary = true;
        } else {
          isPrimary = data.primary === 'auto' && !s.has_primary && !earlier;
        }
        if (isPrimary) state.primaryBy.set(s.id, state.row);
        return { studentId: s.id, relationship: data.relationship || null, isPrimary };
      });
      const names = data.children.map((s) => `${s.first_name} ${s.last_name}`);
      notes.push(`Representará a ${names.join(', ')}`);
      const principalOf = data.links.filter((l) => l.isPrimary).map((l) => data.children.find((s) => s.id === l.studentId));
      if (principalOf.length) {
        const replaced = principalOf.filter((s) => s.has_primary);
        notes.push(`Principal de ${principalOf.map((s) => s.first_name).join(', ')}${replaced.length ? ` (reemplaza al principal actual de ${replaced.map((s) => s.first_name).join(', ')})` : ''}`);
      }
    }

    return { data, errors, label, notes };
  },

  async insert(trx, tenantId, data) {
    const guardian = await studentService.createGuardian(trx, tenantId, {
      firstName: data.firstName,
      lastName: data.lastName,
      nationalId: data.nationalId,
      phone: data.phone || null,
      email: data.email || null,
      // Vínculos N:M en la misma transacción (y mensualidades de los inscritos sin responsable).
      students: data.links?.length ? data.links : undefined,
    });
    const notes = data.links?.length ? [`${data.links.length} alumno${data.links.length === 1 ? '' : 's'} vinculado${data.links.length === 1 ? '' : 's'}`] : [];
    return { id: guardian.id, notes };
  },
};
