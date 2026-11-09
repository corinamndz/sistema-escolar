const { PDFDocument, degrees, rgb } = require('pdf-lib');
const { embedFor } = require('./certificateFonts');

/**
 * Motor del certificado: fusiona el fondo del colegio (imagen o primera página de
 * un PDF, que conserva su calidad vectorial) con las variables en sus posiciones.
 * Usa pdf-lib porque PDFKit no puede incrustar páginas de un PDF existente.
 *
 * x, y son fracciones de la hoja (ver migración 091). Mismas fórmulas que el
 * editor: frontend/src/features/certificates/pages/CertificateEditorPage.jsx.
 */

/** Tamaño de la hoja para una imagen: su lado largo mide lo que el de un A4, con su misma proporción. */
const A4_LONG_SIDE = 841.89;
const pageForImage = (w, h) => (w >= h ? { width: A4_LONG_SIDE, height: (A4_LONG_SIDE * h) / w } : { width: (A4_LONG_SIDE * w) / h, height: A4_LONG_SIDE });

/**
 * Línea base respecto del centro vertical de una línea de texto, en fracción del
 * tamaño de letra: (ascent − descent) / 2, con las métricas de cada fuente, las
 * mismas que fija el CSS del editor (certificateFonts.js).
 */
const baselineOf = (m) => (m.ascent - m.descent) / 2;
const LINE_HEIGHT = 1.2;
const TOKEN = /\{\{\s*(\w+)\s*\}\}/g;

/** Lee el archivo subido y dice qué es y qué tamaño tiene. Lanza un error si no se puede usar. */
async function inspectBackground(buffer, type) {
  const doc = await PDFDocument.create();
  if (type === 'png' || type === 'jpg') {
    const image = await (type === 'png' ? doc.embedPng(buffer) : doc.embedJpg(buffer));
    return pageForImage(image.width, image.height);
  }
  const source = await PDFDocument.load(buffer); // lanza si está dañado o protegido con clave
  const page = source.getPage(0);
  const { width, height } = page.getSize();
  const quarter = ((page.getRotation().angle % 360) + 360) % 360;
  return quarter === 90 || quarter === 270 ? { width: height, height: width, pages: source.getPageCount() } : { width, height, pages: source.getPageCount() };
}

const hexColor = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return rgb(r, g, b);
};

/** Quita los caracteres que la fuente no tiene (el español entra completo en todas). */
function printable(font, text) {
  const glyphs = font.embedder?.font; // fuente incrustada: se pregunta a sus glifos
  return [...String(text)]
    .filter((ch) => {
      if (ch === '\n' || ch === '\r' || ch === '\t') return true; // los resuelve el reparto en líneas
      if (glyphs?.hasGlyphForCodePoint) return glyphs.hasGlyphForCodePoint(ch.codePointAt(0));
      try {
        font.encodeText(ch);
        return true;
      } catch {
        return false;
      }
    })
    .join('');
}

/** Prepara el fondo una sola vez: en un lote, todas las páginas comparten el mismo archivo. → (page) => dibuja */
async function prepareBackground(doc, buffer, type, width, height) {
  if (type === 'png' || type === 'jpg') {
    const image = await (type === 'png' ? doc.embedPng(buffer) : doc.embedJpg(buffer));
    return (page) => page.drawImage(image, { x: 0, y: 0, width, height });
  }
  const source = await PDFDocument.load(buffer);
  const first = source.getPage(0);
  // Una página sin contenido (en blanco) no se puede incrustar: es un fondo blanco.
  if (!first.node.Contents()) return () => {};
  const quarter = ((first.getRotation().angle % 360) + 360) % 360;
  const [embedded] = await doc.embedPages([first]);
  // Compensa la rotación que traiga la página del PDF.
  const at = { 0: { x: 0, y: 0 }, 90: { x: 0, y: height }, 180: { x: width, y: height }, 270: { x: width, y: 0 } }[quarter] || { x: 0, y: 0 };
  return (page) => page.drawPage(embedded, { ...at, rotate: degrees(-quarter) });
}

/** Cambia cada {{variable}} por su valor. */
const fillTokens = (content, values) => String(content).replace(TOKEN, (_, key) => values[key] ?? '');

/** Parte un texto en líneas: respeta los saltos de línea y no pasa de `maxWidth`. */
function wrapLines(font, text, size, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    for (const word of paragraph.split(/[ \t]+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

const xFor = (align, anchor, w) => (align === 'center' ? anchor - w / 2 : align === 'right' ? anchor - w : anchor);

/**
 * Bloque de texto libre: varias líneas dentro de un ancho (fracción de la hoja),
 * con `y` en el centro del bloque. Puede llevar {{variables}}, y entonces cada
 * alumno ocupa las líneas que necesite su texto, sin mover el centro del bloque.
 */
function drawBlock(page, { font, ...metrics }, f, width, height, values) {
  const lines = wrapLines(font, printable(font, fillTokens(f.content, values)), f.fontSize, (f.width ?? 0.6) * width);
  const leading = f.fontSize * LINE_HEIGHT;
  const top = f.y * height - (lines.length * leading) / 2;
  const anchor = f.x * width;
  lines.forEach((line, i) => {
    if (!line) return;
    const baseline = height - (top + (i + 0.5) * leading) - f.fontSize * baselineOf(metrics);
    page.drawText(line, { x: xFor(f.align, anchor, font.widthOfTextAtSize(line, f.fontSize)), y: baseline, size: f.fontSize, font, color: hexColor(f.color) });
  });
}

/**
 * Logo del colegio (type: 'logo'): una caja de `width` (fracción del ancho de la
 * hoja) por `height` (fracción del alto), anclada en x según `align` como los
 * textos y con `y` en su centro. El logo cabe entero en la caja sin deformarse,
 * centrado en vertical y alineado a la izquierda, al centro o a la derecha.
 * Mismas cuentas que el editor (CertificateEditorPage.jsx, logoStyle).
 */
function drawLogo(page, image, f, width, height) {
  const boxW = f.width * width;
  const boxH = f.height * height;
  const left = xFor(f.align, f.x * width, boxW);
  const top = f.y * height - boxH / 2;
  const fit = Math.min(boxW / image.width, boxH / image.height);
  const w = image.width * fit;
  const h = image.height * fit;
  const x = left + { left: 0, center: (boxW - w) / 2, right: boxW - w }[f.align];
  page.drawImage(image, { x, y: height - (top + (boxH - h) / 2) - h, width: w, height: h });
}

/**
 * Una página por alumno, en un solo PDF.
 *   background { buffer, type }   ·   width, height   hoja en puntos
 *   fields     variables, textos libres y el logo   ·   pages   [{ <variable>: texto }]
 *   logo       { buffer, type: 'png' | 'jpg' } del colegio, o null: sin logo, su caja no se dibuja
 * Una variable más larga que el espacio disponible se reduce para no pisar el marco.
 */
async function generateCertificates({ background, width, height, fields, pages, logo = null, title = 'Certificado de promoción', author = '' }) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor(author);
  const drawBackground = await prepareBackground(doc, background.buffer, background.type, width, height);
  // El logo se incrusta una sola vez, aunque el lote tenga cientos de páginas.
  const logoImage = logo && fields.some((f) => f.type === 'logo') ? await (logo.type === 'png' ? doc.embedPng(logo.buffer) : doc.embedJpg(logo.buffer)) : null;

  const embedded = new Map();
  const fontFor = (f) => embedFor(doc, f.font, f.bold, embedded);
  const MARGIN = width * 0.06; // para no pisar el marco que suelen traer los diseños
  for (const values of pages) {
    const page = doc.addPage([width, height]);
    drawBackground(page);
    for (const f of fields) {
      if (f.type === 'logo') {
        if (logoImage) drawLogo(page, logoImage, f, width, height);
        continue;
      }
      const face = await fontFor(f);
      const { font } = face;
      if (f.type === 'custom_text') {
        drawBlock(page, face, f, width, height, values);
        continue;
      }
      const text = printable(font, values[f.key] ?? '');
      if (!text) continue;
      const anchor = f.x * width;
      const room = { left: width - anchor - MARGIN, right: anchor - MARGIN, center: 2 * Math.min(anchor, width - anchor) - MARGIN * 2 }[f.align] ?? width;
      let size = f.fontSize;
      const natural = font.widthOfTextAtSize(text, size);
      if (natural > room && room > 0) size = (size * room) / natural;
      const baseline = height - f.y * height - size * baselineOf(face);
      page.drawText(text, { x: xFor(f.align, anchor, font.widthOfTextAtSize(text, size)), y: baseline, size, font, color: hexColor(f.color) });
    }
  }
  return Buffer.from(await doc.save());
}

/**
 * Une varios PDF en uno, con las páginas en el orden original.
 *   parts  [{ buffer, indices }]: la página k de cada parte va en la posición indices[k].
 */
async function mergeInOrder(parts, total) {
  const out = await PDFDocument.create();
  const slots = new Array(total);
  for (const part of parts) {
    const source = await PDFDocument.load(part.buffer);
    const pages = await out.copyPages(source, source.getPageIndices());
    pages.forEach((p, k) => {
      slots[part.indices[k]] = p;
    });
  }
  slots.forEach((p) => out.addPage(p));
  const first = await PDFDocument.load(parts[0].buffer);
  out.setTitle(first.getTitle() || 'Certificado de promoción');
  out.setAuthor(first.getAuthor() || '');
  return Buffer.from(await out.save());
}

module.exports = { generateCertificates, inspectBackground, mergeInOrder };
