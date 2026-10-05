const fs = require('fs');
const PDFDocument = require('pdfkit');

/**
 * Comprobante de pago en PDF (A5 vertical), generado en memoria (Buffer).
 *
 * Diseño tipo recibo oficial:
 *   ┌ franja de color del colegio ───────────────────────────────┐
 *   │ [logo] Nombre del colegio          COMPROBANTE DE PAGO     │
 *   │        contacto                    N° 6B1F-0C2E            │
 *   │ ┌ Alumno y representante ┐ ┌ Datos del pago ┐             │
 *   │ └────────────────────────┘ └────────────────┘             │
 *   │ Concepto ............................................ $    │
 *   │ ┌ TOTAL PAGADO  $120,00   │  COL$ 494.820,00 ┐ [VERIFICADO]│
 *   │   (monto base en USD)       tasa del día + fecha valor     │
 *   │ pie legal + código de verificación                         │
 *
 * Solo usa fuentes estándar de PDF (Helvetica): no depende de archivos de fuentes.
 */

const PAGE = { width: 419.53, height: 595.28 }; // A5 en puntos
const M = 30; // margen
const INNER = PAGE.width - M * 2;

const INK = '#0f172a';
const MUTED = '#64748b';
const SUBTLE = '#94a3b8';
const BORDER = '#e2e8f0';
const CARD = '#f8fafc';
const SUCCESS = '#059669';

const METHOD_LABELS = {
  transfer: 'Transferencia',
  mobile_payment: 'Pago móvil',
  deposit: 'Depósito',
  cash: 'Efectivo',
  card: 'Tarjeta',
  other: 'Otro',
};

const USD = { code: 'USD', name: 'Dólar estadounidense', symbol: '$', decimals: 2, locale: 'es-VE' };

/**
 * Monto con el formato de su moneda: "$120,00", "Bs. 102.840,70",
 * "COL$ 494.820,00", "S/ 450.00", "CLP$ 110.000".
 * Helvetica (fuente estándar de PDF) no tiene glifos como ₲ o ₡: en ese caso
 * se usa el código ISO ("PYG 875.000").
 */
function money(amount, cur = USD) {
  const num = Number(amount).toLocaleString(cur.locale || 'es', {
    minimumFractionDigits: cur.decimals ?? 2,
    maximumFractionDigits: cur.decimals ?? 2,
  });
  if (cur.code === 'USD') return `$${num}`;
  return `${pdfSymbol(cur)} ${num}`;
}

const pdfSymbol = (cur) => (/^[\x20-\x7E]+$/.test(cur.symbol || '') ? cur.symbol : cur.code);

/** Tasa (moneda local por USD) con 2 a 4 decimales. */
const rateText = (rate, cur) =>
  `${pdfSymbol(cur)} ${Number(rate).toLocaleString(cur.locale || 'es', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;


/** 'YYYY-MM-DD' o Date → "28/09/2026" (fecha de calendario sin corrimiento de zona horaria). */
function dmy(value) {
  if (!value) return '—';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const [y, m, d] = value.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }
  return new Date(value).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Número corto y legible derivado del id del pago: "6B1F-0C2E". */
const receiptCode = (id) => String(id).replace(/-/g, '').slice(0, 8).toUpperCase().replace(/^(.{4})/, '$1-');

function validHex(color, fallback) {
  return /^#[0-9a-f]{6}$/i.test(color || '') ? color : fallback;
}

/** Texto legible sobre un fondo de color (luminancia WCAG), igual que el tema del frontend. */
function textOn(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? INK : '#ffffff';
}

/** Si el color del colegio es muy claro (p. ej. amarillo), se usa uno oscuro para TEXTO sobre blanco. */
function inkFor(hex) {
  return textOn(hex) === INK ? INK : hex;
}

function label(doc, text, x, y, width) {
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor(SUBTLE).text(text.toUpperCase(), x, y, { width, characterSpacing: 0.6, lineBreak: false });
}

/** Tarjeta con título y filas etiqueta/valor. Devuelve la altura usada. */
function infoCard(doc, { x, y, width, title, rows, accent }) {
  const pad = 10;
  const rowH = 21;
  const height = pad + 12 + rows.length * rowH + pad - 4;
  doc.roundedRect(x, y, width, height, 7).fillAndStroke(CARD, BORDER);
  doc.rect(x, y + 8, 2.5, 12).fill(accent);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(INK).text(title, x + pad, y + pad, { width: width - pad * 2, lineBreak: false });
  rows.forEach(([key, value], i) => {
    const ry = y + pad + 16 + i * rowH;
    label(doc, key, x + pad, ry, width - pad * 2);
    doc.font('Helvetica').fontSize(8.6).fillColor(INK).text(value || '—', x + pad, ry + 7.5, { width: width - pad * 2, lineBreak: false, ellipsis: true });
  });
  return height;
}

/** Sello "PAGO VERIFICADO" girado, con marca de verificación dibujada (sin depender de fuentes con símbolos). */
function stamp(doc, cx, cy) {
  const w = 104;
  const h = 34;
  doc.save();
  doc.rotate(-9, { origin: [cx, cy] });
  doc.opacity(0.92);
  doc.lineWidth(1.6).roundedRect(cx - w / 2, cy - h / 2, w, h, 5).stroke(SUCCESS);
  doc.lineWidth(0.6).roundedRect(cx - w / 2 + 3, cy - h / 2 + 3, w - 6, h - 6, 3).stroke(SUCCESS);
  // check ✓ vectorial
  doc.lineWidth(2).lineCap('round').lineJoin('round');
  doc.moveTo(cx - 42, cy - 1).lineTo(cx - 37, cy + 5).lineTo(cx - 28, cy - 6).stroke(SUCCESS);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(SUCCESS).text('PAGO', cx - 22, cy - 9, { width: 64, align: 'center', characterSpacing: 2 });
  doc.text('VERIFICADO', cx - 22, cy + 1, { width: 64, align: 'center', characterSpacing: 0.8 });
  doc.restore();
}

/**
 * @param {object} data
 * @param {{name, logoPath?, primaryColor?, contactEmail?, contactPhone?}} data.tenant
 * @param {{id, issuedAt}} data.receipt
 * @param {{name, nationalId?, section?, schoolPeriod?}} data.student
 * @param {{name, nationalId?}} data.guardian
 * @param {{concept, kind?, paidOn?, method?, reference?, currency, amount,
 *          ref?: {code, name, symbol, decimals, locale, amount, rate, rateDate}}} data.payment
 *   `ref`: moneda de referencia en que se pagó y su conversión congelada.
 */
function generateReceiptPdf({ tenant, receipt, student, guardian, payment }) {
  const ref = payment.ref || null;
  // Moneda del cobro: USD (tarifa base) o, en un cargo en moneda local, esa moneda.
  const chargeCur = payment.currency === 'USD' ? USD : ref && ref.code === payment.currency ? ref : { ...USD, code: payment.currency, symbol: payment.currency };
  // Hubo conversión: cobro en USD pagado en otra moneda (VES, COP…).
  const converted = Boolean(ref && ref.code !== payment.currency);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A5',
      margin: 0,
      info: { Title: `Comprobante ${receiptCode(receipt.id)} - ${tenant.name}`, Author: tenant.name, Subject: payment.concept },
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const brand = validHex(tenant.primaryColor, '#2563eb');
    const brandInk = inkFor(brand);

    // ---- Franja superior ----
    doc.rect(0, 0, PAGE.width, 7).fill(brand);

    // ---- Cabecera: logo + colegio | tipo y número ----
    let y = 26;
    const logoSize = 46;
    let textX = M;
    if (tenant.logoPath && fs.existsSync(tenant.logoPath)) {
      try {
        doc.roundedRect(M, y, logoSize, logoSize, 8).fillAndStroke('#ffffff', BORDER);
        doc.image(tenant.logoPath, M + 4, y + 4, { fit: [logoSize - 8, logoSize - 8], align: 'center', valign: 'center' });
        textX = M + logoSize + 11;
      } catch {
        textX = M; // logo ilegible: se omite sin romper el comprobante
      }
    }
    const headerRight = 148;
    doc.font('Helvetica-Bold').fontSize(13.5).fillColor(INK).text(tenant.name, textX, y + 6, { width: INNER - (textX - M) - headerRight, lineBreak: false, ellipsis: true });
    const contactWidth = INNER - (textX - M) - headerRight;
    [tenant.contactEmail, tenant.contactPhone].filter(Boolean).forEach((line, i) => {
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(line, textX, y + 25 + i * 10, { width: contactWidth, lineBreak: false, ellipsis: true });
    });

    const rx = PAGE.width - M - headerRight;
    doc.font('Helvetica-Bold').fontSize(7).fillColor(brandInk).text('COMPROBANTE DE PAGO', rx, y + 4, { width: headerRight, align: 'right', characterSpacing: 1 });
    doc.font('Helvetica-Bold').fontSize(15).fillColor(INK).text(`N° ${receiptCode(receipt.id)}`, rx, y + 15, { width: headerRight, align: 'right' });
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(`Emitido el ${dmy(receipt.issuedAt)}`, rx, y + 34, { width: headerRight, align: 'right' });

    y += logoSize + 20;
    doc.moveTo(M, y).lineTo(PAGE.width - M, y).lineWidth(0.8).stroke(BORDER);
    y += 18;

    // ---- Cuadrícula de dos columnas ----
    const gap = 10;
    const colW = (INNER - gap) / 2;
    const leftH = infoCard(doc, {
      x: M,
      y,
      width: colW,
      title: 'Alumno y representante',
      accent: brand,
      rows: [
        ['Alumno', student.name],
        ['Cédula / documento', student.nationalId],
        ['Grado y sección', [student.section, student.schoolPeriod].filter(Boolean).join(' · ')],
        ['Representante', guardian.nationalId ? `${guardian.name} · C.I. ${guardian.nationalId}` : guardian.name],
      ],
    });
    const rightH = infoCard(doc, {
      x: M + colW + gap,
      y,
      width: colW,
      title: 'Datos del pago',
      accent: brand,
      rows: [
        ['Fecha de pago', dmy(payment.paidOn || receipt.issuedAt)],
        ['Método', METHOD_LABELS[payment.method] || (payment.method ? payment.method : 'No indicado')],
        ['Moneda', ref ? `${ref.name} (${ref.code})` : chargeCur.code],
        ['Referencia', payment.reference],
        ['Registrado', dmy(receipt.issuedAt)],
      ],
    });
    y += Math.max(leftH, rightH) + 22;

    // ---- Detalle del concepto (estilo factura) ----
    label(doc, 'Concepto', M, y, INNER);
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(SUBTLE).text('MONTO', M, y, { width: INNER, align: 'right', characterSpacing: 0.6 });
    y += 11;
    doc.moveTo(M, y).lineTo(PAGE.width - M, y).lineWidth(0.6).stroke(BORDER);
    y += 8;
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(payment.concept, M, y, { width: INNER - 110, lineBreak: false, ellipsis: true });
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(money(payment.amount, chargeCur), M, y, { width: INNER, align: 'right' });
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(payment.kind === 'tuition' ? 'Mensualidad' : 'Otro cobro', M, y + 13, { width: INNER - 110, lineBreak: false });
    y += 32;
    doc.moveTo(M, y).lineTo(PAGE.width - M, y).lineWidth(0.6).stroke(BORDER);
    y += 20;

    // ---- Tarjeta de montos (jerarquía principal) ----
    const onBrand = textOn(brand);
    const boxH = converted ? 98 : 70;
    doc.roundedRect(M, y, INNER, boxH, 10).fill(brand);
    const pad = 16;
    doc.font('Helvetica-Bold').fontSize(7).fillColor(onBrand).opacity(0.8).text('TOTAL PAGADO', M + pad, y + 14, { characterSpacing: 1.2 });
    doc.opacity(1);

    if (!converted) {
      // Pagado en la misma moneda del cobro (ej. USD en efectivo, o un cargo en Bs).
      doc.font('Helvetica-Bold').fontSize(24).fillColor(onBrand).text(money(payment.amount, chargeCur), M + pad, y + 27);
    } else {
      doc.font('Helvetica-Bold').fontSize(26).fillColor(onBrand).text(money(payment.amount, USD), M + pad, y + 26);
      doc.font('Helvetica').fontSize(7.5).fillColor(onBrand).opacity(0.85).text('Monto base en divisa (USD)', M + pad, y + 62);
      doc.opacity(1);
      // divisor vertical y conversión
      const half = M + INNER / 2 + 6;
      doc.moveTo(half - 10, y + 16).lineTo(half - 10, y + boxH - 16).lineWidth(0.6).strokeColor(onBrand).opacity(0.35).stroke();
      doc.opacity(1);
      doc.font('Helvetica-Bold').fontSize(7).fillColor(onBrand).opacity(0.8)
        // Solo el código: el nombre de la moneda ya figura en "Datos del pago" y uno largo partiría la línea.
        .text(`EQUIVALENTE EN ${ref.code}`, half, y + 14, { characterSpacing: 1, lineBreak: false });
      doc.opacity(1);
      const colW = INNER / 2 - pad - 6;
      if (ref.amount !== null && ref.amount !== undefined) {
        doc.font('Helvetica-Bold').fontSize(17).fillColor(onBrand).text(money(ref.amount, ref), half, y + 31, { width: colW, lineBreak: false });
        doc.font('Helvetica').fontSize(7.5).fillColor(onBrand).opacity(0.85)
          .text(`Tasa del día: ${rateText(ref.rate, ref)} por USD`, half, y + 58, { width: colW, lineBreak: false });
        doc.text(`Fecha valor: ${dmy(ref.rateDate)}${ref.code === 'VES' ? ' (BCV)' : ''}`, half, y + 70, { width: colW, lineBreak: false });
        doc.opacity(1);
      } else {
        doc.font('Helvetica').fontSize(8.5).fillColor(onBrand).text('Sin conversión registrada', half, y + 34);
      }
    }
    y += boxH + 28;

    // ---- Sello ----
    stamp(doc, PAGE.width - M - 62, y + 22);
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(
      'El colegio verificó y registró este pago. Conserve este comprobante como constancia.',
      M,
      y + 6,
      { width: INNER - 140 }
    );
    if (payment.note) {
      label(doc, 'Observaciones', M, y + 34, INNER - 140);
      doc.font('Helvetica').fontSize(8).fillColor(INK).text(payment.note, M, y + 43, { width: INNER - 140, height: 36, ellipsis: true });
    }

    // ---- Pie legal (discreto, al fondo de la página) ----
    const footY = PAGE.height - 58;
    doc.moveTo(M, footY).lineTo(PAGE.width - M, footY).lineWidth(0.6).stroke(BORDER);
    doc.font('Helvetica').fontSize(6.5).fillColor(SUBTLE)
      .text('Comprobante generado electrónicamente por el sistema de gestión escolar. No requiere firma ni sello húmedo.', M, footY + 9, { width: INNER, align: 'center' })
      .text(`Código de verificación: ${receipt.id}`, M, footY + 19, { width: INNER, align: 'center' });
    doc.rect(0, PAGE.height - 5, PAGE.width, 5).fill(brand);

    doc.end();
  });
}

module.exports = { generateReceiptPdf, receiptCode };
