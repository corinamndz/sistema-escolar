const nodemailer = require('nodemailer');

let transporter;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
    });
  }
  return transporter;
}

/**
 * @param {object} opts
 * @param {string} opts.to
 * @param {string} opts.subject
 * @param {string} opts.html
 * @param {{filename: string, content: Buffer, contentType?: string}[]} [opts.attachments]
 */
async function sendMail({ to, subject, html, attachments = [] }) {
  const mailer = getTransporter();
  return mailer.sendMail({
    from: process.env.SMTP_FROM || 'no-reply@school-saas.local',
    to,
    subject,
    html,
    attachments,
  });
}

module.exports = { sendMail };
