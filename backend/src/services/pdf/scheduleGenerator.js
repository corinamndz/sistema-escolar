const fs = require('fs');
const PDFDocument = require('pdfkit');

/**
 * Horario semanal en PDF (A4 horizontal), generado en memoria (Buffer).
 *
 *   ┌ cabecera con el color del menú del colegio ──────────────────────────┐
 *   │ [logo] COLEGIO X · HORARIO DE CLASES          Año escolar 2026-2027 │
 *   │        3er Año · Sección A  (o  Prof. Rosa Pérez)                   │
 *   ├──────┬─────────┬─────────┬─────────┬─────────┬─────────┤ ← acento
 *   │ Hora │ Lunes   │ Martes  │ …                                       │
 *   │07:00 │▌Matem.  │         │                                         │
 *   │      │▌Rosa P. │         │                                         │
 *   │ ░░░░░░░░░░░░░░░░ Recreo ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
 *   └ pie: MoDo Educa · resumen · fecha de generación ────────────────────┘
 *
 * Cada materia (o sección, en el horario de un docente) lleva el mismo color
 * que en la pantalla. Todo el horario cabe en UNA página: el alto de las filas
 * se ajusta a la cantidad de bloques. Solo fuentes estándar (Helvetica).
 */

const PAGE = { width: 841.89, height: 595.28 }; // A4 horizontal, en puntos
const M = 28;
const INNER = PAGE.width - M * 2;

const INK = '#0f172a';
const MUTED = '#64748b';
const SUBTLE = '#94a3b8';
const BORDER = '#e2e8f0';
const STRIPE = '#f8fafc';
const GAP_BG = '#fef3c7';
const GAP_INK = '#b45309';

const validHex = (c, fallback) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : fallback);

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Texto legible sobre un fondo (blanco o casi negro). */
const textOn = (hex) => (luminance(hex) > 0.45 ? INK : '#ffffff');

/** Mezcla dos colores hex (t = 0 → a, 1 → b). */
function mix(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

function hslToHex(h, s, l) {
  const S = s / 100;
  const L = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** Mismo tono estable que la grilla del frontend (ScheduleGrid.hueOf). */
function hueOf(key = '') {
  let h = 0;
  for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

const now = () =>
  new Date().toLocaleString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * @param {object} data
 * @param {{name, logoPath?, primaryColor?, secondaryColor?}} data.tenant
 * @param {string} data.kicker   "Horario de clases" / "Horario del docente"
 * @param {string} data.title    "3er Año · Sección A" / "Prof. Rosa Pérez"
 * @param {string} [data.subtitle] línea secundaria (p. ej. el profesor guía)
 * @param {string} data.periodName
 * @param {Array} data.days, data.slots, data.entries  (como GET /schedules)
 * @param {(e) => {title, sub}} data.entryText
 * @param {(e) => string} data.colorKey   clave del color de cada clase
 * @param {Set<string>} [data.gapKeys]    celdas "día|bloque" a marcar como hueco
 * @param {string} [data.summary]         texto del pie (horas, secciones…)
 */
function generateSchedulePdf({ tenant, kicker, title, subtitle, periodName, days, slots, entries, entryText, colorKey, gapKeys = new Set(), summary = '' }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 0,
      info: { Title: `${kicker} · ${title}`, Author: tenant.name, Subject: `Horario ${periodName || ''}`.trim(), Creator: 'MoDo Educa' },
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const accent = validHex(tenant.primaryColor, '#2563eb');
    const menu = validHex(tenant.secondaryColor, '#1e293b');
    const onMenu = textOn(menu);
    const onAccent = textOn(accent);

    // ---- Cabecera: banda con el color del menú (degradado suave) ----
    const headH = 78;
    const grad = doc.linearGradient(0, 0, PAGE.width, headH);
    grad.stop(0, menu).stop(1, mix(menu, '#000000', 0.25));
    doc.rect(0, 0, PAGE.width, headH).fill(grad);
    doc.rect(0, headH, PAGE.width, 4).fill(accent);

    let textX = M;
    const logo = 54;
    if (tenant.logoPath && fs.existsSync(tenant.logoPath)) {
      try {
        doc.roundedRect(M, (headH - logo) / 2, logo, logo, 10).fill('#ffffff');
        doc.image(tenant.logoPath, M + 5, (headH - logo) / 2 + 5, { fit: [logo - 10, logo - 10], align: 'center', valign: 'center' });
        textX = M + logo + 14;
      } catch {
        textX = M; // logo ilegible: se omite sin romper el documento
      }
    }
    const rightW = 190;
    const titleW = PAGE.width - M - rightW - textX - 10;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(onMenu).opacity(0.75)
      .text(`${tenant.name}  ·  ${kicker}`.toUpperCase(), textX, 16, { width: titleW, lineBreak: false, ellipsis: true, characterSpacing: 0.8 });
    doc.opacity(1).font('Helvetica-Bold').fontSize(20).fillColor(onMenu).text(title, textX, 29, { width: titleW, lineBreak: false, ellipsis: true });
    if (subtitle) doc.font('Helvetica').fontSize(9).fillColor(onMenu).opacity(0.85).text(subtitle, textX, 54, { width: titleW, lineBreak: false, ellipsis: true });
    doc.opacity(1);

    const rx = PAGE.width - M - rightW;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(onMenu).opacity(0.75).text('AÑO ESCOLAR', rx, 22, { width: rightW, align: 'right', characterSpacing: 0.8 });
    doc.opacity(1).font('Helvetica-Bold').fontSize(14).fillColor(onMenu).text(periodName || '—', rx, 33, { width: rightW, align: 'right', lineBreak: false, ellipsis: true });

    // ---- Grilla ----
    const top = headH + 4 + 16;
    const footerH = 30;
    const timeW = 66;
    const dayW = (INNER - timeW) / days.length;
    const theadH = 24;
    const breakH = 17;
    const classSlots = slots.filter((s) => !s.is_break);
    const breaks = slots.length - classSlots.length;
    const avail = PAGE.height - top - footerH - 10 - theadH - breaks * breakH;
    const rowH = Math.max(24, Math.min(70, classSlots.length ? avail / classSlots.length : 40));
    const scale = Math.min(1, rowH / 44); // letra algo menor si hay muchos bloques

    // Encabezado de días (color de acento)
    doc.roundedRect(M, top, INNER, theadH, 6).fill(accent);
    doc.rect(M, top + theadH - 6, INNER, 6).fill(accent);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(onAccent).text('HORA', M + 8, top + 8, { width: timeW - 12, characterSpacing: 0.6 });
    days.forEach((d, i) => {
      doc.text(d.name.toUpperCase(), M + timeW + i * dayW, top + 8, { width: dayW, align: 'center', characterSpacing: 0.6, lineBreak: false });
    });

    const at = (day, slotId) => entries.filter((e) => e.day_of_week === day && e.time_slot_id === slotId);
    let y = top + theadH;
    slots.forEach((slot, idx) => {
      if (slot.is_break) {
        doc.rect(M, y, INNER, breakH).fill('#f1f5f9');
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED)
          .text(`${slot.start_time} – ${slot.end_time}`, M + 8, y + 5, { width: timeW, lineBreak: false })
          .text(slot.name.toUpperCase(), M + timeW, y + 5, { width: INNER - timeW, align: 'center', characterSpacing: 1.5, lineBreak: false });
        doc.moveTo(M, y + breakH).lineTo(M + INNER, y + breakH).lineWidth(0.6).strokeColor(BORDER).stroke();
        y += breakH;
        return;
      }

      // Columna de la hora (cebra suave para leer las filas)
      if (idx % 2 === 1) doc.rect(M, y, INNER, rowH).fill(STRIPE);
      doc.font('Helvetica-Bold').fontSize(9.5 * Math.max(scale, 0.85)).fillColor(INK).text(slot.start_time, M + 8, y + 6, { width: timeW - 12, lineBreak: false });
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(slot.end_time, M + 8, y + 6 + 12 * Math.max(scale, 0.85), { width: timeW - 12, lineBreak: false });
      if (rowH >= 40) doc.fontSize(6.5).fillColor(SUBTLE).text(slot.name, M + 8, y + rowH - 13, { width: timeW - 12, lineBreak: false, ellipsis: true });

      days.forEach((d, i) => {
        const cx = M + timeW + i * dayW;
        const list = at(d.day, slot.id);
        if (!list.length && gapKeys.has(`${d.day}|${slot.id}`)) {
          doc.roundedRect(cx + 3, y + 3, dayW - 6, rowH - 6, 5).fill(GAP_BG);
          doc.font('Helvetica-Bold').fontSize(7.5).fillColor(GAP_INK).text('HUECO', cx, y + rowH / 2 - 4, { width: dayW, align: 'center', characterSpacing: 1 });
        }
        const boxH = (rowH - 6 - (list.length - 1) * 2) / Math.max(list.length, 1);
        list.forEach((e, k) => {
          const hue = hueOf(colorKey(e));
          const bx = cx + 3;
          const by = y + 3 + k * (boxH + 2);
          const bw = dayW - 6;
          doc.roundedRect(bx, by, bw, boxH, 5).fill(hslToHex(hue, 80, 95));
          doc.roundedRect(bx, by, 3.5, boxH, 1.5).fill(hslToHex(hue, 65, 45));
          const t = entryText(e);
          const fs1 = 9 * Math.max(scale, 0.8);
          const fs2 = 7.5 * Math.max(scale, 0.85);
          const textY = by + Math.max(3, (boxH - fs1 - (t.sub && boxH >= fs1 + fs2 + 6 ? fs2 + 2 : 0)) / 2);
          doc.font('Helvetica-Bold').fontSize(fs1).fillColor(INK).text(t.title, bx + 8, textY, { width: bw - 12, lineBreak: false, ellipsis: true });
          if (t.sub && boxH >= fs1 + fs2 + 6) {
            doc.font('Helvetica').fontSize(fs2).fillColor(MUTED).text(t.sub, bx + 8, textY + fs1 + 2, { width: bw - 12, lineBreak: false, ellipsis: true });
          }
        });
      });
      doc.moveTo(M, y + rowH).lineTo(M + INNER, y + rowH).lineWidth(0.6).strokeColor(BORDER).stroke();
      y += rowH;
    });

    // Líneas verticales y marco
    const tableBottom = y;
    for (let i = 0; i <= days.length; i += 1) {
      const x = M + timeW + i * dayW;
      if (i < days.length) doc.moveTo(x, top + theadH).lineTo(x, tableBottom).lineWidth(0.6).strokeColor(BORDER).stroke();
    }
    doc.roundedRect(M, top, INNER, tableBottom - top, 6).lineWidth(0.8).strokeColor(mix(accent, '#ffffff', 0.55)).stroke();

    if (!entries.length) {
      doc.font('Helvetica-Oblique').fontSize(10).fillColor(MUTED).text('Aún no hay clases en este horario.', M, tableBottom + 10, { width: INNER, align: 'center' });
    }

    // ---- Pie ----
    const fy = PAGE.height - footerH + 6;
    doc.moveTo(M, fy - 6).lineTo(PAGE.width - M, fy - 6).lineWidth(0.6).strokeColor(BORDER).stroke();
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(accent === '#ffffff' ? INK : mix(accent, '#000000', 0.15)).text('MoDo Educa', M, fy, { continued: true, lineBreak: false })
      .font('Helvetica').fillColor(SUBTLE).text('  ·  Sistema de gestión escolar', { lineBreak: false });
    if (summary) doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(summary, M + 200, fy, { width: INNER - 400, align: 'center', lineBreak: false, ellipsis: true });
    doc.font('Helvetica').fontSize(7.5).fillColor(SUBTLE).text(`Generado el ${now()}`, PAGE.width - M - 200, fy, { width: 200, align: 'right', lineBreak: false });

    doc.end();
  });
}

module.exports = { generateSchedulePdf, hueOf };
