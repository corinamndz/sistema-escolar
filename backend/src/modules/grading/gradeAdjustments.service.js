const { ApiError } = require('../../utils/ApiError');
const { isAdmin } = require('../../middlewares/admin.middleware');
const coordinatorScope = require('../access/coordinatorScope');
const { logAudit } = require('../../services/audit/audit.service');

/**
 * Ajuste directivo de calificaciones definitivas (migración 084).
 *
 * El Administrador, o el Coordinador del NIVEL del alumno, cambian la
 * definitiva de una materia en un lapso ya cerrado, con un motivo obligatorio.
 * Cada ajuste es un renglón de grade_audit_logs (historial inalterable); la
 * nota vigente es la del último renglón (new_grade NULL = se quitó el ajuste).
 *
 * Un solo lugar para la regla: lo usan el resumen y la boleta
 * (gradeSummary.service), el expediente y la promoción
 * (academics/academicRecord.service.computeRecords) y el portal del
 * representante (portal/grades.service).
 *
 * Cuándo se puede ajustar:
 *   - el año escolar no está finalizado y la matrícula del alumno sigue activa
 *     (si ya se promovió, sus resultados están congelados: hay que deshacer la promoción);
 *   - el lapso está cerrado (lo cerró el Administrador o su fecha de fin ya pasó) o la materia ya tiene su
 *     definitiva del lapso (plan evaluado al 100 %).
 */

const MIN_REASON = 10;
const SCALE = 20;
const norm = (s) => String(s || '').trim().toLowerCase();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const num = (v) => (v === null || v === undefined ? null : Number(v));

/**
 * Ajustes VIGENTES (el último de cada alumno × año × lapso × materia, si no se quitó).
 * → Map `${studentId}|${termId}` → [{ subject_id, subject_name, grade, previous, computed, reason, by, role, at }]
 */
async function loadEffective(trx, tenantId, { studentIds, periodIds }) {
  const out = new Map();
  if (!studentIds?.length || !periodIds?.length) return out;
  const { rows } = await trx.raw(
    `SELECT DISTINCT ON (student_id, school_period_id, term_id, COALESCE(subject_id::text, lower(btrim(subject_name))))
            id, student_id, term_id, subject_id, subject_name, new_grade, previous_grade, computed_grade, reason,
            adjusted_by_name, adjusted_by_role, created_at
     FROM grade_audit_logs
     WHERE tenant_id = ? AND student_id = ANY(?) AND school_period_id = ANY(?)
     ORDER BY student_id, school_period_id, term_id, COALESCE(subject_id::text, lower(btrim(subject_name))), created_at DESC, id DESC`,
    [tenantId, studentIds, periodIds]
  );
  for (const r of rows) {
    if (r.new_grade === null) continue; // ajuste quitado: rige la nota calculada
    const key = `${r.student_id}|${r.term_id}`;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push({
      id: r.id,
      subject_id: r.subject_id,
      subject_name: r.subject_name,
      grade: num(r.new_grade),
      previous: num(r.previous_grade),
      computed: num(r.computed_grade),
      reason: r.reason,
      by: r.adjusted_by_name,
      role: r.adjusted_by_role,
      at: r.created_at,
    });
  }
  return out;
}

/** El ajuste vigente de una materia (por id del plan de estudios o, si no, por nombre). */
function findFor(effective, studentId, termId, { subjectId = null, name = '' }) {
  const list = effective.get(`${studentId}|${termId}`) || [];
  return list.find((a) => (subjectId && a.subject_id && a.subject_id === subjectId) || norm(a.subject_name) === norm(name)) || null;
}

/** Historial completo de un alumno en un año (lo más reciente primero). */
async function history(trx, tenantId, studentId, periodId) {
  return trx('grade_audit_logs as l')
    .join('terms as t', 't.id', 'l.term_id')
    .where({ 'l.tenant_id': tenantId, 'l.student_id': studentId, 'l.school_period_id': periodId })
    .orderBy([{ column: 'l.created_at', order: 'desc' }, { column: 'l.id', order: 'desc' }])
    .select(
      'l.id',
      'l.term_id',
      't.name as term_name',
      't.term_number',
      'l.subject_id',
      'l.subject_name',
      trx.raw('l.computed_grade::float AS computed_grade'),
      trx.raw('l.previous_grade::float AS previous_grade'),
      trx.raw('l.new_grade::float AS new_grade'),
      'l.reason',
      'l.adjusted_by_name',
      'l.adjusted_by_role',
      'l.created_at'
    );
}

/**
 * ¿Quién puede ajustar? → 'admin' | 'coordinacion' | null.
 * `levelCode`: el nivel del alumno (el Coordinador solo ajusta en el suyo).
 */
async function adjusterRole(req, levelCode = undefined) {
  if (await isAdmin(req.db, req.tenantId, req.user.id)) return 'admin';
  const coord = await coordinatorScope.getCoordinatorScope(req);
  if (!coord?.level) return null;
  if (levelCode !== undefined && levelCode !== coord.level) return null;
  return 'coordinacion';
}

/** La fecha de fin del lapso ya pasó. */
const endDatePassed = (term) => Boolean(term?.end_date && new Date(`${String(term.end_date).slice(0, 10)}T23:59:59`) < new Date());

/** Lapso cerrado: manualmente (migración 085) o porque terminó por fecha. */
const termEnded = (term) => Boolean(term?.closed_at) || endDatePassed(term);

/**
 * Cierra o reabre un lapso (solo el Administrador: lo exige la ruta). El lapso es
 * de todo el colegio. Reabrir no quita los ajustes ya hechos.
 */
async function setTermClosed(req, termId, closed) {
  const { db: trx, tenantId } = req;
  const term = await trx('terms as t')
    .join('school_periods as sp', 'sp.id', 't.school_period_id')
    .where({ 't.id': termId, 't.tenant_id': tenantId })
    .forUpdate('t')
    .first('t.id', 't.name', 't.end_date', 't.closed_at', 'sp.name as period_name', 'sp.closed_at as period_closed_at');
  if (!term) throw ApiError.notFound('Lapso no encontrado.');
  if (term.period_closed_at) throw ApiError.conflict(`El año escolar ${term.period_name} está finalizado: sus lapsos ya no se pueden cambiar.`);
  if (closed && termEnded(term)) throw ApiError.conflict(`${term.name} ya está cerrado.`);
  if (!closed && !term.closed_at) throw ApiError.conflict(endDatePassed(term) ? `${term.name} está cerrado por su fecha de fin: cámbiala para reabrirlo.` : `${term.name} no está cerrado.`);
  if (!closed && endDatePassed(term)) throw ApiError.conflict(`La fecha de fin de ${term.name} ya pasó: cámbiala para reabrirlo.`);
  await trx('terms').where({ id: term.id }).update(closed ? { closed_at: trx.fn.now(), closed_by: req.user.id } : { closed_at: null, closed_by: null });
  await logAudit(trx, {
    tenantId,
    userId: req.user.id,
    action: closed ? 'CERRAR_LAPSO' : 'REABRIR_LAPSO',
    module: 'grading',
    entity: 'terms',
    entityId: term.id,
    summary: `${closed ? 'Cerró' : 'Reabrió'} ${term.name} de ${term.period_name}`,
  });
  return { id: term.id, closed };
}

/**
 * Registra un ajuste (o lo quita con newGrade = null).
 *   { schoolPeriodId, termId, subjectKey, newGrade, reason }
 * subjectKey: la clave de la materia en el detalle (id del plan de estudios o nombre del área).
 */
async function adjust(req, studentId, { schoolPeriodId, termId, subjectKey, newGrade, reason }) {
  const { db: trx, tenantId } = req;
  const summary = require('./gradeSummary.service'); // eslint-disable-line global-require -- evita el require circular

  const why = String(reason || '').trim();
  if (why.length < MIN_REASON) {
    throw ApiError.badRequest(`Explica el motivo del ajuste (al menos ${MIN_REASON} caracteres).`, [{ path: 'reason', message: 'Motivo obligatorio.' }]);
  }
  if (newGrade !== null && (!Number.isFinite(newGrade) || newGrade < 0 || newGrade > SCALE)) {
    throw ApiError.badRequest(`La nota debe estar entre 0 y ${SCALE}.`, [{ path: 'newGrade', message: `Entre 0 y ${SCALE}.` }]);
  }
  const grade = newGrade === null ? null : Math.round(newGrade * 100) / 100;

  const period = await trx('school_periods').where({ id: schoolPeriodId, tenant_id: tenantId }).first('id', 'name', 'closed_at');
  if (!period) throw ApiError.notFound('Año escolar no encontrado.');
  if (period.closed_at) throw ApiError.conflict(`El año escolar ${period.name} está finalizado: sus notas ya no se pueden ajustar.`);
  const term = await trx('terms').where({ id: termId, tenant_id: tenantId, school_period_id: period.id }).first('id', 'name', 'end_date', 'closed_at');
  if (!term) throw ApiError.badRequest('Ese lapso no pertenece al año escolar.', [{ path: 'termId', message: 'Lapso inválido.' }]);

  // Matrícula del alumno en ese año (con su nivel, para el Coordinador).
  const enr = await trx('enrollments as e')
    .join('sections as sec', 'sec.id', 'e.section_id')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .where({ 'e.tenant_id': tenantId, 'e.student_id': studentId, 'sec.school_period_id': period.id })
    .whereNot('e.status', 'withdrawn')
    .orderByRaw("(e.status = 'active') DESC, e.enrolled_at DESC")
    .first('e.id', 'e.status', 'g.level_code');
  if (!enr) throw ApiError.notFound('El alumno no está inscrito en ese año escolar.');

  const role = await adjusterRole(req, enr.level_code);
  if (!role) throw ApiError.forbidden('Solo el Administrador o el Coordinador del nivel del alumno pueden ajustar calificaciones definitivas.');
  if (enr.status !== 'active') {
    throw ApiError.conflict('El alumno ya cerró este año (promoción): sus resultados quedaron congelados. Deshaz su promoción para ajustar una nota.');
  }

  // Nota actual de la materia en el lapso (con el ajuste vigente, si lo hay).
  const detail = await summary.getStudentDetail(trx, tenantId, studentId, { schoolPeriodId: period.id });
  const subject = detail.subjects.find((s) => s.key === subjectKey);
  if (!subject) throw ApiError.badRequest('Esa materia no está en las calificaciones del alumno.', [{ path: 'subjectKey', message: 'Materia inválida.' }]);
  const cell = subject.terms[term.id] || null;
  const current = cell?.adjustment || null;
  const computed = cell ? (cell.computed !== undefined ? cell.computed : cell.value ?? null) : null;
  const previous = current ? current.grade : computed;

  if (grade === null && !current) throw ApiError.conflict('Esa nota no tiene un ajuste vigente que quitar.');
  if (grade !== null && previous !== null && Math.abs(previous - grade) < 0.005) throw ApiError.conflict('La nota nueva es igual a la actual.');
  // «Al cierre del lapso»: está cerrado, o la materia ya tiene su definitiva.
  const hasFinal = Boolean(cell && (cell.adjustment || (cell.final !== null && cell.final !== undefined && !cell.partial)));
  if (!termEnded(term) && !hasFinal) {
    throw ApiError.conflict(`${term.name} aún no ha cerrado y ${subject.name} no tiene su definitiva: se ajusta al cierre del lapso.`);
  }

  const user = await trx('users').where({ id: req.user.id }).first('full_name', 'username');
  const [row] = await trx('grade_audit_logs')
    .insert({
      tenant_id: tenantId,
      student_id: studentId,
      school_period_id: period.id,
      term_id: term.id,
      enrollment_id: enr.id,
      subject_id: UUID.test(subject.key) ? subject.key : null,
      subject_name: subject.name.slice(0, 150),
      computed_grade: computed,
      previous_grade: previous,
      new_grade: grade,
      reason: why.slice(0, 500),
      adjusted_by: req.user.id,
      adjusted_by_name: user?.full_name || user?.username || null,
      adjusted_by_role: role,
      // Hora real (now() es la misma en toda la transacción): ordena bien varios ajustes seguidos.
      created_at: trx.raw('clock_timestamp()'),
    })
    .returning('id');

  // Bitácora general de auditoría (además del historial propio de notas).
  const st = detail.student;
  await logAudit(trx, {
    tenantId,
    userId: req.user.id,
    actorName: user?.full_name,
    actorUsername: user?.username,
    action: grade === null ? 'QUITAR_AJUSTE_NOTA' : 'AJUSTAR_NOTA',
    module: 'grading',
    entity: 'grade_audit_logs',
    entityId: row.id,
    summary:
      grade === null
        ? `Quitó el ajuste de ${subject.name} (${term.name}) de ${st.first_name} ${st.last_name}: vuelve a ${computed ?? '—'}`
        : `Ajustó ${subject.name} (${term.name}) de ${st.first_name} ${st.last_name}: ${previous ?? '—'} → ${grade}`,
    diff: { previous, new: grade, computed, reason: why },
  });

  return summary.getStudentDetail(trx, tenantId, studentId, { schoolPeriodId: period.id });
}

module.exports = { loadEffective, findFor, history, adjust, adjusterRole, termEnded, setTermClosed, MIN_REASON };
