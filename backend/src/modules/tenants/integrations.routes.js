const router = require('express').Router();
const mailSettings = require('./mailSettings.controller');

// Regresos de proveedores externos (OAuth2). Sin sesión: es el navegador que
// vuelve de Google; la seguridad la da el `state` de un solo uso (y PKCE).
router.get('/google/callback', mailSettings.googleCallback);

module.exports = router;
