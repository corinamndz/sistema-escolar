const router = require('express').Router();
const { fontFile } = require('../../services/pdf/certificateFonts');

/**
 * GET /certificate-fonts/:file — las fuentes OFL del certificado, para que el editor
 * dibuje con el mismo archivo que se incrusta en el PDF. Públicas (no son datos del
 * colegio) y solo las de la lista: nada fuera de assets/fonts.
 */
router.get('/:file', (req, res) => {
  const full = fontFile(req.params.file);
  if (!full) return res.status(404).json({ error: { message: 'Fuente no encontrada.' } });
  res.set({ 'Content-Type': 'font/ttf', 'Cache-Control': 'public, max-age=604800', 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' });
  return res.sendFile(full);
});

module.exports = router;
