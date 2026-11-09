const { ApiError } = require('../../utils/ApiError');
const { notify } = require('../notifications/notify');
const forms = require('./enrollmentForm.service');
const students = require('../students/student.service');
const academics = require('../academics/academic.service');

/**
 * Aprobación de una planilla de inscripción con alta automática.
 *
 * Al aprobar, en UNA transacción (la de la petición: tenantMiddleware abre una
 * transacción por request y la confirma solo si todo salió bien; cualquier
 * error revierte también el alta del alumno, del representante y la matrícula):
 *   1. Alumno: se crea (aspirante nuevo) o se actualiza su ficha (re-inscripción).
 *   2. Representantes: el representante legal de la planilla se busca por cédula
 *      o correo; si no existe se crea. Se vincula como PRINCIPAL con su
 *      parentesco. Quien envió la planilla también queda vinculado.
 *   3. Matrícula: se inscribe en la sección elegida del año escolar de la
 *      planilla (con control de cupo y mensualidades, como en Secciones).
 *   4. La planilla pasa a «Aprobada» y el representante recibe el aviso.
 */

const RELATIONSHIPS = ['Madre', 'Padre', 'Representante Legal', 'Tutor / Familiar', 'Otro'];
const digits = (v) => String(v || '').replace(/\D/g, '');
const clean = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

/**
 * Nombre completo → nombres y apellidos (los dos últimos son apellidos).
 * Las partículas van con la palabra que sigue:
 *   «Andrés Blanco Moreno»          → Andrés | Blanco Moreno
 *   «Mariela Lugo de Pérez»         → Mariela | Lugo de Pérez
 *   «María de los Ángeles Díaz Paz» → María de los Ángeles | Díaz Paz
 */
const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'da', 'van', 'von', 'di']);
function splitName(full) {
  const units = [];
  let pending = [];
  for (const w of String(full || '').trim().split(/\s+/).filter(Boolean)) {
    if (PARTICLES.has(w.toLowerCase())) pending.push(w);
    else {
      units.push([...pending, w].join(' '));
      pending = [];
    }
  }
  if (pending.length) units.push(pending.join(' '));
  if (units.length <= 1) return { first: units[0] || '', last: '' };
  if (units.length === 2) return { first: units[0], last: units[1] };
  return { first: units.slice(0, -2).join(' '), last: units.slice(-2).join(' ') };
}

/** Parentesco escrito libremente → uno de la lista del sistema. */
function toRelationship(v) {
  const n = forms.norm(v);
  if (!n) return null;
  const hit = RELATIONSHIPS.find((r) => forms.norm(r) === n);
  if (hit) return hit;
  if (/madre|mama/.test(n)) return 'Madre';
  if (/padre|papa/.test(n)) return 'Padre';
  if (/legal/.test(n)) return 'Representante Legal';
  if (/tio|tia|abuel|herman|primo|prima|tutor|familiar/.test(n)) return 'Tutor / Familiar';
  return 'Otro';
}

/**
 * Lee de las respuestas los datos del alumno, del representante y el grado
 * solicitado (mismo criterio que la precarga: el dato elegido en el diseñador
 * o el deducido del texto de la pregunta).
 */
function extract(fields = [], answers = {}) {
  const out = { student: {}, guardian: {}, requestedGrade: null };
  // Dato de cada pregunta según su sección (también las marcadas «no precargar»: aquí solo se leen).
  const keys = forms.prefillMap(fields.map((f) => (f.prefill === 'none' ? { ...f, prefill: undefined } : f)));
  for (const f of fields) {
    const v = answers[f.id];
    if (v === undefined || v === null || v === '') continue;
    const l = forms.norm(f.label);
    if (['select', 'radio', 'short_text'].includes(f.type) && /grado|ano|curso|nivel/.test(l) && /aspira|solicita|cursara|inscrib|proximo|ingres/.test(l)) {
      out.requestedGrade = out.requestedGrade || String(v);
      continue;
    }
    const key = keys[f.id];
    if (!key) continue;
    const [who, attr] = key.split('.');
    if (out[who] && out[who][attr] === undefined) out[who][attr] = String(v);
  }
  for (const who of ['student', 'guardian']) {
    const p = out[who];
    if (p.full_name && (!p.first_name || !p.last_name)) {
      const s = splitName(p.full_name);
      p.first_name = p.first_name || s.first;
      p.last_name = p.last_name || s.last;
    }
  }
  return out;
}

const guardianRow = (trx) => ['g.id', 'g.first_name', 'g.last_name', 'g.national_id', 'g.phone', 'g.email', 'g.user_id'];

/** Representante ya registrado con esa cédula (solo dígitos) o, si no, con ese correo. */
async function findGuardian(trx, tenantId, { nationalId, email }) {
  const ced = digits(nationalId);
  if (ced.length >= 5) {
    const g = await trx('guardians as g').where('g.tenant_id', tenantId).whereRaw("regexp_replace(coalesce(g.national_id, ''), '\\D', '', 'g') = ?", [ced]).first(guardianRow(trx));
    if (g) return { ...g, via: 'cédula' };
  }
  if (email && /@/.test(email)) {
    const g = await trx('guardians as g').where('g.tenant_id', tenantId).whereRaw('lower(g.email) = lower(?)', [email.trim()]).first(guardianRow(trx));
    if (g) return { ...g, via: 'correo' };
  }
  return null;
}

/** Alumnos que podrían ser el mismo aspirante (misma cédula, o mismo nombre y fecha de nacimiento). */
async function possibleDuplicates(trx, tenantId, { nationalId, firstName, lastName, birthDate }) {
  const ced = digits(nationalId);
  const rows = await trx('students as s')
    .where('s.tenant_id', tenantId)
    .andWhere((q) => {
      if (ced.length >= 5) q.orWhereRaw("regexp_replace(coalesce(s.national_id, ''), '\\D', '', 'g') = ?", [ced]);
      if (firstName && lastName && birthDate) {
        q.orWhereRaw('lower(trim(s.first_name)) = lower(trim(?)) AND lower(trim(s.last_name)) = lower(trim(?)) AND s.birth_date = ?', [firstName, lastName, birthDate]);
      }
      if (ced.length < 5 && !(firstName && lastName && birthDate)) q.whereRaw('false');
    })
    .limit(3)
    .select('s.id', 's.first_name', 's.last_name', 's.national_id', 's.birth_date', 's.status');
  return rows.map((r) => ({ ...r, via: ced.length >= 5 && digits(r.national_id) === ced ? 'cédula' : 'nombre y fecha de nacimiento' }));
}

/** Secciones del año escolar de la planilla, con cupo. */
function periodSections(trx, tenantId, periodId) {
  return trx('sections as sec')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .leftJoin('education_levels as el', 'el.code', 'g.level_code')
    .where({ 'sec.tenant_id': tenantId, 'sec.school_period_id': periodId })
    .orderBy(['el.sort_order', 'g.sort_order', 'g.name', 'sec.name'])
    .select(
      'sec.id',
      'sec.name',
      'sec.max_students',
      'g.id as grade_id',
      'g.name as grade_name',
      'el.name as level_name',
      trx.raw("(SELECT count(*)::int FROM enrollments e WHERE e.section_id = sec.id AND e.status = 'active') AS enrolled_count")
    );
}

/** Sección donde el alumno ya cursa ese año escolar (si la tiene). */
function activeEnrollmentIn(trx, studentId, periodId) {
  return trx('enrollments as e')
    .join('sections as sec', 'sec.id', 'e.section_id')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .where({ 'e.student_id': studentId, 'e.status': 'active', 'sec.school_period_id': periodId })
    .first('e.id', 'sec.id as section_id', 'sec.name as section_name', 'g.name as grade_name');
}

/**
 * Propuesta de aprobación para el panel del administrador: qué alumno se
 * creará o actualizará, dónde se matricula y qué representantes se vinculan.
 */
async function approvalDraft(trx, tenantId, id) {
  const sub = await forms.getSubmission(trx, tenantId, id);
  const form = await forms.loadForm(trx, tenantId, sub.form_id);
  const data = extract(sub.fields_snapshot, sub.answers);
  const submitter = await trx('guardians as g').where('g.id', sub.guardian_id).first(guardianRow(trx));

  // ---- Alumno ----
  let student;
  if (sub.student_id) {
    const row = await trx('students').where({ id: sub.student_id }).first();
    student = {
      mode: 'existing',
      id: row.id,
      record: { firstName: row.first_name, lastName: row.last_name, nationalId: row.national_id, birthDate: row.birth_date },
      firstName: data.student.first_name || row.first_name,
      lastName: data.student.last_name || row.last_name,
      nationalId: data.student.national_id || row.national_id || '',
      birthDate: data.student.birth_date || row.birth_date || '',
      duplicates: [],
    };
  } else {
    const s = splitName(sub.applicant_name);
    student = {
      mode: 'new',
      id: null,
      firstName: data.student.first_name || s.first,
      lastName: data.student.last_name || s.last,
      nationalId: data.student.national_id || '',
      birthDate: data.student.birth_date || '',
    };
    student.duplicates = await possibleDuplicates(trx, tenantId, student);
  }

  // ---- Matrícula ----
  const sections = await periodSections(trx, tenantId, form.school_period_id);
  const current = sub.student_id ? await activeEnrollmentIn(trx, sub.student_id, form.school_period_id) : null;
  const wanted = forms.norm(data.requestedGrade);
  const grade = wanted ? sections.find((s) => forms.norm(s.grade_name) === wanted) || sections.find((s) => forms.norm(s.grade_name).includes(wanted) || wanted.includes(forms.norm(s.grade_name))) : null;
  const free = (s) => s.enrolled_count < s.max_students;
  const suggested = current ? sections.find((s) => s.id === current.section_id) : grade ? sections.filter((s) => s.grade_id === grade.grade_id).find(free) || null : null;

  // ---- Representantes ----
  const fromForm = data.guardian;
  const hasLegal = Boolean(fromForm.first_name || fromForm.national_id || fromForm.email);
  const legalIn = hasLegal
    ? {
        firstName: fromForm.first_name || '',
        lastName: fromForm.last_name || '',
        nationalId: fromForm.national_id || '',
        phone: fromForm.phone || '',
        email: fromForm.email || '',
      }
    : { firstName: submitter.first_name, lastName: submitter.last_name, nationalId: submitter.national_id || '', phone: submitter.phone || '', email: submitter.email || '' };
  const match = hasLegal ? await findGuardian(trx, tenantId, legalIn) : { ...submitter, via: 'cuenta' };
  const links = sub.student_id ? await trx('student_guardians').where({ student_id: sub.student_id }).select('guardian_id', 'relationship', 'is_primary') : [];
  const linkOf = (gid) => links.find((l) => l.guardian_id === gid) || null;
  const legal = {
    ...legalIn,
    relationship: toRelationship(fromForm.relationship) || linkOf(match?.id)?.relationship || 'Representante Legal',
    match: match ? { id: match.id, name: `${match.first_name} ${match.last_name}`, via: match.via, nationalId: match.national_id, email: match.email } : null,
    isSubmitter: match?.id === submitter.id,
    linked: Boolean(match && linkOf(match.id)),
  };

  return {
    submissionId: sub.id,
    status: sub.status,
    form: { id: form.id, title: form.title, schoolPeriodId: form.school_period_id, schoolPeriodName: form.school_period_name, periodClosed: Boolean(form.period_closed_at) },
    student,
    placement: { requestedGrade: data.requestedGrade, suggestedSectionId: suggested?.id || null, current: current || null, sections },
    legal,
    submitter: {
      id: submitter.id,
      name: `${submitter.first_name} ${submitter.last_name}`,
      nationalId: submitter.national_id,
      email: submitter.email,
      linked: Boolean(linkOf(submitter.id)),
      relationship: linkOf(submitter.id)?.relationship || null,
    },
    relationships: RELATIONSHIPS,
  };
}

/** Crea o actualiza el vínculo alumno ↔ representante; `primary` le quita la marca al anterior. */
async function upsertLink(trx, studentId, guardianId, { relationship, primary }) {
  if (primary) await trx('student_guardians').where({ student_id: studentId }).whereNot({ guardian_id: guardianId }).update({ is_primary: false });
  const existing = await trx('student_guardians').where({ student_id: studentId, guardian_id: guardianId }).first();
  if (existing) {
    const patch = {};
    if (relationship && relationship !== existing.relationship) patch.relationship = relationship;
    if (primary && !existing.is_primary) patch.is_primary = true;
    if (Object.keys(patch).length) await trx('student_guardians').where({ student_id: studentId, guardian_id: guardianId }).update(patch);
    return { created: false };
  }
  await trx('student_guardians').insert({ student_id: studentId, guardian_id: guardianId, relationship: relationship || null, is_primary: Boolean(primary) });
  return { created: true };
}

/**
 * Aprueba la planilla y da de alta todo (ver encabezado). `data`:
 *   student   { existingId?, firstName, lastName, nationalId?, birthDate? }
 *   sectionId sección del año escolar de la planilla (obligatoria para un aspirante nuevo)
 *   legal     { guardianId?, firstName, lastName, nationalId?, phone?, email?, relationship }
 *   submitterRelationship  parentesco de quien envió, si no es el representante legal
 *   note      comentario para el representante (opcional)
 */
async function approveSubmission(trx, tenantId, userId, id, data) {
  // Bloqueo: dos administradores aprobando a la vez no duplican el alta.
  const sub = await trx('enrollment_form_submissions').where({ id, tenant_id: tenantId }).forUpdate().first();
  if (!sub) throw ApiError.notFound('Planilla recibida no encontrada.');
  if (!['submitted', 'changes_requested'].includes(sub.status)) {
    throw ApiError.conflict(forms.notOpenMessage(sub.status, 'aprobar'));
  }
  const form = await forms.loadForm(trx, tenantId, sub.form_id);
  if (form.period_closed_at) throw ApiError.conflict(`El año escolar ${form.school_period_name} ya está cerrado: no se puede inscribir.`);
  const submitter = await trx('guardians').where({ id: sub.guardian_id }).first();

  // ---- 1. Alumno ----
  const st = data.student;
  if (sub.student_id && st.existingId && st.existingId !== sub.student_id) throw ApiError.badRequest('Esta planilla es de otro alumno.');
  let studentId = sub.student_id || st.existingId || null;
  let studentCreated = false;
  const fields = { firstName: st.firstName, lastName: st.lastName, nationalId: clean(st.nationalId, 30), birthDate: st.birthDate || null };
  if (studentId) {
    const exists = await trx('students').where({ id: studentId, tenant_id: tenantId }).first('id', 'status');
    if (!exists) throw ApiError.notFound('Alumno no encontrado.');
    if (exists.status === 'withdrawn') throw ApiError.conflict('El alumno está retirado: reactívalo en Alumnos antes de aprobar su planilla, o rechaza la planilla.');
    if (!sub.student_id) {
      const other = await trx('enrollment_form_submissions').where({ form_id: sub.form_id, student_id: studentId }).whereNot({ id: sub.id }).first('id');
      if (other) throw ApiError.conflict('Ese alumno ya tiene otra planilla en este formulario: revísala allí.');
    }
    await students.updateStudent(trx, tenantId, studentId, { ...fields, nationalId: fields.nationalId ?? undefined, birthDate: fields.birthDate ?? undefined });
  } else {
    const dup = fields.nationalId ? (await possibleDuplicates(trx, tenantId, { nationalId: fields.nationalId })).find((d) => d.via === 'cédula') : null;
    if (dup) {
      throw ApiError.conflict(`Ya existe un alumno con la cédula ${dup.national_id}: ${dup.first_name} ${dup.last_name}. Elige «Usar el alumno registrado».`, [{ path: 'student.nationalId', message: 'Cédula ya registrada.' }]);
    }
    const created = await students.createStudent(trx, tenantId, fields);
    studentId = created.id;
    studentCreated = true;
  }

  // ---- 2. Representantes ----
  const L = data.legal;
  let legal = null;
  let legalCreated = false;
  if (L.guardianId) {
    legal = await trx('guardians').where({ id: L.guardianId, tenant_id: tenantId }).first();
    if (!legal) throw ApiError.notFound('Representante no encontrado.');
  } else {
    legal = await findGuardian(trx, tenantId, L);
  }
  if (legal) {
    // Registrado: solo se completan los datos que le faltan (no se pisa su ficha).
    const patch = {};
    if (!legal.national_id && clean(L.nationalId, 30)) patch.nationalId = clean(L.nationalId, 30);
    if (!legal.phone && clean(L.phone, 30)) patch.phone = clean(L.phone, 30);
    if (!legal.email && clean(L.email, 150)) patch.email = clean(L.email, 150);
    if (Object.keys(patch).length) await students.updateGuardian(trx, tenantId, legal.id, patch);
  } else {
    if (!clean(L.firstName, 100) || !clean(L.lastName, 100)) {
      throw ApiError.badRequest('Completa nombre y apellido del representante legal.', [{ path: 'legal.firstName', message: 'Requerido.' }]);
    }
    legal = await students.createGuardian(trx, tenantId, {
      firstName: clean(L.firstName, 100),
      lastName: clean(L.lastName, 100),
      nationalId: clean(L.nationalId, 30),
      phone: clean(L.phone, 30),
      email: clean(L.email, 150),
      portal: null, // el acceso al portal se da luego desde Representantes
    });
    legalCreated = true;
  }
  const legalLink = await upsertLink(trx, studentId, legal.id, { relationship: L.relationship, primary: true });
  const guardians = [{ id: legal.id, name: `${legal.first_name} ${legal.last_name}`, role: 'legal', created: legalCreated, linked: legalLink.created, relationship: L.relationship, primary: true }];
  if (submitter.id !== legal.id) {
    const current = await trx('student_guardians').where({ student_id: studentId, guardian_id: submitter.id }).first();
    const rel = data.submitterRelationship || current?.relationship || 'Tutor / Familiar';
    const link = await upsertLink(trx, studentId, submitter.id, { relationship: rel, primary: false });
    guardians.push({ id: submitter.id, name: `${submitter.first_name} ${submitter.last_name}`, role: 'submitter', created: false, linked: link.created, relationship: rel, primary: false });
  }

  // ---- 3. Matrícula (después de vincular: las mensualidades necesitan un responsable) ----
  let enrollment = null;
  const already = await activeEnrollmentIn(trx, studentId, form.school_period_id);
  if (data.sectionId) {
    const section = await trx('sections as sec').join('grades as g', 'g.id', 'sec.grade_id').where({ 'sec.id': data.sectionId, 'sec.tenant_id': tenantId }).first('sec.id', 'sec.name', 'sec.school_period_id', 'g.name as grade_name');
    if (!section) throw ApiError.notFound('Sección no encontrada.');
    if (section.school_period_id !== form.school_period_id) throw ApiError.badRequest(`La sección debe ser del año escolar ${form.school_period_name}.`, [{ path: 'sectionId', message: 'Otro año escolar.' }]);
    if (already && already.section_id === section.id) {
      enrollment = { sectionId: section.id, label: `${section.grade_name} «${section.name}»`, created: false };
    } else if (already) {
      throw ApiError.conflict(`El alumno ya cursa ${already.grade_name} «${already.section_name}» en ${form.school_period_name}. Cámbialo de sección desde Secciones.`, [{ path: 'sectionId', message: 'Ya inscrito.' }]);
    } else {
      const e = await academics.enrollStudent(trx, tenantId, { studentId, sectionId: section.id });
      enrollment = { sectionId: section.id, label: `${section.grade_name} «${section.name}»`, created: true, tuition: e.tuition };
    }
  } else if (studentCreated || !already) {
    throw ApiError.badRequest('Elige el grado y la sección donde se inscribe el alumno.', [{ path: 'sectionId', message: 'Requerido.' }]);
  } else {
    enrollment = { sectionId: already.section_id, label: `${already.grade_name} «${already.section_name}»`, created: false };
  }

  // ---- 4. Planilla aprobada ----
  const note = clean(data.note, 500);
  await trx('enrollment_form_submissions')
    .where({ id: sub.id })
    .update({ status: 'approved', student_id: studentId, review_note: note, reviewed_by: userId, reviewed_at: trx.fn.now(), updated_at: trx.fn.now() });
  const name = `${st.firstName} ${st.lastName}`;
  await notify(trx, tenantId, {
    event: 'enrollment_form',
    guardianIds: [sub.guardian_id],
    title: 'Planilla de inscripción aprobada',
    body: `La planilla «${form.title}» de ${name} fue aprobada: quedó inscrito en ${enrollment.label} (${form.school_period_name}).${note ? ` ${note}` : ''}`,
    links: { guardians: '/portal/enrollment' },
    linkLabel: 'Ver planilla',
    channels: { bell: true, email: false },
  });

  return {
    submission: await forms.getSubmission(trx, tenantId, sub.id),
    result: { student: { id: studentId, name, created: studentCreated }, enrollment, guardians },
  };
}

/**
 * Historial de planillas de un alumno (todas las convocatorias, la más reciente
 * primero): año escolar, grado y sección en que cursó ese año (su matrícula de
 * ese año; si no la tiene, el grado que pidió la familia), estado y revisión.
 * Incluye las de aspirante nuevo que ya se enlazaron al alumno al aprobarlas.
 */
async function studentHistory(trx, tenantId, studentId) {
  const st = await trx('students').where({ tenant_id: tenantId, id: studentId }).first('id', 'first_name', 'last_name');
  if (!st) throw ApiError.notFound('Alumno no encontrado.');
  const rows = await trx('enrollment_form_submissions as s')
    .join('enrollment_forms as f', 'f.id', 's.form_id')
    .join('school_periods as sp', 'sp.id', 'f.school_period_id')
    .join('guardians as g', 'g.id', 's.guardian_id')
    .leftJoin('users as u', 'u.id', 's.reviewed_by')
    // Matrícula de ese año (la más reciente si hubo cambio de sección; las retiradas al final).
    .joinRaw(
      `LEFT JOIN LATERAL (
         SELECT gr.name AS grade_name, sec.name AS section_name, e.status AS enrollment_status
         FROM enrollments e
         JOIN sections sec ON sec.id = e.section_id
         JOIN grades gr ON gr.id = sec.grade_id
         WHERE e.student_id = s.student_id AND sec.school_period_id = f.school_period_id
         ORDER BY (e.status = 'withdrawn'), e.enrolled_at DESC
         LIMIT 1
       ) enr ON true`
    )
    .where({ 's.tenant_id': tenantId, 's.student_id': studentId })
    .orderBy([{ column: 'sp.start_date', order: 'desc' }, { column: 's.submitted_at', order: 'desc' }])
    .select(
      's.id',
      's.status',
      's.submitted_at',
      's.reviewed_at',
      's.review_note',
      's.applicant_name',
      's.answers',
      's.fields_snapshot',
      'f.title as form_title',
      'sp.name as school_period_name',
      'sp.closed_at as period_closed_at',
      trx.raw("g.first_name || ' ' || g.last_name AS guardian_name"),
      'u.full_name as reviewed_by_name',
      'enr.grade_name',
      'enr.section_name',
      'enr.enrollment_status'
    );
  return {
    student: { id: st.id, name: `${st.first_name} ${st.last_name}` },
    // Sin respuestas ni campos en la lista: solo el grado solicitado (dato liviano).
    submissions: rows.map(({ answers, fields_snapshot: fields, ...r }) => ({ ...r, requested_grade: extract(fields, answers).requestedGrade })),
  };
}

module.exports = { studentHistory, approvalDraft, approveSubmission, extract, splitName, toRelationship, RELATIONSHIPS };
