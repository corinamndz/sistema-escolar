const fs = require('fs');
const PDFDocument = require('pdfkit');

/**
 * Certificado de reconocimiento en PDF (A4 horizontal), estilo diploma,
 * generado en memoria (Buffer):
 *
 *   ┌═══ doble marco (color de la categoría + dorado) con adornos en las esquinas ═══┐
 *   │                          [logo del colegio]                                  │
 *   │                        NOMBRE DEL COLEGIO · RIF                              │
 *   │                 CERTIFICADO DE RECONOCIMIENTO                                │
 *   │                         se otorga a                                          │
 *   │                   Nombre Completo del Alumno                                 │
 *   │                 4to Año · Sección A · 2026-2027                              │
 *   │                 por  «Cuadro de honor del 1er lapso»                          │
 *   │                   [ Excelencia académica ]                                   │
 *   │            "mensaje personalizado, en cursiva"                               │
 *   │  Fecha ________           (sello)            ________ Quien otorga           │
 *   │                                                     N° de verificación       │
 *   └══════════════════════════════════════════════════════════════════════════════┘
 *
 * Solo fuentes estándar de PDF (Helvetica y Times): sin archivos de fuentes.
 */

const PAGE = { width: 841.89, height: 595.28 }; // A4 horizontal en puntos
const GOLD = '#c9a227';
const GOLD_LIGHT = '#f3e3a3';
const INK = '#1f2937';
const MUTED = '#6b7280';
const PAPER = '#fffdf6';

/** Color principal por categoría (los mismos tonos de la tarjeta del portal). */
const TONES = {
  excellence: '#d97706',
  effort: '#ea580c',
  conduct: '#0d9488',
  leadership: '#7c3aed',
  solidarity: '#e11d48',
  sports: '#0284c7',
  arts: '#7c3aed',
  other: '#d97706',
};

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** '2026-10-26' → '26 de octubre de 2026' */
const longDate = (d) => {
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
  return `${day} de ${MONTHS[m - 1]} de ${y}`;
};

/** Estrella de 5 puntas centrada en (cx, cy). */
function star(doc, cx, cy, outer, inner, color) {
  const pts = [];
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  doc.polygon(...pts).fill(color);
}

/** Adorno de esquina: dos trazos en L y una estrella. */
function corner(doc, x, y, sx, sy, color) {
  doc.save().lineWidth(2).strokeColor(color);
  doc.moveTo(x, y + sy * 46).lineTo(x, y).lineTo(x + sx * 46, y).stroke();
  doc.lineWidth(0.8).moveTo(x + sx * 7, y + sy * 34).lineTo(x + sx * 7, y + sy * 7).lineTo(x + sx * 34, y + sy * 7).stroke();
  doc.restore();
  star(doc, x + sx * 16, y + sy * 16, 6, 2.6, color);
}

/** Sello circular con estrella, en el color de la categoría. */
function seal(doc, cx, cy, color) {
  doc.save();
  // Cintas
  doc.polygon([cx - 18, cy + 22], [cx - 6, cy + 22], [cx - 14, cy + 58], [cx - 20, cy + 50], [cx - 28, cy + 54]).fill(color);
  doc.polygon([cx + 6, cy + 22], [cx + 18, cy + 22], [cx + 28, cy + 54], [cx + 20, cy + 50], [cx + 14, cy + 58]).fill(color);
  // Disco con borde dentado (24 puntas)
  const teeth = [];
  for (let i = 0; i < 48; i += 1) {
    const r = i % 2 === 0 ? 36 : 32;
    const a = (i * Math.PI) / 24;
    teeth.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  doc.polygon(...teeth).fill(GOLD);
  doc.circle(cx, cy, 28).fill(color);
  doc.circle(cx, cy, 24).lineWidth(1).strokeColor('#ffffff').stroke();
  star(doc, cx, cy, 13, 5.5, '#ffffff');
  doc.restore();
}

/**
 * @param {object} data
 * @param {{name, logoPath?, rif?}} data.tenant
 * @param {{id, title, message, category, categoryLabel, awardedOn, awardedByName, awardedByRole?,
 *          studentName, gradeName?, sectionName?, schoolPeriodName?}} data.recognition
 * @returns {Promise<Buffer>}
 */
function generateRecognitionCertificate({ tenant, recognition: r }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, info: { Title: `Reconocimiento · ${r.studentName}`, Author: tenant.name, Subject: r.title } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const tone = TONES[r.category] || TONES.other;
    const W = PAGE.width;
    const H = PAGE.height;
    const center = (text, y, opts = {}) => doc.text(text, 70, y, { width: W - 140, align: 'center', ...opts });

    // ---- Papel y marcos ----
    doc.rect(0, 0, W, H).fill(PAPER);
    doc.rect(18, 18, W - 36, H - 36).lineWidth(7).strokeColor(tone).stroke();
    doc.rect(30, 30, W - 60, H - 60).lineWidth(2).strokeColor(GOLD).stroke();
    doc.rect(36, 36, W - 72, H - 72).lineWidth(0.6).strokeColor(GOLD).stroke();
    corner(doc, 46, 46, 1, 1, GOLD);
    corner(doc, W - 46, 46, -1, 1, GOLD);
    corner(doc, 46, H - 46, 1, -1, GOLD);
    corner(doc, W - 46, H - 46, -1, -1, GOLD);
    // Confeti discreto
    [
      [120, 92, '#f43f5e'], [150, 70, '#0ea5e9'], [W - 130, 84, '#8b5cf6'], [W - 160, 108, '#f59e0b'],
      [96, H - 150, '#14b8a6'], [W - 100, H - 170, '#f97316'],
    ].forEach(([x, y, c]) => doc.circle(x, y, 3).fill(c));

    // ---- Logo y colegio ----
    let y = 56;
    if (tenant.logoPath && fs.existsSync(tenant.logoPath)) {
      try {
        doc.image(tenant.logoPath, W / 2 - 34, y, { fit: [68, 68], align: 'center', valign: 'center' });
        y += 74;
      } catch {
        // logo ilegible: se omite sin romper el certificado
      }
    }
    doc.font('Helvetica-Bold').fontSize(13).fillColor(INK);
    center(tenant.name.toUpperCase(), y, { characterSpacing: 1.5 });
    y += 17;
    if (tenant.rif) {
      doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
      center(`RIF ${tenant.rif}`, y);
      y += 13;
    }

    // ---- Encabezado ----
    y += 8;
    doc.font('Helvetica-Bold').fontSize(24).fillColor(tone);
    center('CERTIFICADO DE RECONOCIMIENTO', y, { characterSpacing: 3 });
    y += 32;
    doc.moveTo(W / 2 - 120, y).lineTo(W / 2 + 120, y).lineWidth(1).strokeColor(GOLD).stroke();
    star(doc, W / 2, y, 5, 2.2, GOLD);
    y += 12;
    doc.font('Times-Italic').fontSize(14).fillColor(MUTED);
    center('Se otorga con orgullo a', y);
    y += 22;

    // ---- Alumno ----
    doc.font('Times-BoldItalic').fontSize(36).fillColor(INK);
    center(r.studentName, y);
    y += 44;
    const course = [r.gradeName && r.sectionName ? `${r.gradeName} · Sección ${r.sectionName}` : r.gradeName, r.schoolPeriodName && `Año escolar ${r.schoolPeriodName}`].filter(Boolean).join('   ·   ');
    if (course) {
      doc.font('Helvetica').fontSize(10).fillColor(MUTED);
      center(course, y);
      y += 18;
    }

    // ---- Título y categoría ----
    doc.font('Times-Roman').fontSize(13).fillColor(MUTED);
    center('por', y);
    y += 16;
    doc.font('Helvetica-Bold').fontSize(19).fillColor(tone);
    center(`«${r.title}»`, y);
    y += 26;
    const label = r.categoryLabel.toUpperCase();
    doc.font('Helvetica-Bold').fontSize(8.5);
    const chipW = doc.widthOfString(label, { characterSpacing: 1.2 }) + 26;
    doc.roundedRect(W / 2 - chipW / 2, y, chipW, 18, 9).fill(GOLD_LIGHT);
    doc.fillColor('#7c5a0a').text(label, W / 2 - chipW / 2, y + 5, { width: chipW, align: 'center', characterSpacing: 1.2 });
    y += 30;

    // ---- Mensaje ----
    doc.font('Times-Italic').fontSize(12.5).fillColor(INK);
    const msg = `“${r.message}”`;
    doc.text(msg, 150, y, { width: W - 300, align: 'center', lineGap: 2, height: 62, ellipsis: true });

    // ---- Pie: fecha · sello · quien otorga ----
    const footY = H - 118;
    const colW = 220;
    doc.lineWidth(0.8).strokeColor(INK);
    doc.moveTo(100, footY + 22).lineTo(100 + colW, footY + 22).stroke();
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(longDate(r.awardedOn), 100, footY + 6, { width: colW, align: 'center' });
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text('Fecha', 100, footY + 27, { width: colW, align: 'center' });

    doc.moveTo(W - 100 - colW, footY + 22).lineTo(W - 100, footY + 22).stroke();
    doc.font('Times-BoldItalic').fontSize(14).fillColor(INK).text(r.awardedByName, W - 100 - colW, footY + 3, { width: colW, align: 'center', lineBreak: false, ellipsis: true });
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(r.awardedByRole ? `Otorgado por · ${r.awardedByRole}` : 'Otorgado por', W - 100 - colW, footY + 27, { width: colW, align: 'center' });

    seal(doc, W / 2, footY - 4, tone);

    doc.font('Helvetica').fontSize(7).fillColor('#9ca3af');
    center(`Certificado N° ${r.id.slice(0, 8).toUpperCase()} · emitido por ${tenant.name} con MoDo Educa`, H - 47);

    doc.end();
  });
}

module.exports = { generateRecognitionCertificate };
