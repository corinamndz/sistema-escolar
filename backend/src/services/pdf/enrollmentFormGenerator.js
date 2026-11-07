const fs = require('fs');
const PDFDocument = require('pdfkit');

/**
 * Planilla de inscripción completada, en PDF (A4 vertical), pensada para caber
 * en UNA hoja:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ [logo] NOMBRE DEL COLEGIO          PLANILLA DE INSCRIPCIÓN ┌────┐│
 *   │        RIF · Dirección · contacto  N° 6B1F-0C2E · 2027-2028 │foto││
 *   │ ══════════════════════════════════════════════════════════ └────┘│
 *   │ Título · cuadrícula de datos (alumno, representante, estado…)  │
 *   │ SECCIÓN ─────────────────────────────────────────────────────  │
 *   │ Pregunta          Pregunta           (2 o 3 columnas; las     │
 *   │ Respuesta         Respuesta           largas ocupan la fila)   │
 *   │ …                                                              │
 *   │ Declaración · Firma del representante | Firma autorizada [sello]│
 *   │ pie: colegio · planilla N° · Página 1 de 1                     │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Se genera con la densidad más holgada que entre en una hoja (3 niveles:
 * márgenes, tipografía y columnas). Si ni la más compacta alcanza (planillas
 * muy largas), se usan más páginas y las firmas van al pie de la última.
 * La foto del alumno (campo «foto») va fija en la esquina superior derecha.
 * Solo fuentes estándar de PDF (Helvetica).
 */

const PAGE = { width: 595.28, height: 841.89 }; // A4
const INK = '#0f172a';
const SOFT = '#334155';
const MUTED = '#64748b';
const SUBTLE = '#94a3b8';
const BORDER = '#e2e8f0';
const CARD = '#f8fafc';
const STATUS = { pending: 'Por llenar', submitted: 'En revisión', changes_requested: 'Por corregir', approved: 'Aprobada', rejected: 'Rechazada' };

/** Niveles de densidad, del más holgado al más compacto. */
const LEVELS = [
  { m: 38, value: 9.2, label: 6.8, cols: 2, padY: 5.5, gapSec: 9, title: 13.5, logo: 52, photo: [74, 92], sign: 98 },
  { m: 32, value: 8.5, label: 6.3, cols: 2, padY: 4, gapSec: 6, title: 12.5, logo: 46, photo: [66, 82], sign: 90 },
  { m: 26, value: 7.9, label: 5.9, cols: 3, padY: 3, gapSec: 4, title: 11.5, logo: 40, photo: [58, 72], sign: 84 },
];

const validHex = (c, fb) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : fb);
const code = (id) => String(id).replace(/-/g, '').slice(0, 8).toUpperCase().replace(/^(.{4})/, '$1-');
function dmy(v) {
  if (!v) return '—';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-');
    return `${d}/${m}/${y}`;
  }
  return new Date(v).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function answerText(f, v) {
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return '—';
  if (f.type === 'checkbox') return v ? 'Sí, aceptado' : 'No';
  if (f.type === 'checkboxes') return v.join(', ');
  if (f.type === 'date') return dmy(v);
  return String(v);
}

/** Un render completo con la densidad `L`. → { buffer, pages } */
function render({ tenant, form, submission: s }, L) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Title: `${form.title} - ${s.studentName}`, Author: tenant.name, Subject: 'Planilla de inscripción' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    let pageCount = 1;
    doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), pages: pageCount }));
    doc.on('error', reject);

    const M = L.m;
    const INNER = PAGE.width - M * 2;
    const FOOT = 22;
    const BOTTOM = PAGE.height - M - FOOT;
    const brand = validHex(tenant.primaryColor, '#2563eb');
    const showPhoto = s.hasPhotoField || Boolean(s.photoPath);

    // ---------- Membrete ----------
    const letterhead = (first) => {
      doc.rect(0, 0, PAGE.width, 4).fill(brand);
      const top = M - 8;
      const logo = first ? L.logo : 30;
      const [pw, ph] = first && showPhoto ? L.photo : [0, 0];
      let x = M;
      if (tenant.logoPath && fs.existsSync(tenant.logoPath)) {
        try {
          doc.image(tenant.logoPath, M, top, { fit: [logo, logo], align: 'center', valign: 'center' });
          x = M + logo + 12;
        } catch {
          x = M;
        }
      }
      // Foto del alumno: esquina superior derecha, tamaño carnet.
      const photoX = PAGE.width - M - pw;
      if (pw) {
        if (s.photoPath && fs.existsSync(s.photoPath)) {
          try {
            doc.save();
            doc.roundedRect(photoX, top, pw, ph, 6).clip();
            doc.image(s.photoPath, photoX, top, { cover: [pw, ph], align: 'center', valign: 'center' });
            doc.restore();
            doc.roundedRect(photoX, top, pw, ph, 6).lineWidth(0.8).stroke(BORDER);
          } catch {
            doc.restore();
          }
        } else {
          doc.roundedRect(photoX, top, pw, ph, 6).lineWidth(0.8).dash(3, { space: 3 }).stroke(SUBTLE).undash();
          doc.font('Helvetica').fontSize(7.5).fillColor(SUBTLE).text('Foto', photoX, top + ph / 2 - 4, { width: pw, align: 'center' });
        }
      }
      const rightW = 150;
      const rightX = (pw ? photoX - 12 : PAGE.width - M) - rightW;
      const textW = rightX - x - 10;
      doc.font('Helvetica-Bold').fontSize(first ? 13 : 10.5).fillColor(INK).text(tenant.name, x, top + 1, { width: textW, height: first ? 32 : 13, ellipsis: true });
      let ly = doc.y + 2;
      if (first) {
        const lines = [tenant.rif ? `RIF ${tenant.rif}` : null, tenant.address, [tenant.phone, tenant.email].filter(Boolean).join(' · ') || null].filter(Boolean);
        lines.forEach((line, i) => {
          const bold = i === 0 && tenant.rif;
          doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.8).fillColor(bold ? SOFT : MUTED).text(line, x, ly, { width: textW, height: 20, ellipsis: true });
          ly = doc.y + 1;
        });
      }
      doc.font('Helvetica-Bold').fontSize(6.8).fillColor(brand).text('PLANILLA DE INSCRIPCIÓN', rightX, top + 2, { width: rightW, align: 'right', characterSpacing: 0.8 });
      doc.font('Helvetica-Bold').fontSize(first ? 12.5 : 10).fillColor(INK).text(`N° ${code(s.id)}`, rightX, top + 12, { width: rightW, align: 'right' });
      if (first) doc.font('Helvetica').fontSize(7.8).fillColor(MUTED).text(`Año escolar ${form.schoolPeriod}`, rightX, top + 28, { width: rightW, align: 'right' });
      const bottom = Math.max(top + logo, ly, top + (first ? 40 : 30), top + ph) + 8;
      doc.moveTo(M, bottom).lineTo(pw ? photoX - 8 : PAGE.width - M, bottom).lineWidth(1.1).stroke(brand);
      return bottom + 10;
    };

    let y = letterhead(true);
    const newPage = () => {
      doc.addPage({ size: 'A4', margin: 0 });
      y = letterhead(false);
    };
    const ensure = (h) => {
      if (y + h > BOTTOM) newPage();
    };

    // ---------- Cuadrícula de celdas (etiqueta arriba, valor abajo) ----------
    const cellH = (label, value, w) => {
      doc.font('Helvetica-Bold').fontSize(L.label);
      const lh = doc.heightOfString(label.toUpperCase(), { width: w, characterSpacing: 0.3 });
      doc.font('Helvetica').fontSize(L.value);
      const vh = doc.heightOfString(value, { width: w });
      return lh + vh + 2 + L.padY * 2;
    };
    const drawCell = (label, value, x, cy, w) => {
      doc.font('Helvetica-Bold').fontSize(L.label).fillColor(SUBTLE).text(label.toUpperCase(), x, cy + L.padY, { width: w, characterSpacing: 0.3 });
      doc.font('Helvetica').fontSize(L.value).fillColor(value === '—' ? SUBTLE : INK).text(value, x, doc.y + 1.5, { width: w });
    };
    /** Filas de `cols` celdas; las marcadas `wide` ocupan la fila entera. */
    const grid = (items, cols, { boxed = false } = {}) => {
      const gap = 14;
      const colW = (INNER - (boxed ? 20 : 0) - gap * (cols - 1)) / cols;
      const x0 = M + (boxed ? 10 : 0);
      const rows = [];
      let row = [];
      items.forEach((it) => {
        if (it.wide) {
          if (row.length) rows.push(row);
          rows.push([it]);
          row = [];
        } else {
          row.push(it);
          if (row.length === cols) {
            rows.push(row);
            row = [];
          }
        }
      });
      if (row.length) rows.push(row);
      const heights = rows.map((r) => Math.max(...r.map((it) => cellH(it.label, it.value, it.wide ? INNER - (boxed ? 20 : 0) : colW))));
      if (boxed) {
        const total = heights.reduce((a, b) => a + b, 0) + 6;
        ensure(total);
        doc.roundedRect(M, y, INNER, total, 6).fill(CARD);
        y += 3;
      }
      rows.forEach((r, i) => {
        ensure(heights[i]);
        r.forEach((it, j) => drawCell(it.label, it.value, it.wide ? x0 : x0 + j * (colW + gap), y, it.wide ? INNER - (boxed ? 20 : 0) : colW));
        y += heights[i];
        if (!boxed) doc.moveTo(M, y).lineTo(PAGE.width - M, y).lineWidth(0.4).stroke(BORDER);
      });
      if (boxed) y += 3;
    };

    // ---------- Título y datos generales ----------
    doc.font('Helvetica-Bold').fontSize(L.title).fillColor(INK).text(form.title, M, y, { width: INNER });
    y = doc.y + 6;
    grid(
      [
        { label: s.isApplicant ? 'Aspirante' : 'Alumno', value: s.studentName || '—' },
        { label: 'Representante legal', value: s.guardianName || '—' },
        { label: 'C.I. del representante', value: s.guardianNationalId || '—' },
        { label: 'Contacto', value: [s.guardianPhone, s.guardianEmail].filter(Boolean).join(' · ') || '—' },
        { label: 'Enviada', value: dmy(s.submittedAt) },
        { label: 'Estado', value: `${STATUS[s.status] || s.status}${s.reviewedAt ? ` (${dmy(s.reviewedAt)})` : ''}` },
      ],
      3,
      { boxed: true }
    );
    if (s.reviewNote) {
      doc.font('Helvetica-Oblique').fontSize(L.label + 1).fillColor(SOFT).text(`Observación del colegio: ${s.reviewNote}`, M, y + 2, { width: INNER });
      y = doc.y + 2;
    }

    // ---------- Respuestas por sección ----------
    const sections = [];
    let current = { title: null, help: null, items: [] };
    for (const f of s.fields || []) {
      if (f.type === 'photo') continue; // va en el membrete
      if (f.type === 'section') {
        if (current.title || current.items.length) sections.push(current);
        current = { title: f.label, help: f.help, items: [] };
        continue;
      }
      const value = answerText(f, s.answers?.[f.id]);
      const wide = f.type === 'long_text' || f.type === 'checkbox' || f.type === 'checkboxes' || value.length > (L.cols === 3 ? 34 : 48) || f.label.length > (L.cols === 3 ? 48 : 70);
      current.items.push({ label: f.label, value, wide });
    }
    if (current.title || current.items.length) sections.push(current);

    for (const sec of sections) {
      if (sec.title) {
        ensure(L.gapSec + 30);
        y += L.gapSec;
        doc.font('Helvetica-Bold').fontSize(L.value + 1).fillColor(brand).text(sec.title.toUpperCase(), M, y, { width: INNER, characterSpacing: 0.6 });
        y = doc.y + 1;
        if (sec.help) {
          doc.font('Helvetica').fontSize(L.label + 0.6).fillColor(MUTED).text(sec.help, M, y, { width: INNER });
          y = doc.y;
        }
        doc.moveTo(M, y + 1).lineTo(PAGE.width - M, y + 1).lineWidth(0.8).stroke(brand);
        y += 2;
      }
      grid(sec.items, L.cols);
    }

    // ---------- Firmas: al pie de la última página ----------
    if (y + 8 > BOTTOM - L.sign) newPage();
    const sy = BOTTOM - L.sign;
    doc.font('Helvetica-Oblique').fontSize(L.label + 0.8).fillColor(MUTED).text(
      'Declaro que la información suministrada es verdadera y me comprometo a notificar al colegio cualquier cambio.',
      M,
      sy,
      { width: INNER, align: 'center' }
    );
    const seal = 52;
    const half = (INNER - 30) / 2;
    const lineY = sy + L.sign - 40;
    const left = M;
    const right = M + half + 30;
    // Representante legal
    doc.moveTo(left, lineY).lineTo(left + half, lineY).lineWidth(0.8).stroke(SOFT);
    doc.font('Helvetica-Bold').fontSize(L.label + 0.6).fillColor(INK).text('FIRMA DEL REPRESENTANTE LEGAL', left, lineY + 4, { width: half, align: 'center', characterSpacing: 0.4 });
    doc.font('Helvetica').fontSize(L.label + 1).fillColor(SOFT).text(`${s.guardianName || 'Nombre: ____________________'}${s.guardianNationalId ? ` · C.I. ${s.guardianNationalId}` : ' · C.I.: ____________'}`, left, lineY + 14, { width: half, align: 'center', height: 11, ellipsis: true });
    doc.text('Fecha: ____ / ____ / ________', left, lineY + 25, { width: half, align: 'center' });
    // Colegio: firma autorizada + sello
    const rw = half - seal - 10;
    doc.moveTo(right, lineY).lineTo(right + rw, lineY).lineWidth(0.8).stroke(SOFT);
    doc.font('Helvetica-Bold').fontSize(L.label + 0.6).fillColor(INK).text('FIRMA AUTORIZADA DEL COLEGIO', right, lineY + 4, { width: rw, align: 'center', characterSpacing: 0.4 });
    doc.font('Helvetica').fontSize(L.label + 1).fillColor(SOFT).text('Nombre y cargo: ______________', right, lineY + 14, { width: rw, align: 'center' });
    doc.text('Fecha: ____ / ____ / ________', right, lineY + 25, { width: rw, align: 'center' });
    doc.roundedRect(right + half - seal, lineY - seal + 6, seal, seal, 6).lineWidth(0.8).dash(3, { space: 3 }).stroke(SUBTLE).undash();
    doc.font('Helvetica').fontSize(7).fillColor(SUBTLE).text('Sello', right + half - seal, lineY - seal / 2 + 2, { width: seal, align: 'center' });

    // ---------- Pie ----------
    const range = doc.bufferedPageRange();
    pageCount = range.count;
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      const fy = PAGE.height - M - 8;
      doc.moveTo(M, fy - 6).lineTo(PAGE.width - M, fy - 6).lineWidth(0.4).stroke(BORDER);
      doc.font('Helvetica').fontSize(6.8).fillColor(SUBTLE);
      doc.text(`${tenant.name} · Planilla N° ${code(s.id)} · ${s.studentName}`, M, fy, { width: INNER * 0.75, lineBreak: false, ellipsis: true });
      doc.text(`Página ${i - range.start + 1} de ${range.count}`, M, fy, { width: INNER, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}

/** La planilla en la densidad más holgada que quepa en una hoja (o la más compacta si no alcanza). */
async function generateEnrollmentFormPdf(data) {
  let last = null;
  for (const L of LEVELS) {
    last = await render(data, L);
    if (last.pages === 1) return last.buffer;
  }
  return last.buffer;
}

module.exports = { generateEnrollmentFormPdf };
