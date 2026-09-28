const router = require('express').Router();
const controller = require('./import.controller');
const { getImporter } = require('./import.service');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');
const { importUpload } = require('../../middlewares/upload.middleware');

router.use(authMiddleware, tenantMiddleware);

/**
 * El permiso depende del tipo: alumnos → students.create, personal →
 * staff.create, materias → academics.create, calificaciones → grading.update.
 * Se exige también para descargar la plantilla (la de calificaciones trae
 * nombres y notas de la sección).
 */
function requireImportPermission(req, res, next) {
  let importer;
  try {
    importer = getImporter(req.params.type);
  } catch (err) {
    return next(err);
  }
  return requirePermission(...importer.permission)(req, res, next);
}

router.get('/:type/template', requireImportPermission, controller.downloadTemplate);
// El permiso se revisa ANTES de recibir el archivo.
router.post('/:type/validate', requireImportPermission, importUpload, controller.validate);
router.post('/:type', requireImportPermission, importUpload, controller.importFile);

module.exports = router;
