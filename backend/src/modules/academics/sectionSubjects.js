/**
 * Materias de una SECCIÓN (migración 037): las del plan de estudios de su grado
 * (grade_subjects) menos las excluidas de esa sección
 * (section_subject_exclusions). Toda consulta que liste "las materias que ve
 * la sección" debe filtrar con `.whereNotExists(exclusionOf(...))`.
 *
 * `section` y `subject` son valores (un id) o columnas (`trx.ref('sec.id')`):
 *   .whereNotExists(exclusionOf(trx, trx.ref('sec.id'), trx.ref('gs.subject_id')))
 *   .whereNotExists(exclusionOf(trx, sectionId, trx.ref('gs.subject_id')))
 */
function exclusionOf(trx, section, subject) {
  return trx('section_subject_exclusions as x').where('x.section_id', section).andWhere('x.subject_id', subject).select(trx.raw('1'));
}

/** Mismo filtro en SQL plano, para subconsultas dentro de `trx.raw` (columnas sin comillas). */
const notExcludedSql = (sectionColumn, subjectColumn) =>
  `NOT EXISTS (SELECT 1 FROM section_subject_exclusions x WHERE x.section_id = ${sectionColumn} AND x.subject_id = ${subjectColumn})`;

module.exports = { exclusionOf, notExcludedSql };
