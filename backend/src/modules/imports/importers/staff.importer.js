const f = require('../fields');
const staffService = require('../../staff/staff.service');

const STAFF_TYPES = { Docente: 'teaching', Administrativo: 'administrative', Obrero: 'support', Apoyo: 'support' };
/** Disponibilidad del docente por nivel (migración 046). */
const AVAILABILITY = { Inicial: 'initial', Primaria: 'primary', Secundaria: 'secondary', Todos: 'all' };
const AVAILABILITY_ALIASES = { 'Todos los niveles': 'all', 'Educación Inicial': 'initial', 'Educación Primaria': 'primary', 'Educación Secundaria': 'secondary', Preescolar: 'initial', Bachillerato: 'secondary' };

/** Personal del colegio (sin acceso al sistema: el usuario se crea luego desde su ficha). */
module.exports = {
  type: 'staff',
  label: 'Personal',
  noun: { one: 'registro de personal', many: 'registros de personal' },
  permission: ['staff', 'create'],
  fileName: 'plantilla-personal.xlsx',

  async prepare(trx, tenantId) {
    const today = (await trx.raw("SELECT to_char(current_date, 'YYYY-MM-DD') AS d")).rows[0].d;
    const existing = await trx('staff')
      .where({ tenant_id: tenantId })
      .select(trx.raw(`${f.ID_KEY_SQL('national_id')} AS k`), trx.raw('lower(email) AS email'));

    return {
      today,
      existingIds: new Set(existing.map((r) => r.k).filter(Boolean)),
      existingEmails: new Set(existing.map((r) => r.email).filter(Boolean)),
      columns: [
        {
          key: 'staffType',
          header: 'Tipo',
          required: true,
          options: ['Docente', 'Administrativo', 'Obrero'],
          note: 'Docente, Administrativo u Obrero. Solo el personal Docente puede asignarse a secciones y materias.',
        },
        { key: 'firstName', header: 'Nombres', required: true, width: 20, note: 'Máx. 100 caracteres.' },
        { key: 'lastName', header: 'Apellidos', required: true, width: 20, note: 'Máx. 100 caracteres.' },
        { key: 'nationalId', header: 'Cédula', text: true, note: 'Opcional. Ej.: V-12345678. No puede repetirse.' },
        { key: 'phone', header: 'Teléfono', text: true, note: 'Opcional. Ej.: 0414-1234567.' },
        { key: 'email', header: 'Correo', width: 26, note: 'Opcional. Debe ser un correo válido y no repetirse con otro miembro del personal.' },
        { key: 'hiredAt', header: 'Fecha de ingreso', date: true, width: 18, note: 'Opcional. Formato DD/MM/AAAA.' },
        {
          key: 'levelAvailability',
          header: 'Disponibilidad',
          width: 16,
          options: Object.keys(AVAILABILITY),
          note: 'Solo para Docentes: en qué nivel puede trabajar (Inicial, Primaria, Secundaria o Todos). Vacío = Todos. Solo se le podrán asignar secciones de ese nivel.',
        },
      ],
      template: {
        title: 'Plantilla de carga masiva de personal',
        instructions: [
          'El acceso al sistema (usuario y contraseña) se crea después, desde la ficha de cada persona.',
          'Disponibilidad: el nivel en que puede trabajar cada docente. En "Secciones y personal docente" solo aparecerá en las secciones de ese nivel.',
        ],
        examples: [
          { staffType: 'Docente', firstName: 'Ana', lastName: 'Martínez', nationalId: 'V-14567890', phone: '0414-1234567', email: 'ana.martinez@colegio.edu.ve', hiredAt: '15/09/2020', levelAvailability: 'Primaria' },
          { staffType: 'Docente', firstName: 'Luis', lastName: 'Pérez', nationalId: 'V-16345678', phone: '', email: '', hiredAt: '', levelAvailability: 'Todos' },
          { staffType: 'Administrativo', firstName: 'Carlos', lastName: 'Gómez', nationalId: 'V-18234567', phone: '', email: '', hiredAt: '', levelAvailability: '' },
        ],
      },
    };
  },

  validate(v, ctx, state) {
    const { data, errors } = f.collect({
      staffType: [f.option, v.staffType, { options: STAFF_TYPES, label: 'El tipo', required: true }],
      firstName: [f.text, v.firstName, { max: 100, required: true, label: 'Nombres' }],
      lastName: [f.text, v.lastName, { max: 100, required: true, label: 'Apellidos' }],
      nationalId: [f.nationalId, v.nationalId, { label: 'La cédula' }],
      phone: [f.text, v.phone, { max: 30, label: 'El teléfono' }],
      email: [f.email, v.email, { label: 'El correo' }],
      hiredAt: [f.date, v.hiredAt, { label: 'La fecha de ingreso', notFuture: true, today: ctx.today }],
      levelAvailability: [f.option, v.levelAvailability, { options: AVAILABILITY, aliases: AVAILABILITY_ALIASES, label: 'La disponibilidad' }],
    });
    // La disponibilidad es de los docentes: en otro tipo de personal se ignora (con aviso en la vista previa).
    const notes = [];
    if (data.levelAvailability && data.staffType && data.staffType !== 'teaching') {
      notes.push('La disponibilidad solo aplica a docentes: se ignora.');
      data.levelAvailability = null;
    }

    state.ids ||= new Map();
    state.emails ||= new Map();
    if (data.nationalId) {
      const k = f.idKey(data.nationalId);
      if (ctx.existingIds.has(k)) errors.push({ column: 'nationalId', reason: 'cédula duplicada', message: `Ya existe personal con la cédula ${data.nationalId}.` });
      else if (state.ids.has(k)) errors.push({ column: 'nationalId', reason: 'cédula duplicada', message: `Cédula repetida en la fila ${state.ids.get(k)}.` });
      else state.ids.set(k, state.row);
    }
    if (data.email) {
      if (ctx.existingEmails.has(data.email)) errors.push({ column: 'email', reason: 'correo duplicado', message: `Ya existe personal con el correo ${data.email}.` });
      else if (state.emails.has(data.email)) errors.push({ column: 'email', reason: 'correo duplicado', message: `Correo repetido en la fila ${state.emails.get(data.email)}.` });
      else state.emails.set(data.email, state.row);
    }

    return { data, errors, notes, label: [data.firstName, data.lastName].filter(Boolean).join(' ') || null };
  },

  async insert(trx, tenantId, data) {
    const staff = await staffService.create(trx, tenantId, {
      staffType: data.staffType,
      firstName: data.firstName,
      lastName: data.lastName,
      nationalId: data.nationalId || undefined,
      phone: data.phone || undefined,
      email: data.email || undefined,
      hiredAt: data.hiredAt || undefined,
      levelAvailability: data.levelAvailability || 'all',
    });
    return { id: staff.id };
  },
};
