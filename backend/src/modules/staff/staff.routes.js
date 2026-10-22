const router = require('express').Router();
const controller = require('./staff.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');
const coordinator = require('../access/coordinatorScope');
const { ApiError } = require('../../utils/ApiError');

router.use(authMiddleware, tenantMiddleware);

// Coordinador (migración 047): solo los docentes de su etapa (los demás → 404).
const ownStaff = coordinator.guardStaff('id');

/**
 * Asignar un rol es otorgar permisos. Puede gestionar usuarios de acceso:
 *   - el Director (quien edita roles): cualquier rol;
 *   - un Coordinador con etapa asignada: solo para docentes de su etapa y solo
 *     roles de menor jerarquía (Docente) — lo valida staffAccess.service.
 * Quien solo edita Personal, no (evita escalar privilegios desde Personal).
 */
async function canGrantRoles(req, res, next) {
  try {
    if (req.permissions?.roles?.can_update) return next();
    const scope = await coordinator.getCoordinatorScope(req);
    if (!scope) throw ApiError.forbidden('Para gestionar usuarios de acceso necesitas permiso para editar roles.');
    coordinator.assertHasLevel(scope);
    return next();
  } catch (err) {
    return next(err);
  }
}

router.get('/', requirePermission('staff', 'read'), controller.list);
router.post('/', requirePermission('staff', 'create'), controller.create);
router.get('/access/roles', requirePermission('staff', 'update'), canGrantRoles, controller.assignableRoles);
router.get('/:id', requirePermission('staff', 'read'), ownStaff, controller.getOne);
router.put('/:id', requirePermission('staff', 'update'), ownStaff, controller.update);
router.delete('/:id', requirePermission('staff', 'delete'), ownStaff, controller.remove);

const manageAccess = [requirePermission('staff', 'update'), ownStaff, canGrantRoles];
router.get('/:id/access', requirePermission('staff', 'read'), ownStaff, controller.getAccess);
router.post('/:id/access', ...manageAccess, controller.createAccess);
router.put('/:id/access', ...manageAccess, controller.updateAccess);

module.exports = router;
