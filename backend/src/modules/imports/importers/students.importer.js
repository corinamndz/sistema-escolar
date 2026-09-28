const f = require('../fields');
const { normalizeHeader } = require('../excel');
const studentService = require('../../students/student.service');
const academicService = require('../../academics/academic.service');

const RELATIONSHIPS = ['Madre', 'Padre', 'Representante Legal', 'Tutor / Familiar', 'Otro'];
const sectionKey = (grade, section) => `${normalizeHeader(grade)}|${normalizeHeader(section)}`;

/**
 * Alumnos, opcionalmente vinculados a un representante YA registrado (por
 * cédula) e inscritos en una sección del año escolar activo. Al inscribir se
 * generan sus mensualidades igual que en la inscripción manual.
 */
module.exports = {
  type: 'students',
  label: 'Alumnos',
  noun: { one: 'alumno', many: 'alumnos' },
  permission: ['students', 'create'],
  fileName: 'plantilla-alumnos.xlsx',

  async prepare(trx, tenantId) {
    const today = (await trx.raw("SELECT to_char(current_date, 'YYYY-MM-DD') AS d")).rows[0].d;

    const existingIds = await trx('students')
      .where({ tenant_id: tenantId })
      .whereNotNull('national_id')
      .select(trx.raw(`${f.ID_KEY_SQL('national_id')} AS k`));

    const guardians = await trx('guardians')
      .where({ tenant_id: tenantId })
      .whereNotNull('national_id')
      .select('id', 'first_name', 'last_name', trx.raw(`${f.ID_KEY_SQL('national_id')} AS k`));
    const guardiansByKey = new Map();
    guardians.forEach((g) => guardiansByKey.set(g.k, [...(guardiansByKey.get(g.k) || []), g]));

    const sections = await trx('sections as sec')
      .join('grades as g', 'g.id', 'sec.grade_id')
      .join('school_periods as sp', 'sp.id', 'sec.school_period_id')
      .where({ 'sec.tenant_id': tenantId, 'sp.is_active': true })
      .select(
        'sec.id',
        'sec.name',
        'sec.max_students',
        'g.name as grade_name',
        'sp.name as period_name',
        trx.raw("(SELECT count(*)::int FROM enrollments e WHERE e.section_id = sec.id AND e.status = 'active') AS enrolled")
      );
    const sectionsByKey = new Map();
    sections.forEach((s) => {
      const k = sectionKey(s.grade_name, s.name);
      sectionsByKey.set(k, [...(sectionsByKey.get(k) || []), s]);
    });

    const gradeNames = [...new Set(sections.map((s) => s.grade_name))];
    const sectionHint = sections.length
      ? `Secciones del año activo: ${sections
          .slice(0, 12)
          .map((s) => `${s.grade_name} ${s.name}`)
          .join(', ')}${sections.length > 12 ? '…' : ''}.`
      : 'Todavía no hay secciones en el año escolar activo: deja Grado y Sección vacíos e inscribe después.';

    const columns = [
      { key: 'firstName', header: 'Nombres', required: true, width: 20, note: 'Nombres del alumno. Máx. 100 caracteres.' },
      { key: 'lastName', header: 'Apellidos', required: true, width: 20, note: 'Apellidos del alumno. Máx. 100 caracteres.' },
      {
        key: 'nationalId',
        header: 'Cédula',
        text: true,
        note: 'Opcional. Ej.: V-30123456 o la cédula escolar. No puede repetirse con otro alumno.',
        aliases: ['Cédula escolar', 'Documento'],
      },
      { key: 'birthDate', header: 'Fecha de nacimiento', date: true, width: 20, note: 'Opcional. Formato DD/MM/AAAA. No puede ser futura.' },
      {
        key: 'grade',
        header: 'Grado',
        options: gradeNames.length ? gradeNames : undefined,
        width: 18,
        note: `Opcional: para inscribir al alumno. Escribe el grado tal como está en el sistema (ej. "1er grado"). Va junto con Sección. ${sectionHint}`,
      },
      { key: 'section', header: 'Sección', text: true, note: 'Opcional: letra o nombre de la sección (ej. "A"). Va junto con Grado.' },
      {
        key: 'guardianNationalId',
        header: 'Cédula del representante',
        text: true,
        width: 24,
        note: 'Opcional. El representante debe estar registrado antes en Representantes; se busca por esta cédula.',
      },
      {
        key: 'relationship',
        header: 'Relación',
        options: RELATIONSHIPS,
        width: 20,
        note: `Obligatoria si indicas representante. Valores sugeridos: ${RELATIONSHIPS.join(', ')}.`,
      },
      {
        key: 'isPrimary',
        header: 'Representante principal',
        options: ['Sí', 'No'],
        width: 22,
        note: 'Sí/No. Por defecto Sí. El principal es quien recibe las mensualidades.',
      },
    ];

    return {
      today,
      columns,
      existingIds: new Set(existingIds.map((r) => r.k)),
      guardiansByKey,
      sectionsByKey,
      template: {
        title: 'Plantilla de carga masiva de alumnos',
        instructions: [
          'Si indicas Grado y Sección, el alumno queda inscrito en esa sección del año escolar activo y se generan sus mensualidades.',
          'Los representantes no se crean desde este archivo: regístralos primero y aquí solo escribe su cédula.',
        ],
        examples: [
          {
            firstName: 'María José',
            lastName: 'Pérez González',
            nationalId: 'V-32123456',
            birthDate: '14/03/2016',
            grade: gradeNames[0] || '3er grado',
            section: 'A',
            guardianNationalId: 'V-15123456',
            relationship: 'Madre',
            isPrimary: 'Sí',
          },
          { firstName: 'Luis', lastName: 'Rodríguez', nationalId: '', birthDate: '02/11/2019', grade: '', section: '', guardianNationalId: '', relationship: '', isPrimary: '' },
        ],
      },
    };
  },

  validate(v, ctx, state) {
    const { data, errors } = f.collect({
      firstName: [f.text, v.firstName, { max: 100, required: true, label: 'Nombres' }],
      lastName: [f.text, v.lastName, { max: 100, required: true, label: 'Apellidos' }],
      nationalId: [f.nationalId, v.nationalId, { label: 'La cédula' }],
      birthDate: [f.date, v.birthDate, { label: 'La fecha de nacimiento', notFuture: true, today: ctx.today }],
      grade: [f.text, v.grade, { max: 100, label: 'El grado' }],
      section: [f.text, v.section, { max: 20, label: 'La sección' }],
      guardianNationalId: [f.nationalId, v.guardianNationalId, { label: 'La cédula del representante' }],
      relationship: [f.text, v.relationship, { max: 30, label: 'La relación' }],
      isPrimary: [f.yesNo, v.isPrimary, { label: 'Representante principal', defaultValue: true }],
    });
    const label = [data.firstName, data.lastName].filter(Boolean).join(' ') || null;

    // Cédula única: contra la base y contra las filas anteriores del archivo.
    if (data.nationalId) {
      const k = f.idKey(data.nationalId);
      state.ids ||= new Map(); // clave → fila donde apareció primero
      if (ctx.existingIds.has(k)) {
        errors.push({ column: 'nationalId', reason: 'cédula duplicada', message: `Ya existe un alumno con la cédula ${data.nationalId}.` });
      } else if (state.ids.has(k)) {
        errors.push({ column: 'nationalId', reason: 'cédula duplicada', message: `La cédula ${data.nationalId} está repetida en la fila ${state.ids.get(k)}.` });
      } else {
        state.ids.set(k, state.row);
      }
    }

    // Representante existente.
    if (data.guardianNationalId) {
      const found = ctx.guardiansByKey.get(f.idKey(data.guardianNationalId)) || [];
      if (found.length === 0) {
        errors.push({
          column: 'guardianNationalId',
          reason: 'representante no registrado',
          message: `No hay un representante con la cédula ${data.guardianNationalId}. Regístralo primero en Representantes.`,
        });
      } else if (found.length > 1) {
        errors.push({
          column: 'guardianNationalId',
          reason: 'representante ambiguo',
          message: `Hay ${found.length} representantes con la cédula ${data.guardianNationalId}; asócialo manualmente.`,
        });
      } else {
        data.guardian = found[0];
      }
      if (!data.relationship) errors.push({ column: 'relationship', message: 'Indica la relación con el representante (ej. Madre).' });
    } else if (data.relationship) {
      errors.push({ column: 'guardianNationalId', message: 'Escribiste una relación pero no la cédula del representante.' });
    }

    // Sección del año activo (Grado + Sección van juntos).
    if (Boolean(data.grade) !== Boolean(data.section)) {
      errors.push({ column: data.grade ? 'section' : 'grade', message: 'Para inscribir indica Grado y Sección juntos (o deja ambos vacíos).' });
    } else if (data.grade) {
      const found = ctx.sectionsByKey.get(sectionKey(data.grade, data.section)) || [];
      if (found.length === 0) {
        errors.push({
          column: 'section',
          reason: 'sección inexistente',
          message: `No existe la sección "${data.grade} ${data.section}" en el año escolar activo.`,
        });
      } else if (found.length > 1) {
        errors.push({
          column: 'section',
          reason: 'sección ambigua',
          message: `"${data.grade} ${data.section}" existe en varios años activos (${found.map((s) => s.period_name).join(', ')}). Cierra los años anteriores o inscribe manualmente.`,
        });
      } else {
        data.sectionRef = found[0];
      }
    }

    // Cupo: cuenta también los alumnos de este mismo archivo (solo filas válidas).
    if (data.sectionRef && errors.length === 0) {
      state.used ||= {};
      const s = data.sectionRef;
      const used = state.used[s.id] || 0;
      if (s.enrolled + used >= s.max_students) {
        errors.push({
          column: 'section',
          reason: 'sección sin cupo',
          message: `La sección ${s.grade_name} ${s.name} ya no tiene cupo (máximo ${s.max_students}).`,
        });
      } else {
        state.used[s.id] = used + 1;
      }
    }

    return { data, errors, label };
  },

  async insert(trx, tenantId, data) {
    const student = await studentService.createStudent(trx, tenantId, {
      firstName: data.firstName,
      lastName: data.lastName,
      nationalId: data.nationalId || undefined,
      birthDate: data.birthDate || undefined,
    });
    const notes = [];
    // Primero el representante: las mensualidades necesitan un responsable de pago.
    if (data.guardian) {
      await studentService.linkGuardian(trx, tenantId, student.id, {
        guardianId: data.guardian.id,
        relationship: data.relationship,
        isPrimary: data.isPrimary,
      });
    }
    if (data.sectionRef) {
      const enrollment = await academicService.enrollStudent(trx, tenantId, { studentId: student.id, sectionId: data.sectionRef.id });
      notes.push(`Inscrito en ${data.sectionRef.grade_name} ${data.sectionRef.name}`);
      // Sin tarifa configurada o sin representante: la inscripción vale, las cuotas se generan después.
      if (enrollment.tuition?.skipped?.length) notes.push('Mensualidades pendientes de generar');
    }
    return { id: student.id, notes };
  },
};
