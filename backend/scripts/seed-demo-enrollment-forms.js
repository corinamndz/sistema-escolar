/**
 * Datos de demostración: planillas de inscripción APROBADAS para la mayoría de
 * los alumnos de un año escolar (para presentaciones).
 *
 *   node scripts/seed-demo-enrollment-forms.js                 ensayo: no guarda nada
 *   node scripts/seed-demo-enrollment-forms.js --aplicar       crea las planillas
 *   node scripts/seed-demo-enrollment-forms.js --deshacer      ensayo de la limpieza
 *   node scripts/seed-demo-enrollment-forms.js --deshacer --aplicar   borra SOLO las creadas por este script
 *
 * Opciones: --colegio=demo  --anio=2026-2027  --porcentaje=85  --en-revision=3
 *
 * Qué hace:
 *   - Toma los alumnos ACTIVOS con matrícula en ese año escolar, sin los de
 *     1er Grado (se usan para pruebas), que aún no tengan planilla en la
 *     convocatoria de ese año.
 *   - Al --porcentaje de ellos (85 % por defecto, redondeado hacia arriba) les
 *     crea una planilla APROBADA en la convocatoria del año, a nombre de su
 *     representante principal (o, si no tiene, del primero vinculado), con las
 *     respuestas precargadas de la ficha (la misma precarga del sistema:
 *     enrollmentForm.service prefillMap) y datos genéricos en salud y contacto.
 *   - De los demás, --en-revision quedan «En revisión» (para aprobar en vivo) y
 *     el resto sin planilla: no inscritos.
 *   - La elección es fija (mismo resultado si se vuelve a ensayar), y no envía
 *     avisos a las familias.
 *
 * Cada planilla creada lleva la marca answers.__demo_seed: --deshacer borra solo
 * esas, nunca una planilla real.
 */
require('dotenv').config();
const { db, withTenantTransaction } = require('../src/config/database');
const forms = require('../src/modules/enrollment-forms/enrollmentForm.service');

const SEED = 'demo-presentacion';
const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const has = (flag) => process.argv.includes(`--${flag}`);
const APPLY = has('aplicar');
const UNDO = has('deshacer');
const SLUG = arg('colegio', 'demo');
const YEAR = arg('anio', '2026-2027');
const PERCENT = Number(arg('porcentaje', '85'));
const IN_REVIEW = Number(arg('en-revision', '3'));
const FIRST_GRADE = /^\s*1\s*(er|ro|°|º)?\.?\s*grado\s*$/i;

/** Orden pseudoaleatorio pero fijo (por id): el mismo ensayo da siempre el mismo resultado. */
const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
const norm = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const BLOOD = ['O+', 'O+', 'O+', 'A+', 'A+', 'B+', 'AB+', 'O-', 'A-'];
const ALLERGIES = ['Ninguna', 'Ninguna', 'Ninguna', 'Ninguna', 'Rinitis alérgica', 'Alergia a la penicilina', 'Asma leve controlada'];

/** Ajusta un valor al tipo del campo (como la precarga del sistema); null si no encaja. */
function fit(f, v) {
  if (v === undefined || v === null || v === '') return null;
  if (['select', 'radio'].includes(f.type)) return (f.options || []).find((o) => norm(o) === norm(v)) || null;
  if (f.type === 'number') return Number.isFinite(Number(String(v).replace(/\D/g, ''))) && /\d/.test(String(v)) ? Number(String(v).replace(/\D/g, '')) : null;
  if (f.type === 'phone') return /^[0-9+()\-\s.]{7,25}$/.test(String(v)) ? String(v) : null;
  if (f.type === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v)) ? String(v) : null;
  if (f.type === 'date') {
    const d = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  }
  if (f.type === 'short_text') return String(v).slice(0, 200);
  if (f.type === 'long_text') return String(v).slice(0, 3000);
  return v;
}

/** Respuestas de la planilla: precarga de la ficha + datos genéricos de salud y contacto. */
function answersFor(fields, map, r) {
  const full = (a, b) => [a, b].filter(Boolean).join(' ');
  const record = {
    'student.first_name': r.first_name,
    'student.last_name': r.last_name,
    'student.full_name': full(r.first_name, r.last_name),
    'student.national_id': r.national_id,
    'student.birth_date': r.birth_date,
    'student.grade': r.level_code === 'initial' ? 'Educación Inicial' : r.grade_name,
    'student.section': `${r.grade_name} «${r.section_name}»`,
    'guardian.first_name': r.g_first_name,
    'guardian.last_name': r.g_last_name,
    'guardian.full_name': full(r.g_first_name, r.g_last_name),
    'guardian.national_id': r.g_national_id,
    'guardian.phone': r.g_phone,
    'guardian.email': r.g_email,
    'guardian.relationship': r.relationship,
  };
  const h = hash(r.student_id);
  const answers = { __demo_seed: SEED };
  for (const f of fields) {
    if (f.type === 'section' || f.type === 'photo') continue;
    let v = map[f.id] ? record[map[f.id]] : null;
    const l = norm(f.label);
    if (v == null) {
      if (/grado/.test(l) && ['select', 'radio'].includes(f.type)) v = record['student.grade'];
      else if (/sangre/.test(l)) v = BLOOD[h % BLOOD.length];
      else if (/alergia|condicion|medic/.test(l)) v = ALLERGIES[h % ALLERGIES.length];
      else if (/contacto/.test(l) && f.type === 'phone') v = r.g_phone;
      else if (/contacto|emergencia/.test(l)) v = full(r.g_first_name, r.g_last_name);
      else if (f.type === 'checkbox') v = true;
    }
    const value = f.type === 'checkbox' ? Boolean(v) : fit(f, v);
    if (value !== null && value !== undefined) answers[f.id] = value;
  }
  return answers;
}

async function seed(trx, tenantId) {
  const period = await trx('school_periods').where({ tenant_id: tenantId, name: YEAR }).first('id', 'name');
  if (!period) throw new Error(`No existe el año escolar ${YEAR}.`);
  const form = await trx('enrollment_forms').where({ tenant_id: tenantId, school_period_id: period.id }).orderBy('created_at').first('id', 'title', 'fields');
  if (!form) throw new Error(`No hay una planilla de inscripción para ${YEAR}: créala primero en Diseño de planillas.`);
  const admin = await trx('users as u')
    .join('user_roles as ur', 'ur.user_id', 'u.id')
    .join('roles as r', 'r.id', 'ur.role_id')
    .where({ 'u.tenant_id': tenantId, 'r.name': 'Administrador' })
    .first('u.id', 'u.full_name');

  // Alumnos activos con matrícula en el año, su grado y su representante (principal primero).
  const { rows } = await trx.raw(
    `SELECT DISTINCT ON (st.id)
            st.id AS student_id, st.first_name, st.last_name, st.national_id, st.birth_date,
            g.name AS grade_name, g.level_code, sec.name AS section_name,
            gu.id AS guardian_id, gu.first_name AS g_first_name, gu.last_name AS g_last_name,
            gu.national_id AS g_national_id, gu.phone AS g_phone, gu.email AS g_email, sg.relationship
     FROM students st
     JOIN enrollments e ON e.student_id = st.id AND e.status <> 'withdrawn'
     JOIN sections sec ON sec.id = e.section_id AND sec.school_period_id = :periodId
     JOIN grades g ON g.id = sec.grade_id
     LEFT JOIN student_guardians sg ON sg.student_id = st.id
     LEFT JOIN guardians gu ON gu.id = sg.guardian_id AND gu.tenant_id = :tenantId
     WHERE st.tenant_id = :tenantId AND st.status = 'active'
     ORDER BY st.id, sg.is_primary DESC NULLS LAST, gu.created_at`,
    { tenantId, periodId: period.id }
  );
  const firstGrade = rows.filter((r) => FIRST_GRADE.test(r.grade_name));
  // Planillas que ya existen en esa convocatoria (reales o de una ejecución anterior): se respetan.
  const existing = new Map((await trx('enrollment_form_submissions').where({ form_id: form.id }).whereNotNull('student_id').select('student_id', 'status')).map((s) => [s.student_id, s.status]));
  const withForm = rows.filter((r) => !FIRST_GRADE.test(r.grade_name) && existing.has(r.student_id));
  const approvedAlready = withForm.filter((r) => existing.get(r.student_id) === 'approved').length;
  const reviewAlready = withForm.filter((r) => ['submitted', 'changes_requested'].includes(existing.get(r.student_id))).length;
  const noGuardian = rows.filter((r) => !FIRST_GRADE.test(r.grade_name) && !existing.has(r.student_id) && !r.guardian_id);
  const pool = rows
    .filter((r) => !FIRST_GRADE.test(r.grade_name) && !existing.has(r.student_id) && r.guardian_id)
    .sort((a, b) => hash(a.student_id) - hash(b.student_id) || a.student_id.localeCompare(b.student_id));

  // El porcentaje es sobre todos los alumnos elegibles; las aprobadas que ya había cuentan.
  const eligible = pool.length + withForm.length;
  const target = Math.ceil((eligible * PERCENT) / 100);
  const approveN = Math.max(0, Math.min(pool.length, target - approvedAlready));
  const toApprove = pool.slice(0, approveN);
  const toReview = pool.slice(approveN, approveN + Math.max(0, IN_REVIEW - reviewAlready));
  const untouched = pool.slice(approveN + toReview.length);

  const map = forms.prefillMap(form.fields);
  const now = Date.now();
  const at = (r, maxDays) => new Date(now - ((hash(r.student_id) % (maxDays * 24)) + 2) * 3600 * 1000);
  const insert = (r, status) => {
    const submitted = at(r, 21);
    return {
      tenant_id: tenantId,
      form_id: form.id,
      guardian_id: r.guardian_id,
      student_id: r.student_id,
      status,
      answers: JSON.stringify(answersFor(form.fields, map, r)),
      fields_snapshot: JSON.stringify(form.fields),
      submitted_at: submitted,
      ...(status === 'approved'
        ? { reviewed_by: admin?.id || null, reviewed_at: new Date(Math.min(now - 3600 * 1000, submitted.getTime() + ((hash(r.student_id) % 72) + 4) * 3600 * 1000)), review_note: 'Inscripción aprobada.' }
        : {}),
    };
  };
  for (const r of toApprove) await trx('enrollment_form_submissions').insert(insert(r, 'approved'));
  for (const r of toReview) await trx('enrollment_form_submissions').insert(insert(r, 'submitted'));

  return {
    form: form.title,
    excluded_first_grade: firstGrade.length,
    eligible,
    already_with_form: withForm.length,
    no_guardian: noGuardian.map((r) => `${r.first_name} ${r.last_name}`),
    approved: toApprove.length,
    in_review: toReview.length,
    without_form: untouched.length + noGuardian.length,
    approved_percent: eligible ? Math.round(((toApprove.length + approvedAlready) / eligible) * 1000) / 10 : 0,
    sample: toApprove.slice(0, 5).map((r) => `${r.first_name} ${r.last_name} (${r.grade_name}) · ${r.g_first_name} ${r.g_last_name}`),
  };
}

async function undo(trx, tenantId) {
  const rows = await trx('enrollment_form_submissions').where({ tenant_id: tenantId }).whereRaw("answers->>'__demo_seed' = ?", [SEED]).select('id', 'status');
  await trx('enrollment_form_submissions').whereIn('id', rows.map((r) => r.id)).delete();
  return { removed: rows.length, approved: rows.filter((r) => r.status === 'approved').length, other: rows.filter((r) => r.status !== 'approved').length };
}

module.exports = { seed, undo, SEED };

// Solo se ejecuta al llamarlo directamente (las pruebas lo importan).
if (require.main === module) (async () => {
  const tenant = await db('tenants').where({ slug: SLUG }).first('id', 'name');
  if (!tenant) throw new Error(`No existe el colegio «${SLUG}».`);
  let result;
  try {
    await withTenantTransaction(tenant.id, async (trx) => {
      result = UNDO ? await undo(trx, tenant.id) : await seed(trx, tenant.id);
      if (!APPLY) throw new Error('__ensayo__'); // ensayo: se revierte todo
    });
  } catch (err) {
    if (err.message !== '__ensayo__') throw err;
  }
  console.log(`\n${tenant.name} · ${UNDO ? 'limpieza' : `planillas ${YEAR}`} · ${APPLY ? 'APLICADO' : 'ENSAYO (no se guardó nada)'}`);
  console.log(JSON.stringify(result, null, 2));
  if (!APPLY) console.log(`\nPara ${UNDO ? 'borrarlas' : 'crearlas'} de verdad, agrega --aplicar.`);
  await db.destroy();
})().catch(async (err) => {
  console.error('Error:', err.message);
  process.exitCode = 1;
  await db.destroy();
});
