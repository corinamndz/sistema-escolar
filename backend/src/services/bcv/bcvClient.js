const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const { X509Certificate } = require('crypto');

/**
 * Cliente HTTPS para la página del BCV.
 *
 * El servidor del BCV envía solo SU certificado, sin el intermedio que lo
 * firmó (cadena incompleta). Los navegadores lo completan solos descargando
 * el intermedio desde la dirección que trae el propio certificado (AIA,
 * "CA Issuers"); Node.js no, y rechaza la conexión con
 * UNABLE_TO_VERIFY_LEAF_SIGNATURE.
 *
 * Aquí hacemos lo mismo que el navegador, SIN desactivar la verificación:
 *   1. se intenta la conexión normal (si el BCV corrige su servidor, listo);
 *   2. si falla por cadena incompleta, se lee la dirección AIA del
 *      certificado del BCV y se descarga el intermedio;
 *   3. se comprueba que el intermedio sea una autoridad (CA) y que de verdad
 *      firmó el certificado del BCV;
 *   4. se reintenta con las autoridades de confianza de Node MÁS ese intermedio:
 *      la cadena completa se verifica contra las raíces como siempre, así que
 *      un intermedio falso no sirve de nada.
 * El intermedio queda en memoria hasta que vence.
 *
 * Alternativa sin red para el intermedio: NODE_EXTRA_CA_CERTS=/ruta/al/intermedio.pem
 */

const MAX_BODY = 5 * 1024 * 1024; // la página del BCV pesa ~300 KB
const MAX_CERT = 64 * 1024;
const intermediates = new Map(); // host → { pem, validTo }

/** Autoridades de confianza de Node (incluye NODE_EXTRA_CA_CERTS y, con --use-system-ca, las del sistema). */
const trustedRoots = () => (typeof tls.getCACertificates === 'function' ? tls.getCACertificates('default') : tls.rootCertificates);

const CHAIN_ERRORS = new Set(['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_GET_ISSUER_CERT']);

/**
 * GET que devuelve el cuerpo como texto. `ca` reemplaza las raíces (por eso se
 * incluyen las de Node). Acepta http:// para servidores locales de prueba
 * (BCV_URL); en producción las fuentes son https.
 */
function getText(url, { timeoutMs, ca, headers = {} } = {}) {
  const client = url.startsWith('http:') ? http : https;
  return new Promise((resolve, reject) => {
    const req = client.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'SistemaEscolar/1.0', ...headers }, ...(ca && client === https ? { ca } : {}) }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(getText(new URL(res.headers.location, url).toString(), { timeoutMs, ca, headers }));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { code: 'HTTP_STATUS' }));
      }
      let size = 0;
      const chunks = [];
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) req.destroy(new Error('Respuesta demasiado grande.'));
        else chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('Tiempo de espera agotado'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
  });
}

/** Descarga binaria simple (el intermedio se publica por http, como manda el estándar AIA). */
function getBuffer(url, timeoutMs) {
  const client = url.startsWith('https:') ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} al descargar el certificado intermedio`));
      }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_CERT) req.destroy(new Error('Certificado intermedio demasiado grande.'));
        else chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Tiempo de espera agotado al descargar el certificado intermedio')));
    req.on('error', reject);
  });
}

/**
 * Certificado del servidor, SOLO para leerlo (dirección AIA). Esta conexión no
 * envía ni recibe datos de la aplicación: se cierra apenas termina el saludo TLS.
 */
function peerCertificate(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, ...(net.isIP(host) ? {} : { servername: host }), rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const cert = socket.getPeerX509Certificate();
      socket.end();
      if (!cert) reject(new Error('El servidor no presentó certificado.'));
      else resolve(cert);
    });
    socket.on('timeout', () => socket.destroy(new Error('Tiempo de espera agotado')));
    socket.on('error', reject);
  });
}

function aiaIssuerUrl(cert) {
  const m = /CA Issuers - URI:(\S+)/.exec(cert.infoAccess || '');
  return m ? m[1] : null;
}

/** El intermedio que falta, verificado: es una CA y firmó el certificado del servidor. */
async function fetchIntermediate(host, port, timeoutMs) {
  const cached = intermediates.get(host);
  if (cached && cached.validTo > Date.now()) return cached.pem;

  const leaf = await peerCertificate(host, port, timeoutMs);
  const url = aiaIssuerUrl(leaf);
  if (!url || !/^https?:\/\//.test(url)) throw new Error('El certificado del BCV no indica dónde obtener su certificado intermedio.');
  const raw = await getBuffer(url, timeoutMs);
  // El intermedio viene en DER (binario) o, a veces, ya en PEM.
  const inter = new X509Certificate(raw.includes('-----BEGIN CERTIFICATE-----') ? raw.toString('utf8') : raw);
  if (!inter.ca) throw new Error('El certificado descargado no es de una autoridad certificadora.');
  if (!leaf.checkIssued(inter) || !leaf.verify(inter.publicKey)) {
    throw new Error('El certificado descargado no es el que firmó el certificado del BCV.');
  }
  intermediates.set(host, { pem: inter.toString(), validTo: Date.parse(inter.validTo) });
  return inter.toString();
}

/**
 * GET con verificación TLS completa; si el servidor no envía su cadena
 * completa, la completa vía AIA y reintenta (ver arriba).
 */
async function getTextCompletingChain(url, { timeoutMs = 15000 } = {}) {
  const { hostname, protocol, port } = new URL(url);
  if (protocol === 'http:') return getText(url, { timeoutMs });
  const cached = intermediates.get(hostname);
  if (cached && cached.validTo > Date.now()) {
    return getText(url, { timeoutMs, ca: [...trustedRoots(), cached.pem] });
  }
  try {
    return await getText(url, { timeoutMs });
  } catch (err) {
    if (!CHAIN_ERRORS.has(err.code)) throw err;
    const pem = await fetchIntermediate(hostname, Number(port) || 443, timeoutMs);
    return getText(url, { timeoutMs, ca: [...trustedRoots(), pem] });
  }
}

/** Solo para pruebas. */
function clearIntermediateCache() {
  intermediates.clear();
}

module.exports = { getText, getTextCompletingChain, clearIntermediateCache, aiaIssuerUrl };
