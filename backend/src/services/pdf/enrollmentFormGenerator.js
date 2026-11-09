const fs = require('fs');
const PDFDocument = require('pdfkit');

/**
 * Planilla de inscripción completada, en PDF (A4 vertical), con la plantilla de
 * diseño elegida para esa planilla (enrollment_forms.template_style):
 *
 *   classic        membrete centrado, datos en tabla formal a doble columna, secciones con borde
 *   modern         banda de color y bloques sombreados por sección
 *   compact        lo más denso posible, para ahorrar papel
 *   institutional  serif, secciones numeradas, firmas con sellos a los laterales
 *   minimal        sin líneas ni color: tipografía y espacio en blanco
 *
 * Todas muestran lo mismo (membrete, datos generales, respuestas, firmas, pie);
 * cambia la distribución. Cada plantilla define sus niveles de densidad y se usa
 * el más holgado que entre en una hoja; si ni el más denso alcanza (planillas muy
 * largas), se usan más páginas y las firmas van al pie de la última. La foto del
 * alumno (campo «foto») va siempre en la esquina superior derecha. Solo fuentes
 * estándar de PDF.
 *
 * Las miniaturas del selector están en
 * frontend/src/features/enrollment-forms/components/PdfTemplatePicker.jsx.
 */

const PAGE = { width: 595.28, height: 841.89 }; // A4
const INK = '#0f172a';
const SOFT = '#334155';
const MUTED = '#64748b';
const SUBTLE = '#94a3b8';
const BORDER = '#e2e8f0';
const FRAME = '#94a3b8';
const CARD = '#f1f5f9';
const STATUS = { pending: 'Por llenar', submitted: 'En revisión', changes_requested: 'Por corregir', approved: 'Aprobada', rejected: 'Rechazada' };

const SANS = { r: 'Helvetica', b: 'Helvetica-Bold', i: 'Helvetica-Oblique' };
const SERIF = { r: 'Times-Roman', b: 'Times-Bold', i: 'Times-Italic' };

/**
 *   header     membrete    · section  título de sección · cells  celdas de respuestas
 *   dataCells  celdas de los datos generales · dataCols   sus columnas
 *   signature  firmas      · levels   densidades, de la más holgada a la más compacta
 */
const TEMPLATES = {
  classic: {
    fonts: SANS, header: 'centered', section: 'bar', cells: 'table', dataCells: 'table', dataCols: 2, signature: 'boxed', titleAlign: 'center',
    levels: [
      { m: 40, value: 9.2, label: 6.6, cols: 2, padY: 4.5, gapSec: 10, title: 12.5, logo: 44, photo: [70, 88], sign: 104 },
      { m: 32, value: 8.5, label: 6.2, cols: 2, padY: 3.2, gapSec: 7, title: 11.5, logo: 36, photo: [62, 78], sign: 96 },
      { m: 26, value: 7.8, label: 5.8, cols: 2, padY: 2.4, gapSec: 5, title: 10.5, logo: 28, photo: [54, 68], sign: 90 },
    ],
  },
  modern: {
    fonts: SANS, header: 'banner', section: 'card', cells: 'shaded', dataCells: 'shaded', dataCols: 3, signature: 'pair', titleAlign: 'left',
    levels: [
      { m: 36, value: 9.2, label: 6.8, cols: 2, padY: 4.5, gapSec: 10, title: 13, logo: 46, photo: [64, 80], sign: 98 },
      { m: 30, value: 8.5, label: 6.3, cols: 2, padY: 3.4, gapSec: 7, title: 12, logo: 40, photo: [56, 70], sign: 90 },
      { m: 26, value: 7.9, label: 5.9, cols: 3, padY: 2.4, gapSec: 5, title: 11, logo: 34, photo: [48, 60], sign: 84 },
    ],
  },
  compact: {
    fonts: SANS, header: 'bar', section: 'rule', cells: 'lines', dataCells: 'shaded', dataCols: 3, signature: 'pair', titleAlign: 'left',
    levels: [
      { m: 26, value: 7.9, label: 5.9, cols: 3, padY: 3, gapSec: 4, title: 11.5, logo: 40, photo: [58, 72], sign: 84 },
      { m: 20, value: 7.2, label: 5.4, cols: 3, padY: 2, gapSec: 3, title: 10.5, logo: 32, photo: [48, 60], sign: 78 },
    ],
  },
  institutional: {
    fonts: SERIF, header: 'crest', section: 'numbered', cells: 'lines', dataCells: 'table', dataCols: 2, signature: 'seals', titleAlign: 'center',
    levels: [
      { m: 42, value: 10, label: 7.4, cols: 2, padY: 4.6, gapSec: 11, title: 12.5, logo: 56, photo: [64, 80], sign: 118 },
      { m: 34, value: 9.2, label: 6.8, cols: 2, padY: 3.4, gapSec: 8, title: 11.5, logo: 48, photo: [58, 72], sign: 108 },
      { m: 28, value: 8.4, label: 6.2, cols: 2, padY: 2.4, gapSec: 5, title: 10.5, logo: 40, photo: [50, 62], sign: 100 },
    ],
  },
  minimal: {
    fonts: SANS, header: 'plain', section: 'space', cells: 'plain', dataCells: 'plain', dataCols: 3, signature: 'thin', titleAlign: 'left', plainLabels: true,
    levels: [
      { m: 48, value: 9.5, label: 7.2, cols: 2, padY: 5.5, gapSec: 16, title: 17, logo: 28, photo: [60, 75], sign: 82 },
      { m: 38, value: 8.8, label: 6.8, cols: 2, padY: 3.8, gapSec: 10, title: 15, logo: 26, photo: [54, 68], sign: 76 },
      { m: 28, value: 8, label: 6.2, cols: 3, padY: 2.6, gapSec: 6, title: 13, logo: 22, photo: [48, 60], sign: 70 },
    ],
  },
};
const TEMPLATE_STYLES = Object.keys(TEMPLATES);
const DEFAULT_STYLE = 'classic';

const validHex = (c, fb) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : fb);
const code = (id) => String(id).replace(/-/g, '').slice(0, 8).toUpperCase().replace(/^(.{4})/, '$1-');
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];
const isLight = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.62;
};
/** Texto legible sobre el color del colegio: blanco, o tinta si el color es claro. */
const readableOn = (hex) => (isLight(hex) ? INK : '#ffffff');
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

/** Un render completo con la plantilla `T` y la densidad `L`. → { buffer, pages } */
function render({ tenant, form, submission: s, sample = false }, T, L) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Title: `${form.title} - ${s.studentName}`, Author: tenant.name, Subject: 'Planilla de inscripción' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    let pageCount = 1;
    doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), pages: pageCount }));
    doc.on('error', reject);

    const F = T.fonts;
    const M = L.m;
    const INNER = PAGE.width - M * 2;
    const RIGHT = PAGE.width - M;
    const FOOT = 22;
    const BOTTOM = PAGE.height - M - FOOT;
    const brand = validHex(tenant.primaryColor, '#2563eb');
    const brandText = isLight(brand) ? INK : brand; // para letras sobre fondo claro
    const showPhoto = s.hasPhotoField || Boolean(s.photoPath);
    const contact = [tenant.phone, tenant.email].filter(Boolean).join(' · ') || null;
    const hasLogo = tenant.logoPath && fs.existsSync(tenant.logoPath);
    /** Tamaño con el que `text` cabe en dos líneas de ancho `w`, desde `base` hasta 8 pt. */
    const fitSize = (font, text, w, base) => {
      let size = base;
      while (size > 8) {
        doc.font(font).fontSize(size);
        if (doc.heightOfString(text, { width: w }) <= size * 2.6) break;
        size -= 0.5;
      }
      return size;
    };
    const schoolName = (font, text, x, ly, w, base, color, align = 'left') => {
      doc.font(font).fontSize(fitSize(font, text, w, base)).fillColor(color).text(text, x, ly, { width: w, align });
    };

    const drawLogo = (x, top, size) => {
      if (!hasLogo) return false;
      try {
        doc.image(tenant.logoPath, x, top, { fit: [size, size], align: 'center', valign: 'center' });
        return true;
      } catch {
        return false;
      }
    };
    /** Foto del alumno, tamaño carnet; sin foto, el recuadro para pegarla. */
    const drawPhoto = (x, top, w, h, { stroke = BORDER, faint = SUBTLE, radius = 6 } = {}) => {
      if (s.photoPath && fs.existsSync(s.photoPath)) {
        try {
          doc.save();
          doc.roundedRect(x, top, w, h, radius).clip();
          doc.image(s.photoPath, x, top, { cover: [w, h], align: 'center', valign: 'center' });
          doc.restore();
          doc.roundedRect(x, top, w, h, radius).lineWidth(0.8).stroke(stroke);
          return;
        } catch {
          doc.restore();
        }
      }
      doc.roundedRect(x, top, w, h, radius).lineWidth(0.8).dash(3, { space: 3 }).stroke(faint).undash();
      doc.font(F.r).fontSize(7.5).fillColor(faint).text('Foto', x, top + h / 2 - 4, { width: w, align: 'center' });
    };

    // ---------- Membretes: dibujan el encabezado y devuelven dónde sigue el contenido ----------
    const letterheads = {
      /** Logo a la izquierda, datos del colegio y número a la derecha, filete de color. */
      bar(first) {
        doc.rect(0, 0, PAGE.width, 4).fill(brand);
        const top = Math.max(M - 8, 10);
        const logo = first ? L.logo : 30;
        const [pw, ph] = first && showPhoto ? L.photo : [0, 0];
        const x = drawLogo(M, top, logo) ? M + logo + 12 : M;
        const photoX = RIGHT - pw;
        if (pw) drawPhoto(photoX, top, pw, ph);
        const rightW = 150;
        const rightX = (pw ? photoX - 12 : RIGHT) - rightW;
        const textW = rightX - x - 10;
        schoolName(F.b, tenant.name, x, top + 1, textW, first ? 13 : 10.5, INK);
        let ly = doc.y + 2;
        if (first) {
          [tenant.rif ? `RIF ${tenant.rif}` : null, tenant.address, contact].filter(Boolean).forEach((line, i) => {
            const bold = i === 0 && tenant.rif;
            doc.font(bold ? F.b : F.r).fontSize(7.8).fillColor(bold ? SOFT : MUTED).text(line, x, ly, { width: textW, height: 20, ellipsis: true });
            ly = doc.y + 1;
          });
        }
        doc.font(F.b).fontSize(6.8).fillColor(brandText).text('PLANILLA DE INSCRIPCIÓN', rightX, top + 2, { width: rightW, align: 'right', characterSpacing: 0.8 });
        doc.font(F.b).fontSize(first ? 12.5 : 10).fillColor(INK).text(`N° ${code(s.id)}`, rightX, top + 12, { width: rightW, align: 'right' });
        if (first) doc.font(F.r).fontSize(7.8).fillColor(MUTED).text(`Año escolar ${form.schoolPeriod}`, rightX, top + 28, { width: rightW, align: 'right' });
        const bottom = Math.max(top + logo, ly, top + (first ? 40 : 30), top + ph) + 6;
        doc.moveTo(M, bottom).lineTo(pw ? photoX - 8 : RIGHT, bottom).lineWidth(1.1).stroke(brand);
        return bottom + 8;
      },
      /** Membrete centrado: logo, colegio y datos, una línea con el número y un filete. */
      centered(first) {
        const top = Math.max(M - 12, 14);
        const [pw, ph] = first && showPhoto ? L.photo : [0, 0];
        if (pw) drawPhoto(RIGHT - pw, top, pw, ph, { stroke: FRAME, radius: 2 });
        const side = pw ? pw + 10 : 0;
        const tx = M + side;
        const tw = INNER - side * 2;
        let ly = top;
        if (first && drawLogo(PAGE.width / 2 - L.logo / 2, top, L.logo)) ly = top + L.logo + 3;
        schoolName(F.b, tenant.name, tx, ly, tw, first ? 13.5 : 10.5, INK, 'center');
        ly = doc.y + 1;
        if (first) {
          [tenant.rif ? `RIF ${tenant.rif}` : null, tenant.address, contact].filter(Boolean).forEach((line) => {
            doc.font(F.r).fontSize(7.8).fillColor(SOFT).text(line, tx, ly, { width: tw, align: 'center', height: 20, ellipsis: true });
            ly = doc.y + 0.5;
          });
          ly += 2;
        }
        doc.font(F.b).fontSize(7.4).fillColor(INK).text(`PLANILLA DE INSCRIPCIÓN · N° ${code(s.id)}${first ? ` · AÑO ESCOLAR ${form.schoolPeriod}` : ''}`, tx, ly, { width: tw, align: 'center', characterSpacing: 0.4 });
        const bottom = Math.max(doc.y, top + ph) + 5;
        doc.moveTo(M, bottom).lineTo(RIGHT, bottom).lineWidth(1).stroke(INK);
        return bottom + 9;
      },
      /** Banda de color de lado a lado con el membrete dentro. */
      banner(first) {
        const on = readableOn(brand);
        const [pw, ph] = first && showPhoto ? L.photo : [0, 0];
        const logo = first ? L.logo : 24;
        const pad = 12;
        const lines = first ? [tenant.rif ? `RIF ${tenant.rif}` : null, tenant.address, contact].filter(Boolean) : [];
        const reserved = 34 + lines.length * 10; // nombre en dos líneas y datos del colegio
        const height = first ? Math.max(logo, ph, reserved) + pad * 2 : 42;
        doc.rect(0, 0, PAGE.width, height).fill(brand);
        let x = M;
        if (hasLogo) {
          const chip = logo + 8;
          const chipY = (height - chip) / 2;
          doc.roundedRect(M, chipY, chip, chip, 6).fill('#ffffff');
          if (drawLogo(M + 4, chipY + 4, logo)) x = M + chip + 12;
        }
        const photoX = RIGHT - pw;
        if (pw) drawPhoto(photoX, (height - ph) / 2, pw, ph, { stroke: on, faint: on });
        const rightW = 130;
        const rightX = (pw ? photoX - 12 : RIGHT) - rightW;
        const textW = rightX - x - 10;
        let ly = first ? Math.max(pad, height / 2 - reserved / 2) : height / 2 - 6;
        schoolName(F.b, tenant.name, x, ly, textW, first ? 13.5 : 10.5, on);
        ly = doc.y + 2;
        lines.forEach((line) => {
          doc.font(F.r).fontSize(7.6).fillColor(on).text(line, x, ly, { width: textW, height: 10, ellipsis: true });
          ly = doc.y + 0.5;
        });
        const ry = height / 2 - (first ? 18 : 11);
        doc.font(F.b).fontSize(6.6).fillColor(on).text('PLANILLA DE INSCRIPCIÓN', rightX, ry, { width: rightW, align: 'right', characterSpacing: 0.6 });
        doc.font(F.b).fontSize(first ? 12 : 10).fillColor(on).text(`N° ${code(s.id)}`, rightX, ry + 10, { width: rightW, align: 'right' });
        if (first) doc.font(F.r).fontSize(7.6).fillColor(on).text(`Año escolar ${form.schoolPeriod}`, rightX, ry + 25, { width: rightW, align: 'right' });
        return height + 12;
      },
      /** Logo y foto a los lados, colegio centrado en mayúsculas y doble filete. */
      crest(first) {
        const top = Math.max(M - 12, 14);
        const logo = first ? L.logo : 26;
        const [pw, ph] = first && showPhoto ? L.photo : [0, 0];
        drawLogo(M, top, logo);
        if (pw) drawPhoto(RIGHT - pw, top, pw, ph, { stroke: FRAME, radius: 0 });
        const side = Math.max(hasLogo ? logo : 0, pw) + 10;
        const tx = M + side;
        const tw = INNER - side * 2;
        schoolName(F.b, tenant.name.toUpperCase(), tx, top + 1, tw, first ? 14 : 10.5, INK, 'center');
        let ly = doc.y + 1;
        if (first) {
          [tenant.rif ? `RIF ${tenant.rif}` : null, tenant.address, contact].filter(Boolean).forEach((line) => {
            doc.font(F.r).fontSize(8.6).fillColor(SOFT).text(line, tx, ly, { width: tw, align: 'center', height: 22, ellipsis: true });
            ly = doc.y;
          });
          ly += 2;
        }
        doc.font(F.b).fontSize(first ? 9.4 : 8).fillColor(INK).text(`PLANILLA DE INSCRIPCIÓN · N° ${code(s.id)}`, tx, ly, { width: tw, align: 'center', characterSpacing: 0.5 });
        ly = doc.y;
        if (first) {
          doc.font(F.r).fontSize(8.6).fillColor(SOFT).text(`Año escolar ${form.schoolPeriod}`, tx, ly, { width: tw, align: 'center' });
          ly = doc.y;
        }
        const bottom = Math.max(ly, top + logo, top + ph) + 6;
        doc.moveTo(M, bottom).lineTo(RIGHT, bottom).lineWidth(1.2).stroke(INK);
        doc.moveTo(M, bottom + 2.4).lineTo(RIGHT, bottom + 2.4).lineWidth(0.4).stroke(INK);
        return bottom + 11;
      },
      /** Sin líneas ni color: logo pequeño, colegio y, a la derecha, el número. */
      plain(first) {
        const top = M - 12;
        const logo = first ? L.logo : 18;
        const [pw, ph] = first && showPhoto ? L.photo : [0, 0];
        const x = drawLogo(M, top, logo) ? M + logo + 10 : M;
        const photoX = RIGHT - pw;
        if (pw) drawPhoto(photoX, top, pw, ph, { radius: 4 });
        const rightW = 120;
        const rightX = (pw ? photoX - 14 : RIGHT) - rightW;
        const textW = rightX - x - 10;
        schoolName(F.b, tenant.name, x, top + 1, textW, first ? 10.5 : 9, INK);
        let ly = doc.y + 1;
        if (first) {
          [tenant.rif ? `RIF ${tenant.rif}` : null, tenant.address, contact].filter(Boolean).forEach((line) => {
            doc.font(F.r).fontSize(7.4).fillColor(MUTED).text(line, x, ly, { width: textW, height: 18, ellipsis: true });
            ly = doc.y + 0.5;
          });
        }
        doc.font(F.r).fontSize(7.4).fillColor(MUTED).text(`Planilla N° ${code(s.id)}`, rightX, top + 2, { width: rightW, align: 'right' });
        if (first) doc.font(F.r).fontSize(7.4).fillColor(MUTED).text(`Año escolar ${form.schoolPeriod}`, rightX, top + 12, { width: rightW, align: 'right' });
        return Math.max(ly, top + logo, top + ph) + (first ? 14 : 10);
      },
    };

    const letterhead = letterheads[T.header];
    let y = letterhead(true);
    const newPage = () => {
      doc.addPage({ size: 'A4', margin: 0 });
      y = letterhead(false);
    };
    const ensure = (h) => {
      if (y + h > BOTTOM) newPage();
    };

    // ---------- Cuadrícula de celdas (etiqueta arriba, valor abajo) ----------
    const labelText = (label) => (T.plainLabels ? label : label.toUpperCase());
    const labelFont = T.plainLabels ? F.r : F.b;
    const labelSpacing = T.plainLabels ? 0 : 0.3;
    const cellH = (label, value, w) => {
      doc.font(labelFont).fontSize(L.label);
      const lh = doc.heightOfString(labelText(label), { width: w, characterSpacing: labelSpacing });
      doc.font(F.r).fontSize(L.value);
      const vh = doc.heightOfString(value, { width: w });
      return lh + vh + 2 + L.padY * 2;
    };
    const drawCell = (label, value, x, cy, w) => {
      doc.font(labelFont).fontSize(L.label).fillColor(MUTED).text(labelText(label), x, cy + L.padY, { width: w, characterSpacing: labelSpacing });
      doc.font(F.r).fontSize(L.value).fillColor(value === '—' ? SUBTLE : INK).text(value, x, doc.y + 1.5, { width: w });
    };
    /** Bloque sombreado con filete de color (se dibuja por filas para poder partirse entre páginas). */
    const shade = (top, h) => {
      doc.rect(M, top, INNER, h).fill(CARD);
      doc.rect(M, top, 2.5, h).fill(brand);
    };
    /**
     * Filas de `cols` celdas; las marcadas `wide` ocupan la fila entera.
     *   kind  lines: filete bajo cada fila · table: celdas con borde · shaded: bloque · plain: nada
     */
    const grid = (items, cols, kind) => {
      const inset = kind === 'shaded' ? 10 : kind === 'table' ? 6 : 0;
      const gap = kind === 'table' ? 0 : kind === 'plain' ? 18 : 14;
      const slot = (INNER - (kind === 'shaded' ? inset * 2 : 0) - gap * (cols - 1)) / cols; // ancho de cada columna
      const textW = kind === 'table' ? slot - inset * 2 : slot;
      const wideW = kind === 'lines' || kind === 'plain' ? INNER : INNER - inset * 2;
      const x0 = M + (kind === 'shaded' ? inset : 0);
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
      rows.forEach((r) => {
        const h = Math.max(...r.map((it) => cellH(it.label, it.value, it.wide ? wideW : textW)));
        ensure(h);
        if (kind === 'shaded') shade(y, h);
        if (kind === 'table') {
          if (r[0].wide) doc.rect(M, y, INNER, h).lineWidth(0.5).stroke(FRAME);
          else for (let j = 0; j < cols; j += 1) doc.rect(M + j * slot, y, slot, h).lineWidth(0.5).stroke(FRAME);
        }
        r.forEach((it, j) => {
          const cx = kind === 'table' ? M + j * slot + inset : x0 + j * (slot + gap);
          drawCell(it.label, it.value, it.wide ? M + (kind === 'lines' || kind === 'plain' ? 0 : inset) : cx, y, it.wide ? wideW : textW);
        });
        y += h;
        if (kind === 'lines') doc.moveTo(M, y).lineTo(RIGHT, y).lineWidth(0.4).stroke(BORDER);
      });
    };

    // ---------- Título y datos generales ----------
    doc.font(T.plainLabels ? F.r : F.b).fontSize(L.title).fillColor(INK).text(form.title, M, y, { width: INNER, align: T.titleAlign });
    y = doc.y + (T.plainLabels ? 9 : 6);
    grid(
      [
        { label: s.isApplicant ? 'Aspirante' : 'Alumno', value: s.studentName || '—' },
        { label: 'Representante legal', value: s.guardianName || '—' },
        { label: 'C.I. del representante', value: s.guardianNationalId || '—' },
        { label: 'Contacto', value: [s.guardianPhone, s.guardianEmail].filter(Boolean).join(' · ') || '—' },
        { label: 'Enviada', value: dmy(s.submittedAt) },
        { label: 'Estado', value: `${STATUS[s.status] || s.status}${s.reviewedAt ? ` (${dmy(s.reviewedAt)})` : ''}` },
      ],
      T.dataCols,
      T.dataCells
    );
    if (s.reviewNote) {
      doc.font(F.i).fontSize(L.label + 1).fillColor(SOFT).text(`Observación del colegio: ${s.reviewNote}`, M, y + 3, { width: INNER });
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

    /** Texto de ayuda de la sección, bajo su título. */
    const sectionHelp = (help, x = M, w = INNER) => {
      if (!help) return;
      doc.font(F.r).fontSize(L.label + 0.6).fillColor(MUTED).text(help, x, y, { width: w });
      y = doc.y;
    };
    let number = 0;
    const headings = {
      rule(sec) {
        doc.font(F.b).fontSize(L.value + 1).fillColor(brandText).text(sec.title.toUpperCase(), M, y, { width: INNER, characterSpacing: 0.6 });
        y = doc.y + 1;
        sectionHelp(sec.help);
        doc.moveTo(M, y + 1).lineTo(RIGHT, y + 1).lineWidth(0.8).stroke(brand);
        y += 2;
      },
      bar(sec) {
        doc.font(F.b).fontSize(L.value);
        const h = doc.heightOfString(sec.title.toUpperCase(), { width: INNER - 12, characterSpacing: 0.5 }) + 7;
        doc.rect(M, y, INNER, h).fillAndStroke(CARD, FRAME);
        doc.fillColor(INK).text(sec.title.toUpperCase(), M + 6, y + 3.5, { width: INNER - 12, characterSpacing: 0.5 });
        y += h;
        if (sec.help) {
          y += 2;
          sectionHelp(sec.help);
          y += 2;
        }
      },
      card(sec) {
        doc.font(F.b).fontSize(L.value + 1);
        const titleH = doc.heightOfString(sec.title, { width: INNER - 20 });
        doc.font(F.r).fontSize(L.label + 0.6);
        const helpH = sec.help ? doc.heightOfString(sec.help, { width: INNER - 20 }) : 0;
        shade(y, titleH + helpH + 8);
        doc.font(F.b).fontSize(L.value + 1).fillColor(brandText).text(sec.title, M + 10, y + 5, { width: INNER - 20 });
        const top = y;
        y = doc.y;
        sectionHelp(sec.help, M + 10, INNER - 20);
        y = top + titleH + helpH + 8;
      },
      numbered(sec) {
        number += 1;
        doc.font(F.b).fontSize(L.value + 0.8).fillColor(INK).text(`${ROMAN[number - 1] || number}. ${sec.title.toUpperCase()}`, M, y, { width: INNER, characterSpacing: 0.4 });
        y = doc.y + 1;
        sectionHelp(sec.help);
        doc.moveTo(M, y + 1).lineTo(RIGHT, y + 1).lineWidth(0.7).stroke(INK);
        y += 2;
      },
      space(sec) {
        doc.font(F.b).fontSize(L.value + 1.5).fillColor(INK).text(sec.title, M, y, { width: INNER });
        y = doc.y + 1;
        sectionHelp(sec.help);
      },
    };

    for (const sec of sections) {
      if (sec.title) {
        ensure(L.gapSec + 34);
        y += L.gapSec;
        headings[T.section](sec);
      }
      grid(sec.items, L.cols, T.cells);
    }

    // ---------- Firmas: al pie de la última página ----------
    const DECLARATION = 'Declaro que la información suministrada es verdadera y me comprometo a notificar al colegio cualquier cambio.';
    if (y + 8 > BOTTOM - L.sign) newPage();
    const sy = BOTTOM - L.sign;
    const lineY = sy + L.sign - 40;
    const declare = (align = 'center') => {
      doc.font(F.i).fontSize(L.label + 0.8).fillColor(MUTED).text(DECLARATION, M, sy, { width: INNER, align });
      return doc.y;
    };
    const guardianLine = `${s.guardianName || 'Nombre: ____________________'}${s.guardianNationalId ? ` · C.I. ${s.guardianNationalId}` : ' · C.I.: ____________'}`;
    /** Línea de firma con su rótulo, y el nombre y la fecha debajo. */
    const signLine = (x, w, title, name, ly = lineY) => {
      doc.moveTo(x, ly).lineTo(x + w, ly).lineWidth(0.8).stroke(SOFT);
      doc.font(F.b).fontSize(L.label + 0.6).fillColor(INK).text(title, x, ly + 4, { width: w, align: 'center', characterSpacing: 0.4 });
      doc.font(F.r).fontSize(L.label + 1).fillColor(SOFT).text(name, x, ly + 14, { width: w, align: 'center', height: 11, ellipsis: true });
      doc.text('Fecha: ____ / ____ / ________', x, ly + 25, { width: w, align: 'center' });
    };
    const signatures = {
      /** Dos firmas; el sello del colegio en un recuadro junto a la segunda. */
      pair() {
        const top = declare();
        const half = (INNER - 30) / 2;
        const right = M + half + 30;
        const seal = Math.min(52, lineY - top + 2);
        const rw = half - seal - 10;
        signLine(M, half, 'FIRMA DEL REPRESENTANTE LEGAL', guardianLine);
        signLine(right, rw, 'FIRMA AUTORIZADA DEL COLEGIO', 'Nombre y cargo: ______________');
        doc.roundedRect(right + half - seal, lineY - seal + 2, seal, seal, 6).lineWidth(0.8).dash(3, { space: 3 }).stroke(SUBTLE).undash();
        doc.font(F.r).fontSize(7).fillColor(SUBTLE).text('Sello', right + half - seal, lineY - seal / 2 - 2, { width: seal, align: 'center' });
      },
      /** Dos recuadros con borde, como la tabla de datos. */
      boxed() {
        const top = declare() + 3;
        const half = (INNER - 12) / 2;
        const right = M + half + 12;
        const boxH = sy + L.sign - top;
        doc.rect(M, top, half, boxH).lineWidth(0.5).stroke(FRAME);
        doc.rect(right, top, half, boxH).lineWidth(0.5).stroke(FRAME);
        const ly = lineY;
        signLine(M + 12, half - 24, 'FIRMA DEL REPRESENTANTE LEGAL', guardianLine, ly);
        const seal = Math.min(46, ly - top - 4);
        const rw = half - seal - 30;
        signLine(right + 10, rw, 'FIRMA AUTORIZADA DEL COLEGIO', 'Nombre y cargo: ___________', ly);
        doc.rect(right + half - seal - 8, ly + 34 - seal, seal, seal).lineWidth(0.6).dash(3, { space: 3 }).stroke(SUBTLE).undash();
        doc.font(F.r).fontSize(7).fillColor(SUBTLE).text('Sello', right + half - seal - 8, ly + 34 - seal / 2 - 4, { width: seal, align: 'center' });
      },
      /** Sellos a los laterales y, entre ellos, las dos firmas. */
      seals() {
        const top = declare();
        const seal = Math.min(66, lineY - top + 30);
        const cy = lineY - 6;
        const circle = (cx) => {
          doc.circle(cx, cy, seal / 2).lineWidth(0.8).dash(3, { space: 3 }).stroke(SUBTLE).undash();
          doc.font(F.r).fontSize(7.5).fillColor(SUBTLE).text('Sello', cx - seal / 2, cy - 4, { width: seal, align: 'center' });
        };
        circle(M + seal / 2);
        circle(RIGHT - seal / 2);
        const gap = 16;
        const w = (INNER - seal * 2 - gap * 3) / 2;
        signLine(M + seal + gap, w, 'REPRESENTANTE LEGAL', guardianLine);
        signLine(M + seal + gap * 2 + w, w, 'POR EL COLEGIO', 'Nombre y cargo: ___________');
      },
      /** Dos líneas finas, sin recuadros. */
      thin() {
        declare('left');
        const half = (INNER - 40) / 2;
        const line = (x, title, name) => {
          doc.moveTo(x, lineY).lineTo(x + half, lineY).lineWidth(0.4).stroke(SUBTLE);
          doc.font(F.r).fontSize(L.label + 0.4).fillColor(INK).text(title, x, lineY + 4, { width: half });
          doc.fillColor(MUTED).text(name, x, lineY + 14, { width: half, height: 10, ellipsis: true });
          doc.text('Fecha: ____ / ____ / ________', x, lineY + 24, { width: half });
        };
        line(M, 'Representante legal', guardianLine);
        line(M + half + 40, 'Por el colegio (firma y sello)', 'Nombre y cargo: ______________');
      },
    };
    signatures[T.signature]();

    // ---------- Pie ----------
    const range = doc.bufferedPageRange();
    pageCount = range.count;
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      const fy = PAGE.height - M - 8;
      if (T.signature !== 'thin') doc.moveTo(M, fy - 6).lineTo(RIGHT, fy - 6).lineWidth(0.4).stroke(BORDER);
      doc.font(F.r).fontSize(6.8).fillColor(SUBTLE);
      const who = sample ? 'Ejemplo con datos ficticios' : s.studentName;
      let foot = `${tenant.name} · Planilla N° ${code(s.id)} · ${who}`;
      if (doc.widthOfString(foot) > INNER * 0.82) {
        foot = `Planilla N° ${code(s.id)} · ${who}`; // nombre de colegio muy largo: ya está en el membrete
      }
      doc.text(foot, M, fy, { lineBreak: false });
      doc.text(`Página ${i - range.start + 1} de ${range.count}`, M, fy, { width: INNER, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}

/**
 * La planilla con la plantilla `form.templateStyle`, en la densidad más holgada
 * que quepa en una hoja (o la más compacta si no alcanza).
 */
async function generateEnrollmentFormPdf(data) {
  const T = TEMPLATES[data.form.templateStyle] || TEMPLATES[DEFAULT_STYLE];
  let last = null;
  for (const L of T.levels) {
    last = await render(data, T, L);
    if (last.pages === 1) return last.buffer;
  }
  return last.buffer;
}

module.exports = { generateEnrollmentFormPdf, TEMPLATE_STYLES };
