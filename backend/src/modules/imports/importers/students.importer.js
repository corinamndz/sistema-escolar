const f = require('../fields');
const { normalizeHeader } = require('../excel');
const studentService = require('../../students/student.service');
const academicService = require('../../academics/academic.service');

const RELATIONSHIPS = ['Madre', 'Padre', 'Representante Legal', 'Tutor / Familiar', 'Otro'];
const sectionKey = (grade, section) => `${normalizeHeader(grade)}|${normalizeHeader(section)}`;
// Nombres de sección que se ofrecen aunque todavía no existan (carga inicial).
const DEFAULT_SECTION_NAMES = ['A', 'B', 'C', 'D', 'E'];
const NEW_SECTION_CAPACITY = 30;

/**
 * Alumnos, opcionalmente vinculados a un representante YA registrado (por
 * cédula) e inscritos en una sección del año escolar activo. Al inscribir se
 * generan sus mensualidades igual que en la inscripción manual.
 *
 * Grado y Sección salen de la ESTRUCTURA ACADÉMICA (tabla de grados), no de la
 * matrícula: aparecen todos los grados creados, tengan o no secciones o alumnos.
 * Si el grado aún no tiene esa sección en el año activo, se crea al importar
 * (cupo 30), solo si quien importa puede crear estructura académica.
 */
module.exports = {
  type: 'students',
  label: 'Alumnos',
  noun: { one: 'alumno', many: 'alumnos' },
  permission: ['students', 'create'],
  fileName: 'plantilla-alumnos.xlsx',

  async prepare(trx, tenantId, params, actor = {}) {
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
      .join('education_levels as el', 'el.code', 'g.level_code')
      .join('school_periods as sp', 'sp.id', 'sec.school_period_id')
      .where({ 'sec.tenant_id': tenantId, 'sp.is_active': true })
      .orderBy(['el.sort_order', 'g.sort_order', 'g.name', 'sec.name'])
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

    // Tabla maestra de grados: TODOS los del colegio, en orden académico, tengan o
    // no secciones o alumnos (para poder hacer la carga inicial de cualquier grado).
    const grades = await trx('grades as g')
      .join('education_levels as el', 'el.code', 'g.level_code')
      .where('g.tenant_id', tenantId)
      .select('g.id', 'g.name', 'el.name as level_name')
      .orderBy(['el.sort_order', 'g.sort_order', 'g.name']);
    const activePeriods = await trx('school_periods').where({ tenant_id: tenantId, is_active: true }).select('id', 'name');

    // Listas desplegables:
    //   Grado   → todos los grados de la estructura académica.
    //   Sección → nombres de sección existentes en el año activo + A…E (para grados
    //             que aún no tienen secciones). La combinación grado + sección se
    //             valida al importar (Google Sheets no admite listas dependientes con
    //             INDIRECT, así que no se filtra la sección por grado).
    const gradeNames = grades.map((g) => g.name);
    const sectionNames = [...new Set([...sections.map((s) => s.name), ...DEFAULT_SECTION_NAMES])].sort((a, b) =>
      a.localeCompare(b, 'es', { numeric: true })
    );
    const canCreateSections = Boolean(actor.permissions?.academics?.can_create);
    const sectionsByGrade = new Map();
    sections.forEach((s) => sectionsByGrade.set(normalizeHeader(s.grade_name), [...(sectionsByGrade.get(normalizeHeader(s.grade_name)) || []), s]));
    const sectionHint = canCreateSections
      ? 'Si el grado aún no tiene esa sección en el año activo, se crea al importar.'
      : 'La sección debe existir en el año escolar activo (ver hoja Instrucciones).';

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
        strict: true,
        width: 18,
        note: `Opcional: para inscribir al alumno. Elige el grado de la lista (todos los grados del colegio). Va junto con Sección. ${sectionHint}`,
      },
      {
        key: 'section',
        header: 'Sección',
        text: true,
        options: sectionNames.length ? sectionNames : undefined,
        strict: true,
        note: `Opcional: elige la sección de la lista (ej. "A"). Va junto con Grado. ${sectionHint}`,
      },
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
      gradeNames,
      sectionsByGrade,
      gradesByName: new Map(grades.map((g) => [normalizeHeader(g.name), g])),
      sectionNames,
      activePeriods,
      canCreateSections,
      template: {
        title: 'Plantilla de carga masiva de alumnos',
        // Todos los grados: con sus secciones del año activo (y cupos libres) o
        // indicando que la sección se crea al importar.
        guideTables: [
          {
            title: `Grados y secciones (año escolar ${activePeriods.map((p) => p.name).join(', ') || 'sin año activo'})`,
            headers: ['Grado', 'Sección', 'Cupos libres'],
            rows: grades.flatMap((g) => {
              const own = sectionsByGrade.get(normalizeHeader(g.name)) || [];
              if (own.length) return own.map((s) => [g.name, s.name, Math.max(0, s.max_students - s.enrolled)]);
              return [[g.name, canCreateSections ? 'Sin secciones aún: se crea al importar' : 'Sin secciones: créala en Estructura académica', '—']];
            }),
          },
        ],
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
    const notes = []; // lo que hará la importación con esta fila (vista previa)
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
      const gradeSections = ctx.sectionsByGrade.get(normalizeHeader(data.grade)) || [];
      const gradeRef = ctx.gradesByName.get(normalizeHeader(data.grade));
      if (!gradeRef) {
        errors.push({
          column: 'grade',
          reason: 'grado inexistente',
          message: `No existe el grado "${data.grade}" en la estructura académica. Grados disponibles: ${ctx.gradeNames.join(', ') || 'ninguno'}.`,
        });
      } else if (found.length === 0) {
        // El grado existe pero no tiene esa sección en el año activo: se crea al importar.
        const existing = gradeSections.length ? ` Secciones actuales de ${gradeRef.name}: ${gradeSections.map((x) => x.name).join(', ')}.` : '';
        if (ctx.activePeriods.length !== 1) {
          errors.push({
            column: 'section',
            reason: 'sin año escolar activo',
            message: ctx.activePeriods.length
              ? `La sección "${gradeRef.name} ${data.section}" no existe y hay más de un año escolar activo: créala en Estructura académica.`
              : `La sección "${gradeRef.name} ${data.section}" no existe y no hay un año escolar activo donde crearla.`,
          });
        } else if (!ctx.sectionNames.some((n) => normalizeHeader(n) === normalizeHeader(data.section))) {
          // Solo se crean secciones con los nombres que ofrece la lista (A…E o los ya usados):
          // así un error de tipeo pegado en la celda no crea una sección basura.
          errors.push({
            column: 'section',
            reason: 'sección inexistente',
            message: `No existe la sección "${gradeRef.name} ${data.section}".${existing} Al importar solo se crean secciones con los nombres de la lista: ${ctx.sectionNames.join(', ')}.`,
          });
        } else if (!ctx.canCreateSections) {
          errors.push({
            column: 'section',
            reason: 'sección inexistente',
            message: `No existe la sección "${gradeRef.name} ${data.section}" en el año escolar activo.${existing} Créala en Estructura académica (no tienes permiso para crear secciones).`,
          });
        } else {
          const key = sectionKey(gradeRef.name, data.section);
          state.newSections ||= new Map();
          const used = state.newSections.get(key) || 0;
          if (used >= NEW_SECTION_CAPACITY) {
            errors.push({
              column: 'section',
              reason: 'sección sin cupo',
              message: `La sección nueva ${gradeRef.name} ${data.section} tendría más de ${NEW_SECTION_CAPACITY} alumnos: créala con más cupo en Estructura académica.`,
            });
          } else {
            state.newSections.set(key, used + 1);
            // Mismo nombre que la lista si coincide (ej. "a" → "A").
            const name = DEFAULT_SECTION_NAMES.find((n) => normalizeHeader(n) === normalizeHeader(data.section)) || data.section;
            data.newSection = { gradeId: gradeRef.id, gradeName: gradeRef.name, name, schoolPeriodId: ctx.activePeriods[0].id };
            notes.push(`Se creará la sección ${gradeRef.name} ${name} (${ctx.activePeriods[0].name})${used ? '' : `, cupo ${NEW_SECTION_CAPACITY}`}`);
          }
        }
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

    return { data, errors, label, notes };
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
    if (data.newSection) {
      // Otra fila de este archivo puede haberla creado ya: se busca primero (sin distinguir mayúsculas).
      const ns = data.newSection;
      let section = await trx('sections')
        .where({ tenant_id: tenantId, grade_id: ns.gradeId, school_period_id: ns.schoolPeriodId })
        .whereRaw('lower(name) = lower(?)', [ns.name])
        .first();
      if (!section) {
        section = await academicService.createSection(trx, tenantId, {
          gradeId: ns.gradeId,
          schoolPeriodId: ns.schoolPeriodId,
          name: ns.name,
          maxStudents: NEW_SECTION_CAPACITY,
        });
        notes.push(`Sección ${ns.gradeName} ${ns.name} creada`);
      }
      data.sectionRef = { id: section.id, grade_name: ns.gradeName, name: section.name };
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
