const PDFDocument = require('pdfkit');

/**
 * Genera el PDF del comprobante de pago en memoria (Buffer), listo para
 * adjuntar al correo o guardar en disco/S3.
 */
function generateReceiptPdf({
  tenantName,
  primaryColor = '#2563EB',
  studentName,
  guardianName,
  periodLabel,
  amount,
  currency,
  paidAt,
  receiptNumber,
}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A5', margin: 40 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fillColor(primaryColor).fontSize(20).text(tenantName, { align: 'center' });
    doc.moveDown(0.3);
    doc.fillColor('#1e293b').fontSize(14).text('Comprobante de pago', { align: 'center' });
    doc.moveDown(1.5);

    doc.fontSize(10).fillColor('#64748b');
    const row = (label, value) => {
      doc.fillColor('#64748b').text(label, { continued: true, width: 200 });
      doc.fillColor('#1e293b').text(String(value), { align: 'right' });
      doc.moveDown(0.4);
    };

    row('N° de comprobante:', receiptNumber);
    row('Fecha de pago:', paidAt);
    row('Alumno:', studentName);
    row('Representante:', guardianName);
    row('Concepto:', periodLabel);

    doc.moveDown(1);
    doc.moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).strokeColor('#e2e8f0').stroke();
    doc.moveDown(1);

    doc.fontSize(18).fillColor(primaryColor).text(`Monto pagado: ${currency} ${amount}`, { align: 'center' });

    doc.moveDown(2);
    doc.fontSize(8).fillColor('#94a3b8').text(
      'Este comprobante fue generado automáticamente por el sistema y no requiere firma.',
      { align: 'center' }
    );

    doc.end();
  });
}

module.exports = { generateReceiptPdf };
