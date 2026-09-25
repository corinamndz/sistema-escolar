const router = require('express').Router();

router.use('/auth', require('../modules/auth/auth.routes'));
router.use('/tenant', require('../modules/tenants/tenant.routes'));
router.use('/roles', require('../modules/roles/role.routes'));
router.use('/staff', require('../modules/staff/staff.routes'));
router.use('/', require('../modules/students/student.routes')); // expone /students y /guardians
router.use('/academics', require('../modules/academics/academic.routes'));
router.use('/evaluation-plans', require('../modules/evaluation-plans/evaluationPlan.routes'));
router.use('/grading', require('../modules/grading/grading.routes'));
router.use('/payments', require('../modules/payments/payment.routes'));

module.exports = router;
