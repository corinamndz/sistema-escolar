/**
 * Exporta un arreglo de filas a un archivo .xlsx y lo descarga en el navegador.
 *
 * @param {string} filename  Nombre del archivo (sin extensión).
 * @param {Array<{header: string, value: (row) => any, width?: number}>} columns
 * @param {Array} rows  Filas a exportar (ya filtradas).
 */
export async function exportToExcel(filename, columns, rows) {
  // Importación dinámica para no aumentar el bundle inicial.
  const XLSX = await import('xlsx');

  const headers = columns.map((c) => c.header);
  const data = rows.map((row) => columns.map((c) => c.value(row) ?? ''));

  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);

  // Anchos de columna.
  ws['!cols'] = columns.map((c) => ({ wch: c.width ?? 20 }));

  // Negrita en la fila de encabezado.
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let col = range.s.c; col <= range.e.c; col++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 0, c: col })];
    if (cell) cell.s = { font: { bold: true } };
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Datos');
  XLSX.writeFile(wb, `${filename}.xlsx`);
}
