const fs = require('fs');
const path = require('path');
const fontkit = require('@pdf-lib/fontkit');
const { StandardFonts } = require('pdf-lib');

/**
 * Fuentes del certificado. Una sola fuente de verdad para el PDF y para el editor:
 *
 *   standard   las tres del estándar PDF (no se incrustan). El editor usa sus
 *              equivalentes métricos instalados (Arial, Times New Roman, Courier New).
 *   files      fuentes OFL incluidas en assets/fonts: el PDF las incrusta y el
 *              editor descarga EXACTAMENTE el mismo archivo (GET /certificate-fonts/…).
 *
 * `ascent` y `descent` (fracciones del tamaño de letra) se fijan en el CSS del editor
 * con ascent-override / descent-override, y el PDF calcula la línea base con los
 * mismos valores: así el texto cae igual en pantalla, en cualquier sistema, y en el
 * PDF. Georgia, Arial y Verdana no se incluyen por su licencia (Microsoft): Arimo es
 * su equivalente métrico de Arial y Gelasio el de Georgia.
 */
const DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');

const DEFS = [
  { key: 'helvetica', label: 'Helvetica', group: 'Clásicas', standard: { regular: StandardFonts.Helvetica, bold: StandardFonts.HelveticaBold }, local: ['Arial', 'Helvetica', 'Liberation Sans', 'Arimo'], ascent: 0.905, descent: 0.212, fallback: 'sans-serif' },
  { key: 'times', label: 'Times', group: 'Clásicas', standard: { regular: StandardFonts.TimesRoman, bold: StandardFonts.TimesRomanBold }, local: ['Times New Roman', 'Times', 'Liberation Serif', 'Tinos'], ascent: 0.891, descent: 0.216, fallback: 'serif' },
  { key: 'courier', label: 'Courier', group: 'Clásicas', standard: { regular: StandardFonts.Courier, bold: StandardFonts.CourierBold }, local: ['Courier New', 'Courier', 'Liberation Mono', 'Cousine'], ascent: 0.833, descent: 0.3, fallback: 'monospace' },
  { key: 'arimo', label: 'Arimo (equivalente a Arial)', group: 'Sans serif', dir: 'Arimo', fallback: 'sans-serif' },
  { key: 'montserrat', label: 'Montserrat', group: 'Sans serif', dir: 'Montserrat', fallback: 'sans-serif' },
  { key: 'gelasio', label: 'Gelasio (equivalente a Georgia)', group: 'Serif', dir: 'Gelasio', fallback: 'serif' },
  { key: 'playfair', label: 'Playfair Display', group: 'Serif', dir: 'PlayfairDisplay', fallback: 'serif' },
  { key: 'cinzel', label: 'Cinzel (mayúsculas clásicas)', group: 'Serif', dir: 'Cinzel', fallback: 'serif' },
  { key: 'greatvibes', label: 'Great Vibes (caligráfica)', group: 'Caligráfica', dir: 'GreatVibes', fallback: 'cursive' },
];

/** Métricas que usa el navegador para colocar el texto (hhea). */
function metricsOf(file) {
  const f = fontkit.create(fs.readFileSync(file));
  const round = (v) => Math.round((v / f.unitsPerEm) * 10000) / 10000;
  return { ascent: round(f.hhea.ascent), descent: round(-f.hhea.descent) };
}

const FONTS = DEFS.map((d) => {
  if (d.standard) return { ...d, hasBold: true };
  const files = fs.readdirSync(path.join(DIR, d.dir));
  const regular = files.find((f) => f.includes('400Regular'));
  const bold = files.find((f) => f.includes('700Bold')) || null;
  return { ...d, files: { regular, bold }, hasBold: Boolean(bold), ...metricsOf(path.join(DIR, d.dir, regular)), boldMetrics: bold ? metricsOf(path.join(DIR, d.dir, bold)) : null };
});
/** Fuentes que pdf-lib recorta mal (pierde letras): se incrustan completas. */
const NO_SUBSET = new Set(['arimo', 'greatvibes']);
const BY_KEY = Object.fromEntries(FONTS.map((f) => [f.key, f]));
const FONT_KEYS = FONTS.map((f) => f.key);

/** Archivo servible por nombre (solo los de la lista: nada fuera de assets/fonts). */
function fontFile(name) {
  for (const f of FONTS) {
    if (!f.files) continue;
    for (const file of [f.files.regular, f.files.bold]) if (file && file === name) return path.join(DIR, f.dir, file);
  }
  return null;
}

/** Lo que necesita el editor: claves, nombres, si tienen negrita, métricas y archivos. */
function publicList() {
  return FONTS.map((f) => ({
    key: f.key,
    label: f.label,
    group: f.group,
    has_bold: f.hasBold,
    ascent: f.ascent,
    descent: f.descent,
    bold_ascent: f.boldMetrics?.ascent ?? f.ascent,
    bold_descent: f.boldMetrics?.descent ?? f.descent,
    local: f.local || [],
    files: f.files || null,
    fallback: f.fallback,
  }));
}

/**
 * Incrusta (o toma del estándar) la fuente en un PDF, una vez por documento.
 * → { font, ascent, descent } con las métricas de la variante usada.
 */
async function embedFor(doc, key, bold, cache) {
  const def = BY_KEY[key] || BY_KEY.helvetica;
  const useBold = bold && def.hasBold;
  const id = `${def.key}|${useBold}`;
  if (!cache.has(id)) {
    let font;
    if (def.standard) font = await doc.embedFont(useBold ? def.standard.bold : def.standard.regular);
    else {
      doc.registerFontkit(fontkit);
      font = await doc.embedFont(fs.readFileSync(path.join(DIR, def.dir, useBold ? def.files.bold : def.files.regular)), { subset: !NO_SUBSET.has(def.key) });
    }
    const m = useBold && def.boldMetrics ? def.boldMetrics : def;
    cache.set(id, { font, ascent: m.ascent, descent: m.descent, custom: !def.standard });
  }
  return cache.get(id);
}

module.exports = { FONTS, FONT_KEYS, fontFile, publicList, embedFor };
