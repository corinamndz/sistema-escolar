const { currentPeriodOrder } = require('../../utils/schoolPeriods');

/**
 * Estatus de inscripción de un alumno en un AÑO ESCOLAR (regla de negocio):
 *
 *   «Inscrito» si y solo si tiene una planilla de inscripción APROBADA de ese
 *   año escolar (una planilla de una convocatoria cuyo año es ese).
 *
 * La matrícula sola NO basta: al promover, el alumno ya queda ubicado en su
 * grado del año nuevo, pero figura «No inscrito» hasta que el colegio aprueba
 * la planilla de ese ciclo. En revisión, por corregir, rechazada o sin enviar
 * → «No inscrito». Al aprobarla, la matrícula y la planilla quedan del mismo
 * año (y del grado en que se ubicó al alumno).
 *
 * Un solo lugar para la regla: listado de alumnos y portal del representante.
 */

const FORM_STATUS_ORDER = "CASE fs.status WHEN 'approved' THEN 0 WHEN 'changes_requested' THEN 1 WHEN 'submitted' THEN 2 WHEN 'rejected' THEN 3 ELSE 4 END, fs.submitted_at DESC NULLS LAST";

/**
 * Columnas para una consulta sobre `students` (alias `alias`) en el año `periodId`:
 *   enrollment_state   'enrolled' | 'not_enrolled'
 *   form_status        estado de su planilla de ese año (null = no la ha enviado)
 *   period_grade_name / period_section_name   dónde está ubicado ese año (matrícula activa), si lo está
 */
function statusColumns(trx, periodId, alias = 's') {
  const sub = `FROM enrollment_form_submissions fs JOIN enrollment_forms f ON f.id = fs.form_id
               WHERE fs.student_id = ${alias}.id AND f.school_period_id = ?`;
  const placed = `FROM enrollments e JOIN sections sec ON sec.id = e.section_id JOIN grades g ON g.id = sec.grade_id
                  WHERE e.student_id = ${alias}.id AND e.status = 'active' AND sec.school_period_id = ?`;
  return [
    trx.raw(`CASE WHEN EXISTS (SELECT 1 ${sub} AND fs.status = 'approved') THEN 'enrolled' ELSE 'not_enrolled' END AS enrollment_state`, [periodId]),
    trx.raw(`(SELECT fs.status ${sub} ORDER BY ${FORM_STATUS_ORDER} LIMIT 1) AS form_status`, [periodId]),
    trx.raw(`(SELECT g.name ${placed} LIMIT 1) AS period_grade_name`, [periodId]),
    trx.raw(`(SELECT sec.name ${placed} LIMIT 1) AS period_section_name`, [periodId]),
  ];
}

/**
 * LATERAL con la matrícula del alumno (alias `alias`) EN UN AÑO ESCOLAR (`?` = id del año).
 *
 * Cada matrícula pertenece a su año (sección → año; migración 080). Antes se
 * tomaba «la activa de cualquier año»: al promover, la del año en curso queda
 * cerrada (promoted) y la del año nuevo activa, así que el listado mostraba el
 * grado NUEVO como si fuera el actual. Ahora se elige la del año pedido:
 * primero la activa, luego la cerrada con su resultado (promovido, repite,
 * egresado) y al final la retirada. Si se promovió, trae también a dónde pasa
 * (next_*), sin mezclarlo con el grado de este año.
 */
function periodEnrollmentLateral(alias = 's') {
  return `LEFT JOIN LATERAL (
     SELECT e.id AS enrollment_id, e.status AS enrollment_status, sec.id AS section_id, sec.name AS section_name, sec.max_students,
            g.id AS grade_id, g.name AS grade_name, g.sort_order AS grade_sort,
            g.level_code, el.name AS level_name, el.sort_order AS level_sort,
            sp.id AS school_period_id, sp.name AS school_period_name,
            ng.name AS next_grade_name, nsec.name AS next_section_name, nsp.name AS next_period_name
     FROM enrollments e
     JOIN sections sec ON sec.id = e.section_id
     JOIN grades g ON g.id = sec.grade_id
     JOIN education_levels el ON el.code = g.level_code
     JOIN school_periods sp ON sp.id = sec.school_period_id
     LEFT JOIN enrollments ne ON ne.id = e.next_enrollment_id
     LEFT JOIN sections nsec ON nsec.id = ne.section_id
     LEFT JOIN grades ng ON ng.id = nsec.grade_id
     LEFT JOIN school_periods nsp ON nsp.id = nsec.school_period_id
     WHERE e.student_id = ${alias}.id AND sec.school_period_id = ?
     ORDER BY CASE e.status WHEN 'active' THEN 0 WHEN 'withdrawn' THEN 2 ELSE 1 END, e.enrolled_at DESC
     LIMIT 1
   ) cur ON true`;
}

/** Año escolar vigente (misma regla que los selectores del frontend). */
function currentPeriod(trx, tenantId) {
  return trx('school_periods as sp').where('sp.tenant_id', tenantId).orderByRaw(currentPeriodOrder('sp')).first('sp.id', 'sp.name', 'sp.start_date', 'sp.closed_at');
}

/**
 * Años escolares para el selector «Inscripción de…» del listado: los abiertos
 * (el vigente y el siguiente ya preparado) y el vigente aunque esté cerrado.
 */
async function selectablePeriods(trx, tenantId) {
  const cur = await currentPeriod(trx, tenantId);
  const rows = await trx('school_periods').where({ tenant_id: tenantId }).andWhere((q) => q.whereNull('closed_at').orWhere('id', cur?.id || null)).orderBy('start_date', 'desc').select('id', 'name', 'start_date', 'closed_at');
  return rows.map((p) => ({ ...p, is_current: p.id === cur?.id }));
}

/** Año para el estatus: el pedido (si es del colegio) o el vigente. */
async function resolvePeriod(trx, tenantId, periodId = null) {
  if (periodId) {
    const p = await trx('school_periods').where({ tenant_id: tenantId, id: periodId }).first('id', 'name', 'start_date', 'closed_at');
    if (p) return p;
  }
  return currentPeriod(trx, tenantId);
}

module.exports = { statusColumns, periodEnrollmentLateral, currentPeriod, selectablePeriods, resolvePeriod };
