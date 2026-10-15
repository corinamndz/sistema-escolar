const fs = require('fs');
const PDFDocument = require('pdfkit');
const { hueOf, hslToHex, mix, textOn, validHex } = require('./scheduleGenerator');

/**
 * Calendario de EVALUACIONES de una sección en PDF (A4 horizontal), con el
 * mismo estilo que el horario de clases: cabecera con el color del menú del
 * colegio, días con el color de acento y cada materia con su color.
 *
 *   Una fila por semana (lunes a viernes) del rango del lapso; en cada día,
 *   sus evaluaciones con la hora del bloque de clase de la materia. Los días
 *   sobrecargados se resaltan; las pesadas (examen, proyecto o ≥ 20 %) llevan
 *   una marca. Si no cabe en una página, continúa en las siguientes.
 */

const PAGE = { width: 841.89, height: 595.28 };
const M = 28;
const INNER = PAGE.width - M * 2;
const INK = '#0f172a';
const MUTED = '#64748b';
const SUBTLE = '#94a3b8';
const BORDER = '#e2e8f0';
const OVER_BG = '#fef2f2';
const OVER_INK = '#b91c1c';
const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];

const parse = (d) => new Date(`${d}T12:00:00Z`);
const fmt = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const mondayOf = (d) => addDays(d, -((d.getUTCDay() + 6) % 7));
const short = (d) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const now = () => new Date().toLocaleString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function header(doc, { tenant, title, subtitle, periodName, termName }, menu, accent) {
  const headH = 78;
  const onMenu = textOn(menu);
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
      textX = M;
    }
  }
  const rightW = 200;
  const titleW = PAGE.width - M - rightW - textX - 10;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(onMenu).opacity(0.75)
    .text(`${tenant.name}  ·  CALENDARIO DE EVALUACIONES`.toUpperCase(), textX, 16, { width: titleW, lineBreak: false, ellipsis: true, characterSpacing: 0.8 });
  doc.opacity(1).font('Helvetica-Bold').fontSize(20).fillColor(onMenu).text(title, textX, 29, { width: titleW, lineBreak: false, ellipsis: true });
  if (subtitle) doc.font('Helvetica').fontSize(9).fillColor(onMenu).opacity(0.85).text(subtitle, textX, 54, { width: titleW, lineBreak: false, ellipsis: true });
  doc.opacity(1);
  const rx = PAGE.width - M - rightW;
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(onMenu).opacity(0.75).text((termName || 'AÑO ESCOLAR').toUpperCase(), rx, 22, { width: rightW, align: 'right', characterSpacing: 0.8 });
  doc.opacity(1).font('Helvetica-Bold').fontSize(14).fillColor(onMenu).text(periodName || '—', rx, 33, { width: rightW, align: 'right', lineBreak: false, ellipsis: true });
  return headH + 4 + 14;
}

function footer(doc, summary, accent, page) {
  const fy = PAGE.height - 24;
  doc.moveTo(M, fy - 6).lineTo(PAGE.width - M, fy - 6).lineWidth(0.6).strokeColor(BORDER).stroke();
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(mix(accent, '#000000', 0.15)).text('MoDo Educa', M, fy, { continued: true, lineBreak: false })
    .font('Helvetica').fillColor(SUBTLE).text('  ·  Sistema de gestión escolar', { lineBreak: false });
  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(summary, M + 200, fy, { width: INNER - 400, align: 'center', lineBreak: false, ellipsis: true });
  doc.font('Helvetica').fontSize(7.5).fillColor(SUBTLE).text(`Pág. ${page} · Generado el ${now()}`, PAGE.width - M - 200, fy, { width: 200, align: 'right', lineBreak: false });
}

/**
 * @param data { tenant: {name, logoPath, primaryColor, secondaryColor}, title, subtitle,
 *               periodName, termName, from, to, evaluations, overloadedDates: Set, summary }
 */
function generateEvaluationCalendarPdf(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, info: { Title: `Calendario de evaluaciones · ${data.title}`, Author: data.tenant.name, Creator: 'MoDo Educa' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const accent = validHex(data.tenant.primaryColor, '#2563eb');
    const menu = validHex(data.tenant.secondaryColor, '#1e293b');
    const onAccent = textOn(accent);
    const weekW = 54;
    const dayW = (INNER - weekW) / 5;
    const theadH = 22;
    const itemH = 25;
    const bottomLimit = PAGE.height - 34;

    // Semanas del rango (lunes a viernes).
    const byDate = new Map();
    data.evaluations.forEach((e) => {
      if (!byDate.has(e.date)) byDate.set(e.date, []);
      byDate.get(e.date).push(e);
    });
    const weeks = [];
    if (data.from && data.to) {
      for (let w = mondayOf(parse(data.from)); w <= parse(data.to); w = addDays(w, 7)) weeks.push(w);
    }

    let page = 1;
    let y = header(doc, data, menu, accent);
    const drawHead = () => {
      doc.roundedRect(M, y, INNER, theadH, 6).fill(accent);
      doc.rect(M, y + theadH - 6, INNER, 6).fill(accent);
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(onAccent).text('SEMANA', M + 6, y + 7, { width: weekW - 8, characterSpacing: 0.5 });
      DAYS.forEach((d, i) => doc.text(d.toUpperCase(), M + weekW + i * dayW, y + 7, { width: dayW, align: 'center', characterSpacing: 0.6, lineBreak: false }));
      y += theadH;
    };
    drawHead();

    if (!weeks.length) {
      doc.font('Helvetica-Oblique').fontSize(10).fillColor(MUTED).text('No hay evaluaciones con fecha en este lapso.', M, y + 16, { width: INNER, align: 'center' });
    }

    weeks.forEach((monday, wi) => {
      const dates = [0, 1, 2, 3, 4].map((i) => fmt(addDays(monday, i)));
      const most = Math.max(1, ...dates.map((d) => (byDate.get(d) || []).length));
      const rowH = Math.max(34, 16 + most * itemH);
      if (y + rowH > bottomLimit) {
        footer(doc, data.summary, accent, page);
        doc.addPage();
        page += 1;
        y = M;
        drawHead();
      }
      if (wi % 2 === 1) doc.rect(M, y, INNER, rowH).fill('#f8fafc');
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text(short(monday), M + 6, y + 6, { width: weekW - 8 });
      doc.font('Helvetica').fontSize(7).fillColor(SUBTLE).text(`al ${short(addDays(monday, 4))}`, M + 6, y + 17, { width: weekW - 8 });

      dates.forEach((date, i) => {
        const cx = M + weekW + i * dayW;
        const list = byDate.get(date) || [];
        const over = data.overloadedDates.has(date);
        if (over) doc.rect(cx + 0.5, y + 0.5, dayW - 1, rowH - 1).fill(OVER_BG);
        doc.font('Helvetica-Bold').fontSize(7).fillColor(over ? OVER_INK : SUBTLE).text(`${short(parse(date))}${over ? '  · DÍA CARGADO' : ''}`, cx + 4, y + 3, { width: dayW - 8, lineBreak: false });
        list.forEach((e, k) => {
          const by = y + 13 + k * itemH;
          const hue = hueOf(e.subject_id || e.subject_name);
          doc.roundedRect(cx + 3, by, dayW - 6, itemH - 3, 4).fill(hslToHex(hue, 80, 95));
          doc.roundedRect(cx + 3, by, 3, itemH - 3, 1.5).fill(hslToHex(hue, 65, 45));
          const head = `${e.start_time ? `${e.start_time} ` : ''}${e.subject_name}`;
          doc.font('Helvetica-Bold').fontSize(7.5).fillColor(e.heavy ? INK : '#334155').text(head, cx + 9, by + 2.5, { width: dayW - 24, lineBreak: false, ellipsis: true });
          // Marca de evaluación pesada: un punto dibujado (Helvetica no trae el carácter ●).
          if (e.heavy) doc.circle(cx + dayW - 11, by + 7, 2.6).fill(OVER_INK);
          doc.font('Helvetica').fontSize(6.8).fillColor(MUTED).text(`${e.title} · ${e.category_label} · ${e.weight_percent}%`, cx + 9, by + 12, { width: dayW - 16, lineBreak: false, ellipsis: true });
        });
      });
      // Líneas
      doc.moveTo(M, y + rowH).lineTo(M + INNER, y + rowH).lineWidth(0.6).strokeColor(BORDER).stroke();
      for (let i = 0; i < 5; i += 1) doc.moveTo(M + weekW + i * dayW, y).lineTo(M + weekW + i * dayW, y + rowH).lineWidth(0.6).strokeColor(BORDER).stroke();
      y += rowH;
    });

    // Leyenda
    if (y + 16 < bottomLimit) {
      doc.circle(M + 3, y + 9.5, 2.6).fill(OVER_INK);
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text('Evaluación pesada (examen, proyecto o 20 % o más del lapso).    Fondo rojo: día cargado (2 o más pesadas, o 3 o más evaluaciones).', M + 10, y + 6, { width: INNER - 10 });
    }
    footer(doc, data.summary, accent, page);
    doc.end();
  });
}

module.exports = { generateEvaluationCalendarPdf };
