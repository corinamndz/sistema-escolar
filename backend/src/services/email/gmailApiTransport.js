const google = require('../google/googleOAuth');

/**
 * Transporte de Nodemailer que entrega por la Gmail API en lugar de SMTP.
 *
 * Por qué no SMTP: el SMTP de Gmail con OAuth2 (XOAUTH2) exige el permiso
 * completo https://mail.google.com/ (leer, borrar y enviar todo el correo),
 * que Google clasifica como restringido. Con la Gmail API basta gmail.send:
 * la plataforma solo puede ENVIAR desde la cuenta del colegio.
 *
 * Nodemailer arma el mensaje (remitente, adjuntos, codificación) igual que
 * siempre; este transporte solo lo entrega. `getAccessToken({ force })`
 * devuelve un token vigente (renovándolo si venció); si Gmail responde 401
 * se fuerza la renovación y se reintenta una vez.
 */
class GmailApiTransport {
  constructor({ getAccessToken }) {
    this.name = 'GmailAPI';
    this.version = '1.0.0';
    this.getAccessToken = getAccessToken;
  }

  send(mail, callback) {
    const envelope = mail.message.getEnvelope();
    mail.message.build((err, raw) => {
      if (err) return callback(err);
      this.deliver(raw)
        .then((res) => callback(null, { messageId: res.id, envelope, accepted: envelope.to, rejected: [], response: `Gmail API ${res.id}` }))
        .catch(callback);
      return undefined;
    });
  }

  async deliver(raw) {
    try {
      return await google.sendRawMessage(await this.getAccessToken({ force: false }), raw);
    } catch (err) {
      if (err.code !== 'GOOGLE_UNAUTHORIZED') throw err;
      return google.sendRawMessage(await this.getAccessToken({ force: true }), raw);
    }
  }
}

module.exports = { GmailApiTransport };
