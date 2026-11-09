const { PDFDocument, rgb } = require('pdf-lib');

/**
 * Plantillas estándar del certificado, para los colegios sin diseño propio: fondos
 * vectoriales (A4 horizontal) con el color principal del colegio, y una distribución
 * sugerida de textos y variables que encaja en cada fondo. Al aplicarla, el fondo
 * queda como el de cualquier otro diseño y los textos se editan normalmente.
 */

const W = 841.89;
const H = 595.28;
const GOLD = '#b08d57';
const INK = '#1f2937';
const GRAY = '#6b7280';

const validHex = (c, fb) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c.toLowerCase() : fb);
const toRgb = (hex) => rgb(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255));
/** Mezcla con blanco (amount 0 = color, 1 = blanco), para tonos suaves del color del colegio. */
const tint = (hex, amount) => `#${[1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) + (255 - parseInt(hex.slice(i, i + 2), 16)) * amount).toString(16).padStart(2, '0')).join('')}`;
/** Oscurece (amount 0 = color, 1 = negro). */
const shade = (hex, amount) => `#${[1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - amount)).toString(16).padStart(2, '0')).join('')}`;
/** y medida desde arriba, en fracción de la hoja → coordenada PDF. */
const fromTop = (f) => H * (1 - f);

/** Dos líneas de firma, a la altura de los rótulos de la distribución sugerida. */
function signatureLines(page, color, { y = 0.835, xs = [0.28, 0.72], half = 0.11 } = {}) {
  for (const x of xs) page.drawLine({ start: { x: W * (x - half), y: fromTop(y) }, end: { x: W * (x + half), y: fromTop(y) }, thickness: 0.8, color: toRgb(color) });
}

const DESIGNS = {
  classic: {
    label: 'Marco clásico elegante',
    description: 'Fondo marfil, marco dorado doble con adornos en las esquinas y sello.',
    draw(page, brand) {
      page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: toRgb('#fbf7ee') });
      page.drawRectangle({ x: 18, y: 18, width: W - 36, height: H - 36, borderColor: toRgb(GOLD), borderWidth: 3 });
      page.drawRectangle({ x: 27, y: 27, width: W - 54, height: H - 54, borderColor: toRgb(GOLD), borderWidth: 0.8 });
      page.drawRectangle({ x: 33, y: 33, width: W - 66, height: H - 66, borderColor: toRgb(shade(brand, 0.1)), borderWidth: 0.5 });
      // Esquinas: rombo y dos trazos.
      for (const [cx, cy, sx, sy] of [[27, 27, 1, 1], [W - 27, 27, -1, 1], [27, H - 27, 1, -1], [W - 27, H - 27, -1, -1]]) {
        page.drawSvgPath('M 0 -9 L 9 0 L 0 9 L -9 0 Z', { x: cx, y: cy, color: toRgb(GOLD) });
        page.drawLine({ start: { x: cx + sx * 14, y: cy + sy * 6 }, end: { x: cx + sx * 60, y: cy + sy * 6 }, thickness: 0.8, color: toRgb(GOLD) });
        page.drawLine({ start: { x: cx + sx * 6, y: cy + sy * 14 }, end: { x: cx + sx * 6, y: cy + sy * 60 }, thickness: 0.8, color: toRgb(GOLD) });
      }
      // Filete bajo el título.
      page.drawLine({ start: { x: W * 0.36, y: fromTop(0.275) }, end: { x: W * 0.64, y: fromTop(0.275) }, thickness: 0.8, color: toRgb(GOLD) });
      page.drawSvgPath('M 0 -4 L 4 0 L 0 4 L -4 0 Z', { x: W / 2, y: fromTop(0.275), color: toRgb(GOLD) });
      // Sello.
      page.drawCircle({ x: W / 2, y: fromTop(0.84), size: 36, borderColor: toRgb(GOLD), borderWidth: 1.6 });
      page.drawCircle({ x: W / 2, y: fromTop(0.84), size: 30, borderColor: toRgb(GOLD), borderWidth: 0.6, borderDashArray: [2, 2] });
      signatureLines(page, GOLD, { xs: [0.25, 0.75] });
    },
    fonts: { title: 'cinzel', name: 'greatvibes', body: 'gelasio' },
    colors: (brand) => ({ title: shade(GOLD, 0.25), name: shade(brand, 0.25), body: INK }),
    layout: { cx: 0.5, sigXs: [0.25, 0.75], titleY: 0.2, nameSize: 44 },
  },
  modern: {
    label: 'Moderno minimalista',
    description: 'Fondo blanco, una franja lateral con el color del colegio y mucho aire.',
    draw(page, brand) {
      page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: toRgb('#ffffff') });
      page.drawRectangle({ x: 0, y: 0, width: W * 0.075, height: H, color: toRgb(brand) });
      page.drawRectangle({ x: W * 0.075, y: 0, width: 5, height: H, color: toRgb(tint(brand, 0.55)) });
      // Puntos en la esquina superior derecha.
      for (let r = 0; r < 4; r += 1) for (let c = 0; c < 7; c += 1) page.drawCircle({ x: W - 46 - c * 12, y: H - 40 - r * 12, size: 1.8, color: toRgb(tint(brand, 0.45)) });
      page.drawRectangle({ x: W * 0.47, y: fromTop(0.285), width: W * 0.13, height: 3, color: toRgb(brand) });
      page.drawLine({ start: { x: W * 0.13, y: 34 }, end: { x: W - 40, y: 34 }, thickness: 0.6, color: toRgb(tint(brand, 0.5)) });
      signatureLines(page, '#9ca3af', { xs: [0.33, 0.75] });
    },
    fonts: { title: 'montserrat', name: 'playfair', body: 'montserrat' },
    colors: (brand) => ({ title: brand, name: INK, body: GRAY }),
    layout: { cx: 0.535, sigXs: [0.33, 0.75], titleY: 0.2, nameSize: 34 },
  },
  institutional: {
    label: 'Institucional ejecutivo',
    description: 'Bandas superior e inferior con el color del colegio, marco fino y marca de agua.',
    draw(page, brand) {
      page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: toRgb('#ffffff') });
      page.drawRectangle({ x: 0, y: H - H * 0.085, width: W, height: H * 0.085, color: toRgb(shade(brand, 0.2)) });
      page.drawRectangle({ x: 0, y: H - H * 0.085 - 4, width: W, height: 4, color: toRgb(GOLD) });
      page.drawRectangle({ x: 0, y: 0, width: W, height: H * 0.04, color: toRgb(shade(brand, 0.2)) });
      page.drawRectangle({ x: 22, y: H * 0.04 + 14, width: W - 44, height: H - H * 0.085 - 4 - H * 0.04 - 28, borderColor: toRgb('#cbd5e1'), borderWidth: 0.8 });
      page.drawCircle({ x: W / 2, y: H * 0.47, size: 150, color: toRgb(brand), opacity: 0.05 });
      page.drawCircle({ x: W / 2, y: H * 0.47, size: 150, borderColor: toRgb(brand), borderWidth: 1, borderOpacity: 0.12 });
      signatureLines(page, '#6b7280', { xs: [0.28, 0.72] });
    },
    fonts: { title: 'playfair', name: 'gelasio', body: 'arimo' },
    colors: (brand) => ({ title: shade(brand, 0.2), name: INK, body: '#374151' }),
    layout: { cx: 0.5, sigXs: [0.28, 0.72], titleY: 0.215, nameSize: 32 },
  },
  geometric: {
    label: 'Borde geométrico',
    description: 'Marco de triángulos con el color del colegio y dorado, y panel central blanco.',
    draw(page, brand) {
      page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: toRgb(tint(brand, 0.9)) });
      const size = 22;
      const tri = (x, y, up, color) => page.drawSvgPath(up ? `M 0 ${size} L ${size / 2} 0 L ${size} ${size} Z` : `M 0 0 L ${size} 0 L ${size / 2} ${size} Z`, { x, y: y + size, color: toRgb(color) });
      for (let i = 0, x = 0; x < W; i += 1, x += size / 2) {
        tri(x - size / 4, H - size, i % 2 === 0, i % 4 < 2 ? brand : GOLD);
        tri(x - size / 4, 0, i % 2 === 1, i % 4 < 2 ? brand : GOLD);
      }
      for (let i = 0, y = size; y < H - size; i += 1, y += size / 2) {
        const c = i % 4 < 2 ? brand : GOLD;
        page.drawSvgPath(i % 2 === 0 ? `M 0 0 L ${size} ${size / 2} L 0 ${size} Z` : `M ${size} 0 L 0 ${size / 2} L ${size} ${size} Z`, { x: 0, y: y + size, color: toRgb(c) });
        page.drawSvgPath(i % 2 === 0 ? `M ${size} 0 L 0 ${size / 2} L ${size} ${size} Z` : `M 0 0 L ${size} ${size / 2} L 0 ${size} Z`, { x: W - size, y: y + size, color: toRgb(c) });
      }
      page.drawRectangle({ x: 42, y: 42, width: W - 84, height: H - 84, color: toRgb('#ffffff'), borderColor: toRgb(brand), borderWidth: 1.2 });
      page.drawRectangle({ x: 48, y: 48, width: W - 96, height: H - 96, borderColor: toRgb(GOLD), borderWidth: 0.6 });
      signatureLines(page, '#9ca3af', { xs: [0.28, 0.72] });
    },
    fonts: { title: 'montserrat', name: 'playfair', body: 'arimo' },
    colors: (brand) => ({ title: shade(brand, 0.15), name: INK, body: '#374151' }),
    layout: { cx: 0.5, sigXs: [0.28, 0.72], titleY: 0.2, nameSize: 34 },
  },
};
const STANDARD_KEYS = Object.keys(DESIGNS);

/** Fondo de la plantilla `key` con el color del colegio. → Buffer (PDF de una página). */
async function standardBackground(key, brandColor) {
  const design = DESIGNS[key];
  if (!design) throw new Error(`Plantilla desconocida: ${key}`);
  const doc = await PDFDocument.create();
  doc.setTitle(`Plantilla estándar · ${design.label}`);
  const page = doc.addPage([W, H]);
  design.draw(page, validHex(brandColor, '#1e3a8a'));
  return Buffer.from(await doc.save());
}

/** Distribución sugerida de textos y variables para esa plantilla. */
function standardFields(key, brandColor) {
  const d = DESIGNS[key];
  const brand = validHex(brandColor, '#1e3a8a');
  const c = d.colors(brand);
  const { cx, sigXs, titleY, nameSize } = d.layout;
  const text = (id, content, extra) => ({ type: 'custom_text', id, content, x: cx, width: 0.66, align: 'center', bold: false, color: c.body, font: d.fonts.body, fontSize: 13, ...extra });
  return [
    text('titulo', 'CERTIFICADO DE PROMOCIÓN', { y: titleY, width: 0.8, fontSize: 30, bold: d.fonts.title !== 'greatvibes', font: d.fonts.title, color: c.title }),
    text('otorga', 'La Dirección del plantel certifica que', { y: 0.34, fontSize: 14 }),
    { key: 'student_name', x: cx, y: 0.435, fontSize: nameSize, color: c.name, align: 'center', font: d.fonts.name, bold: d.fonts.name !== 'greatvibes' },
    text('cuerpo', 'titular de la cédula {{student_id}}, cursó y aprobó el año escolar {{school_year}} y es promovido(a) a {{target_grade}}.', { y: 0.55 }),
    text('fecha', 'Expedido el {{issue_date}}.', { y: 0.65, fontSize: 11, color: GRAY }),
    text('firma1', 'Director(a)', { x: sigXs[0], y: 0.865, width: 0.24, fontSize: 11, bold: true, color: INK }),
    text('firma2', 'Docente guía', { x: sigXs[1], y: 0.865, width: 0.24, fontSize: 11, bold: true, color: INK }),
  ];
}

const standardList = () => STANDARD_KEYS.map((key) => ({ key, label: DESIGNS[key].label, description: DESIGNS[key].description }));

module.exports = { STANDARD_KEYS, standardBackground, standardFields, standardList };
