/**
 * Ajuste del colegio (migración 059): ¿el contenido programático pasa por la
 * revisión de coordinación antes de quedar publicado?
 */

async function isContentReviewRequired(trx, tenantId) {
  const row = await trx('tenant_settings').where({ tenant_id: tenantId }).first('requires_academic_review');
  return Boolean(row?.requires_academic_review);
}

/** Para la pantalla de Configuración: el ajuste y cuántos contenidos esperan revisión hoy. */
async function getAcademicSettings(trx, tenantId) {
  const pending = await trx('programmatic_content_reviews').where({ tenant_id: tenantId, status: 'en_revision' }).count('* as n').first();
  return { requiresAcademicReview: await isContentReviewRequired(trx, tenantId), pendingContentReviews: Number(pending.n) };
}

async function updateAcademicSettings(trx, tenantId, { requiresAcademicReview }) {
  await trx('tenant_settings')
    .insert({ tenant_id: tenantId, requires_academic_review: requiresAcademicReview, updated_at: trx.fn.now() })
    .onConflict('tenant_id')
    .merge({ requires_academic_review: requiresAcademicReview, updated_at: trx.fn.now() });
  return getAcademicSettings(trx, tenantId);
}

module.exports = { isContentReviewRequired, getAcademicSettings, updateAcademicSettings };
