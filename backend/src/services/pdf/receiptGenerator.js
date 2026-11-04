const fs = require('fs');
const PDFDocument = require('pdfkit');

/**
 * Comprobante de pago en PDF (A5 vertical), generado en memoria (Buffer).
 * Es lo que se ve en pantalla (se abre en el navegador), se imprime y se envía por correo.
 *
 * Diseño ligero: sin tarjetas con borde ni bloques de color sólido; jerarquía
 * por tipografía y espacio en blanco, con el color del colegio solo como acento.
 *   ─ línea fina de color ─────────────────────────────────────
 *   [logo] Nombre del colegio            COMPROBANTE DE PAGO
 *          RIF · contacto                N° 6B1F-0C2E
 *   ───────────────────────────────────────────────────────────
 *   ALUMNO Y REPRESENTANTE              DATOS DEL PAGO
 *   etiqueta / valor…                   etiqueta / valor…
 *   Concepto ........................................... $
 *   ░ TOTAL PAGADO $120,00  │  equivalente + tasa ░   (fondo tenue)
 *   texto de constancia                       [PAGO VERIFICADO]
 *   ░ aviso legal: no es una factura fiscal ░            (gris tenue, cursiva)
 *   pie: generado electrónicamente + código de verificación
 *
 * Solo usa fuentes estándar de PDF (Helvetica): no depende de archivos de fuentes.
 */

/** Aviso legal obligatorio, literal, al pie de todo comprobante. */
const LEGAL_NOTICE =
  'Esto es un comprobante de pago, no representa una factura fiscal. Si requiere una factura fiscal dirigirse a la administración del colegio.';

const PAGE = { width: 419.53, height: 595.28 }; // A5 en puntos
const M = 30; // margen
const INNER = PAGE.width - M * 2;

const INK = '#0f172a';
const MUTED = '#64748b';
const SUBTLE = '#94a3b8';
const BORDER = '#e2e8f0';
const SOFT = '#475569'; // texto secundario legible (aviso legal)
const NOTICE_BG = '#f4f6f9'; // gris muy tenue
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

/** Columna con título (en el color del colegio) y filas etiqueta/valor, sin caja. Devuelve la altura usada. */
function infoColumn(doc, { x, y, width, title, rows, accent }) {
  const rowH = 22;
  doc.font('Helvetica-Bold').fontSize(7).fillColor(accent).text(title.toUpperCase(), x, y, { width, lineBreak: false, characterSpacing: 0.9 });
  rows.forEach(([key, value], i) => {
    const ry = y + 16 + i * rowH;
    label(doc, key, x, ry, width);
    doc.font('Helvetica').fontSize(8.6).fillColor(INK).text(value || '—', x, ry + 8.5, { width, height: 11, ellipsis: true });
  });
  return 16 + rows.length * rowH;
}

/** Sello "PAGO VERIFICADO" girado y de trazo fino, con marca de verificación dibujada (sin depender de fuentes con símbolos). */
function stamp(doc, cx, cy) {
  const w = 104;
  const h = 32;
  doc.save();
  doc.rotate(-7, { origin: [cx, cy] });
  doc.opacity(0.85);
  doc.lineWidth(1).roundedRect(cx - w / 2, cy - h / 2, w, h, 6).stroke(SUCCESS);
  // check ✓ vectorial
  doc.lineWidth(2).lineCap('round').lineJoin('round');
  doc.moveTo(cx - 42, cy - 1).lineTo(cx - 37, cy + 5).lineTo(cx - 28, cy - 6).stroke(SUCCESS);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(SUCCESS).text('PAGO', cx - 22, cy - 9, { width: 64, align: 'center', characterSpacing: 2 });
  doc.text('VERIFICADO', cx - 22, cy + 1, { width: 64, align: 'center', characterSpacing: 0.8 });
  doc.restore();
}

/**
 * @param {object} data
 * @param {{name, logoPath?, primaryColor?, contactEmail?, contactPhone?, rif?}} data.tenant
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

    // ---- Acento superior: una línea fina del color del colegio ----
    doc.rect(0, 0, PAGE.width, 3).fill(brand);

    // ---- Cabecera: logo + colegio | tipo y número ----
    let y = 26;
    const logoSize = 40;
    let textX = M;
    if (tenant.logoPath && fs.existsSync(tenant.logoPath)) {
      try {
        doc.image(tenant.logoPath, M, y, { fit: [logoSize, logoSize], align: 'center', valign: 'center' });
        textX = M + logoSize + 12;
      } catch {
        textX = M; // logo ilegible: se omite sin romper el comprobante
      }
    }
    const headerRight = 148;
    const contactWidth = INNER - (textX - M) - headerRight;
    // Nombre del colegio: hasta 2 líneas (los nombres largos no se cortan) y el contacto debajo.
    doc.font('Helvetica-Bold').fontSize(12.5).fillColor(INK);
    const nameH = Math.min(doc.heightOfString(tenant.name, { width: contactWidth, lineGap: 0 }), 31);
    doc.text(tenant.name, textX, y, { width: contactWidth, height: nameH, ellipsis: true, lineGap: 0 });
    // RIF del colegio, bajo el nombre (identificación del emisor del comprobante).
    let lineY = y + nameH + 4;
    if (tenant.rif) {
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(SOFT).text(`RIF ${tenant.rif}`, textX, lineY, { width: contactWidth, lineBreak: false });
      lineY += 10;
    }
    [tenant.contactEmail, tenant.contactPhone].filter(Boolean).forEach((line, i) => {
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(line, textX, lineY + i * 10, { width: contactWidth, height: 11, ellipsis: true });
    });

    const rx = PAGE.width - M - headerRight;
    doc.font('Helvetica-Bold').fontSize(6.8).fillColor(brandInk).text('COMPROBANTE DE PAGO', rx, y + 2, { width: headerRight, align: 'right', characterSpacing: 1.2 });
    doc.font('Helvetica-Bold').fontSize(15).fillColor(INK).text(`N° ${receiptCode(receipt.id)}`, rx, y + 13, { width: headerRight, align: 'right' });
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(`Emitido el ${dmy(receipt.issuedAt)}`, rx, y + 32, { width: headerRight, align: 'right' });

    y += logoSize + 16;
    doc.moveTo(M, y).lineTo(PAGE.width - M, y).lineWidth(0.5).stroke(BORDER);
    y += 16;

    // ---- Dos columnas de datos (sin cajas: solo tipografía y espacio) ----
    const gap = 22;
    const colW = (INNER - gap) / 2;
    const leftH = infoColumn(doc, {
      x: M,
      y,
      width: colW,
      title: 'Alumno y representante',
      accent: brandInk,
      rows: [
        ['Alumno', student.name],
        ['Cédula / documento', student.nationalId],
        ['Grado y sección', [student.section, student.schoolPeriod].filter(Boolean).join(' · ')],
        ['Representante', guardian.nationalId ? `${guardian.name} · C.I. ${guardian.nationalId}` : guardian.name],
      ],
    });
    const rightH = infoColumn(doc, {
      x: M + colW + gap,
      y,
      width: colW,
      title: 'Datos del pago',
      accent: brandInk,
      rows: [
        ['Fecha de pago', dmy(payment.paidOn || receipt.issuedAt)],
        ['Método', METHOD_LABELS[payment.method] || (payment.method ? payment.method : 'No indicado')],
        ['Moneda', ref ? `${ref.name} (${ref.code})` : chargeCur.code],
        ['Referencia', payment.reference],
        ['Registrado', dmy(receipt.issuedAt)],
      ],
    });
    y += Math.max(leftH, rightH) + 14;

    // ---- Detalle del concepto ----
    label(doc, 'Concepto', M, y, INNER);
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(SUBTLE).text('MONTO', M, y, { width: INNER, align: 'right', characterSpacing: 0.6 });
    y += 11;
    doc.moveTo(M, y).lineTo(PAGE.width - M, y).lineWidth(0.5).stroke(BORDER);
    y += 9;
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(payment.concept, M, y, { width: INNER - 110, height: 13, ellipsis: true });
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(money(payment.amount, chargeCur), M, y, { width: INNER, align: 'right' });
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(payment.kind === 'tuition' ? 'Mensualidad' : 'Otro cobro', M, y + 13, { width: INNER - 110, lineBreak: false });
    y += 30;
    doc.moveTo(M, y).lineTo(PAGE.width - M, y).lineWidth(0.5).stroke(BORDER);
    y += 16;

    // ---- Montos (jerarquía principal): fondo apenas tintado, cifras en tinta ----
    const boxH = converted ? 86 : 60;
    const pad = 16;
    doc.save();
    doc.fillOpacity(0.06).roundedRect(M, y, INNER, boxH, 10).fill(brand);
    doc.restore();
    doc.rect(M, y + 12, 2.5, boxH - 24).fill(brand); // acento lateral fino
    doc.font('Helvetica-Bold').fontSize(6.8).fillColor(brandInk).text('TOTAL PAGADO', M + pad, y + 13, { characterSpacing: 1.2 });

    if (!converted) {
      // Pagado en la misma moneda del cobro (ej. USD en efectivo, o un cargo en Bs).
      doc.font('Helvetica-Bold').fontSize(22).fillColor(INK).text(money(payment.amount, chargeCur), M + pad, y + 26);
    } else {
      doc.font('Helvetica-Bold').fontSize(24).fillColor(INK).text(money(payment.amount, USD), M + pad, y + 25);
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text('Monto base en divisa (USD)', M + pad, y + 56);
      // divisor vertical y conversión
      const half = M + INNER / 2 + 6;
      doc.moveTo(half - 10, y + 14).lineTo(half - 10, y + boxH - 14).lineWidth(0.5).stroke(BORDER);
      // Solo el código: el nombre de la moneda ya figura en "Datos del pago" y uno largo partiría la línea.
      doc.font('Helvetica-Bold').fontSize(6.8).fillColor(brandInk).text(`EQUIVALENTE EN ${ref.code}`, half, y + 13, { characterSpacing: 1, lineBreak: false });
      const halfW = INNER / 2 - pad - 6;
      if (ref.amount !== null && ref.amount !== undefined) {
        doc.font('Helvetica-Bold').fontSize(15).fillColor(INK).text(money(ref.amount, ref), half, y + 28, { width: halfW, lineBreak: false });
        doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
          .text(`Tasa del día: ${rateText(ref.rate, ref)} por USD`, half, y + 52, { width: halfW, lineBreak: false });
        doc.text(`Fecha valor: ${dmy(ref.rateDate)}${ref.code === 'VES' ? ' (BCV)' : ''}`, half, y + 64, { width: halfW, lineBreak: false });
      } else {
        doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text('Sin conversión registrada', half, y + 30);
      }
    }
    y += boxH + 18;

    // ---- Constancia + sello ----
    stamp(doc, PAGE.width - M - 60, y + 18);
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(
      'El colegio verificó y registró este pago. Conserve este comprobante como constancia.',
      M,
      y + 4,
      { width: INNER - 140 }
    );
    if (payment.note) {
      label(doc, 'Observaciones', M, y + 30, INNER - 140);
      doc.font('Helvetica').fontSize(8).fillColor(INK).text(payment.note, M, y + 39, { width: INNER - 140, height: 30, ellipsis: true });
    }

    // ---- Pie: aviso legal (obligatorio) + datos de verificación, fijos al fondo de la página ----
    const footY = PAGE.height - 40;
    const noticePad = 9;
    doc.font('Helvetica-Oblique').fontSize(7.4);
    const noticeH = doc.heightOfString(LEGAL_NOTICE, { width: INNER - noticePad * 2, align: 'center' }) + noticePad * 2 - 2;
    const noticeY = footY - noticeH - 10;
    doc.roundedRect(M, noticeY, INNER, noticeH, 6).fill(NOTICE_BG);
    doc.font('Helvetica-Oblique').fontSize(7.4).fillColor(SOFT)
      .text(LEGAL_NOTICE, M + noticePad, noticeY + noticePad, { width: INNER - noticePad * 2, align: 'center', lineGap: 1 });

    doc.font('Helvetica').fontSize(6.4).fillColor(SUBTLE)
      .text('Comprobante generado electrónicamente por el sistema de gestión escolar. No requiere firma ni sello húmedo.', M, footY, { width: INNER, align: 'center' })
      .text(`Código de verificación: ${receipt.id}`, M, footY + 10, { width: INNER, align: 'center' });

    doc.end();
  });
}

module.exports = { generateReceiptPdf, receiptCode };
