const ExcelJS = require('exceljs');
const { listPayments } = require('./payment.service');

/**
 * Exportar a Excel (módulo de Pagos): los MISMOS registros que muestra la tabla
 * con los filtros activos en pantalla:
 *   status, schoolPeriodId   → los de la consulta (listPayments, idéntica a GET /payments)
 *   q                        → el buscador de la tabla: misma regla que DataTable
 *                              (sin acentos ni mayúsculas, "contiene") sobre los
 *                              mismos campos (alumno, representante, concepto, referencia).
 *
 * Columnas pedidas para la conciliación bancaria: alumno, cédula, mes cancelado,
 * monto (con el formato de su moneda), método de pago / referencia; y de apoyo:
 * estado, fecha de pago, representante y el equivalente cobrado en otra moneda.
 */

const STATUS_LABELS = {
  pending: 'Pendiente',
  overdue: 'Vencido',
  reported: 'Reportado',
  scheduled: 'Programado',
  paid: 'Pagado',
  failed: 'Fallido',
  refunded: 'Reembolsado',
  cancelled: 'Anulado',
};
const FILTER_LABELS = { due: 'Por cobrar', overdue: 'Vencidos', reported: 'Reportados', scheduled: 'Programados', paid: 'Pagados', cancelled: 'Anulados' };
const METHOD_LABELS = { transfer: 'Transferencia', mobile_payment: 'Pago móvil', deposit: 'Depósito', cash: 'Efectivo', card: 'Tarjeta', other: 'Otro' };
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const HEADER_FILL = 'FF1E293B'; // pizarra oscuro
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Igual que normalize() de DataTable.jsx: minúsculas y sin acentos. */
const normalize = (v) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Igual que getSearchText de PaymentsPage.jsx. */
const searchText = (p) => [p.student_first_name, p.student_last_name, p.guardian_first_name, p.guardian_last_name, p.period_label, p.report_reference].join(' ');

/** Date de pg (fecha local) o 'YYYY-MM-DD' → { y, m (0-11), d }. */
function dateParts(v) {
  if (!v) return null;
  if (v instanceof Date) return { y: v.getFullYear(), m: v.getMonth(), d: v.getDate() };
  const [y, m, d] = String(v).slice(0, 10).split('-').map(Number);
  return { y, m: m - 1, d };
}
const toExcelDate = (v) => {
  const p = dateParts(v);
  return p ? new Date(Date.UTC(p.y, p.m, p.d)) : null;
};

/** "Octubre 2026" para las mensualidades; el concepto tal cual para otros cobros. */
function monthLabel(p) {
  const bm = dateParts(p.billing_month);
  if (p.kind === 'tuition' && bm) return `${MONTHS[bm.m]} ${bm.y}`;
  return p.period_label || '';
}

/** Formato numérico de Excel con el símbolo y los decimales de la moneda: "Bs." #,##0.00 */
function moneyFormat(cur) {
  const decimals = cur?.decimals ?? 2;
  const symbol = String(cur?.symbol || cur?.code || '').replace(/"/g, '');
  const number = decimals > 0 ? `#,##0.${'0'.repeat(decimals)}` : '#,##0';
  return `"${symbol}" ${number};-"${symbol}" ${number}`;
}

/** "Transferencia · Ref. 001234" (lo registrado al confirmar o lo que reportó la familia). */
function methodAndReference(p) {
  const parts = [];
  if (p.report_method) parts.push(METHOD_LABELS[p.report_method] || p.report_method);
  if (p.report_reference) parts.push(`Ref. ${p.report_reference}`);
  return parts.join(' · ');
}

/** Cédula del alumno; si no tiene, la del representante (indicado). */
function nationalId(p) {
  if (p.student_national_id) return p.student_national_id;
  if (p.guardian_national_id) return `${p.guardian_national_id} (repr.)`;
  return '';
}

/** Para el nombre del archivo: minúsculas, sin acentos, guiones. */
const fileSlug = (s) =>
  normalize(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

async function exportPayments(trx, tenantId, { status, schoolPeriodId, q } = {}) {
  let rows = await listPayments(trx, tenantId, { status, schoolPeriodId });
  const query = normalize(String(q || '').trim());
  if (query) rows = rows.filter((p) => normalize(searchText(p)).includes(query));

  // Cédulas (la consulta del listado no las trae).
  const studentIds = [...new Set(rows.map((p) => p.student_id))];
  const guardianIds = [...new Set(rows.map((p) => p.guardian_id))];
  const students = studentIds.length ? await trx('students').where({ tenant_id: tenantId }).whereIn('id', studentIds).select('id', 'national_id') : [];
  const guardians = guardianIds.length ? await trx('guardians').where({ tenant_id: tenantId }).whereIn('id', guardianIds).select('id', 'national_id') : [];
  const sId = new Map(students.map((s) => [s.id, s.national_id]));
  const gId = new Map(guardians.map((g) => [g.id, g.national_id]));
  rows = rows.map((p) => ({ ...p, student_national_id: sId.get(p.student_id) || null, guardian_national_id: gId.get(p.guardian_id) || null }));

  // Símbolo y decimales de cada moneda (los del colegio prevalecen).
  const currencies = new Map(
    (
      await trx('currencies as c')
        .leftJoin('tenant_currencies as tc', function joinTenant() {
          this.on('tc.currency_code', 'c.code').andOn('tc.tenant_id', trx.raw('?', [tenantId]));
        })
        .select('c.code', 'c.symbol', trx.raw('COALESCE(tc.decimals, c.decimals) AS decimals'))
    ).map((c) => [c.code, c])
  );
  const curOf = (code) => currencies.get(code) || { code, symbol: code, decimals: 2 };

  const tenant = await trx('tenants').where({ id: tenantId }).first('name');
  const period = schoolPeriodId ? await trx('school_periods').where({ id: schoolPeriodId, tenant_id: tenantId }).first('name') : null;
  const statusLabel = status ? FILTER_LABELS[status] || status.split(',').map((s) => STATUS_LABELS[s] || s).join(', ') : 'Todos';

  // ---- Libro ----
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MoDo Educa';
  wb.created = new Date();
  const ws = wb.addWorksheet('Pagos', { properties: { defaultRowHeight: 18 } });

  const columns = [
    { key: 'student', header: 'Nombre del alumno', min: 22 },
    { key: 'nid', header: 'Cédula', min: 12 },
    { key: 'month', header: 'Mes cancelado', min: 15 },
    { key: 'amount', header: 'Monto', min: 14, money: true },
    { key: 'method', header: 'Método de pago / Referencia', min: 26 },
    { key: 'status', header: 'Estado', min: 11 },
    { key: 'paidOn', header: 'Fecha de pago', min: 13, date: true },
    { key: 'guardian', header: 'Representante', min: 20 },
    { key: 'ref', header: 'Equivalente cobrado', min: 18, money: true },
  ];
  ws.columns = columns.map((c) => ({ key: c.key }));

  // Título y filtros aplicados (filas 1–2), cabecera en la 4.
  ws.mergeCells(1, 1, 1, columns.length);
  ws.getCell('A1').value = `Reporte de pagos · ${tenant?.name || ''}`.trim();
  ws.getCell('A1').font = { bold: true, size: 14, color: { argb: HEADER_FILL } };
  ws.mergeCells(2, 1, 2, columns.length);
  const now = new Date();
  const stamp = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  ws.getCell('A2').value = [
    `Estado: ${statusLabel}`,
    `Año escolar: ${period?.name || 'Todos'}`,
    query ? `Búsqueda: «${String(q).trim()}»` : null,
    `${rows.length} registro(s)`,
    `Generado: ${stamp}`,
  ]
    .filter(Boolean)
    .join('   ·   ');
  ws.getCell('A2').font = { size: 10, color: { argb: 'FF64748B' } };

  const HEADER_ROW = 4;
  const header = ws.getRow(HEADER_ROW);
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: 'middle', horizontal: c.money ? 'right' : 'left', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: HEADER_FILL } } };
  });
  header.height = 24;

  const widths = columns.map((c) => Math.max(c.min, c.header.length + 2));
  const fit = (i, text) => {
    widths[i] = Math.max(widths[i], Math.min(48, String(text ?? '').length + 2));
  };

  const totals = new Map(); // moneda → centavos (o unidades mínimas)
  rows.forEach((p, idx) => {
    const cur = curOf(p.currency);
    const paid = p.display_status === 'paid';
    const refCur = paid && p.ref_currency && p.ref_currency !== p.currency && p.ref_amount !== null ? curOf(p.ref_currency) : null;
    const values = {
      student: `${p.student_first_name} ${p.student_last_name}`.trim(),
      nid: nationalId(p),
      month: monthLabel(p),
      amount: Number(p.amount),
      method: methodAndReference(p),
      status: STATUS_LABELS[p.display_status] || p.display_status,
      paidOn: paid ? toExcelDate(p.report_paid_on || p.paid_at) : null,
      guardian: `${p.guardian_first_name} ${p.guardian_last_name}`.trim(),
      ref: refCur ? Number(p.ref_amount) : null,
    };
    const row = ws.getRow(HEADER_ROW + 1 + idx);
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.value = values[c.key];
      if (c.key === 'amount') {
        cell.numFmt = moneyFormat(cur);
        fit(i, `${cur.symbol} ${values.amount.toFixed(cur.decimals)}xx`);
      } else if (c.key === 'ref' && refCur) {
        cell.numFmt = moneyFormat(refCur);
        cell.note = p.ref_rate ? `Tasa ${Number(p.ref_rate)} (${p.ref_currency}/${p.currency})` : undefined;
        fit(i, `${refCur.symbol} ${values.ref.toFixed(refCur.decimals)}xx`);
      } else if (c.date && values[c.key]) {
        cell.numFmt = 'dd/mm/yyyy';
      } else {
        fit(i, values[c.key]);
      }
      cell.alignment = { vertical: 'middle', horizontal: c.money ? 'right' : 'left' };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } };
    });
    if (idx % 2 === 1) columns.forEach((_, i) => { row.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }; });
    const scale = 10 ** cur.decimals;
    totals.set(p.currency, (totals.get(p.currency) || 0) + Math.round(Number(p.amount) * scale));
  });

  // Total por moneda (sin mezclar monedas).
  let r = HEADER_ROW + rows.length + 2;
  [...totals.entries()].forEach(([code, units]) => {
    const cur = curOf(code);
    const row = ws.getRow(r);
    row.getCell(3).value = `Total ${code}`;
    row.getCell(3).font = { bold: true };
    row.getCell(3).alignment = { horizontal: 'right' };
    row.getCell(4).value = units / 10 ** cur.decimals;
    row.getCell(4).numFmt = moneyFormat(cur);
    row.getCell(4).font = { bold: true };
    row.getCell(4).border = { top: { style: 'thin', color: { argb: HEADER_FILL } } };
    fit(3, `${cur.symbol} ${(units / 10 ** cur.decimals).toFixed(cur.decimals)}xxx`);
    r += 1;
  });
  if (!rows.length) ws.getRow(HEADER_ROW + 1).getCell(1).value = 'No hay pagos con estos filtros.';

  columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = widths[i];
  });
  ws.views = [{ state: 'frozen', ySplit: HEADER_ROW, xSplit: 1 }];
  if (rows.length) ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW + rows.length, column: columns.length } };
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${HEADER_ROW}:${HEADER_ROW}` };

  const nameParts = ['reporte_pagos', fileSlug(statusLabel), period ? fileSlug(period.name) : null, query ? 'filtrado' : null, `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`];
  return {
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
    fileName: `${nameParts.filter(Boolean).join('_')}.xlsx`,
    count: rows.length,
    mime: XLSX_MIME,
  };
}

module.exports = { exportPayments, XLSX_MIME };
