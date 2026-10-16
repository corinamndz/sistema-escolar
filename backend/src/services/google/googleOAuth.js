const crypto = require('crypto');

/**
 * Cliente mínimo de Google OAuth2 + Gmail API (sin dependencias: fetch de Node).
 *
 * Configuración del servidor (una sola app de Google Cloud para la plataforma):
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET   credenciales "Aplicación web"
 *   GOOGLE_OAUTH_REDIRECT_URI                 URI de redirección autorizada en Google Cloud
 *        (por defecto http://localhost:<PORT>/api/integrations/google/callback)
 * Las URL de Google se pueden cambiar (GOOGLE_AUTH_URL, GOOGLE_TOKEN_URL,
 * GOOGLE_REVOKE_URL, GOOGLE_GMAIL_API_URL) para pruebas con un servidor falso.
 *
 * Permisos pedidos: gmail.send (solo ENVIAR; no puede leer el correo) y
 * openid + email (para saber qué cuenta se conectó).
 */

const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/gmail.send'];
const GMAIL_SEND = 'https://www.googleapis.com/auth/gmail.send';

function config() {
  const port = process.env.PORT || 4000;
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI || `http://localhost:${port}/api/integrations/google/callback`,
    authUrl: process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
    revokeUrl: process.env.GOOGLE_REVOKE_URL || 'https://oauth2.googleapis.com/revoke',
    gmailApiUrl: (process.env.GOOGLE_GMAIL_API_URL || 'https://gmail.googleapis.com').replace(/\/$/, ''),
  };
}

const isConfigured = () => Boolean(config().clientId && config().clientSecret);

class GoogleError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** PKCE: verificador aleatorio y su desafío S256. */
function pkcePair() {
  const verifier = b64url(crypto.randomBytes(48));
  return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) };
}

/** URL de la pantalla de consentimiento de Google. */
function buildAuthUrl({ state, codeChallenge, loginHint }) {
  const c = config();
  const params = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline', // para recibir el token de refresco
    prompt: 'consent', // siempre devuelve un token de refresco nuevo
    include_granted_scopes: 'true',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  if (loginHint) params.set('login_hint', loginHint);
  return `${c.authUrl}?${params}`;
}

async function postForm(url, body, timeoutMs = 15000) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new GoogleError(`No se pudo contactar a Google (${err.cause?.code || err.message}).`, 'GOOGLE_UNREACHABLE');
  }
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

/** Intercambia el `code` del regreso por los tokens. */
async function exchangeCode({ code, codeVerifier }) {
  const c = config();
  const { res, data } = await postForm(c.tokenUrl, {
    code,
    client_id: c.clientId,
    client_secret: c.clientSecret,
    redirect_uri: c.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  });
  if (!res.ok) throw new GoogleError(`Google rechazó la autorización (${data.error_description || data.error || res.status}).`, 'GOOGLE_EXCHANGE', res.status);
  return data; // { access_token, expires_in, refresh_token, scope, id_token, token_type }
}

/**
 * Token de acceso nuevo a partir del de refresco. Si Google lo revocó (la
 * cuenta quitó el acceso, cambió la contraseña o la app está en modo de
 * prueba y pasaron 7 días) → GoogleError code 'GOOGLE_REVOKED'.
 */
async function refreshAccessToken(refreshToken) {
  const c = config();
  const { res, data } = await postForm(c.tokenUrl, {
    client_id: c.clientId,
    client_secret: c.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  if (!res.ok) {
    if (data.error === 'invalid_grant' || res.status === 400 || res.status === 401) {
      throw new GoogleError('Google retiró el permiso de envío de esta cuenta: vuelve a conectarla en Configuración → Correo.', 'GOOGLE_REVOKED', res.status);
    }
    throw new GoogleError(`Google no renovó el acceso (${data.error || res.status}).`, 'GOOGLE_REFRESH', res.status);
  }
  return data; // { access_token, expires_in, scope }
}

/** Revoca un token (al desconectar). Sin errores: si ya no valía, no importa. */
async function revokeToken(token) {
  if (!token) return;
  try {
    await postForm(config().revokeUrl, { token }, 8000);
  } catch {
    // mejor esfuerzo
  }
}

/**
 * Correo de la cuenta según el id_token. Viene directo de Google por HTTPS en
 * la respuesta del intercambio, así que no hace falta verificar su firma
 * (OpenID Connect Core §3.1.3.7); igual se comprueban emisor y destinatario.
 */
function emailFromIdToken(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8'));
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(config().clientId)) return null;
    if (payload.iss && !['https://accounts.google.com', 'accounts.google.com'].includes(payload.iss) && !process.env.GOOGLE_TOKEN_URL) return null;
    return payload.email && payload.email_verified !== false ? payload.email : null;
  } catch {
    return null;
  }
}

/** Envía un mensaje MIME ya armado con la Gmail API (users.messages.send). */
async function sendRawMessage(accessToken, raw) {
  let res;
  try {
    res = await fetch(`${config().gmailApiUrl}/gmail/v1/users/me/messages/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: b64url(raw) }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    throw new GoogleError(`No se pudo contactar a Gmail (${err.cause?.code || err.message}).`, 'GOOGLE_UNREACHABLE');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new GoogleError('El acceso a Gmail venció.', 'GOOGLE_UNAUTHORIZED', 401);
  if (!res.ok) {
    const reason = data.error?.message || res.status;
    throw new GoogleError(
      res.status === 403 ? `Gmail no permitió el envío (${reason}). Revisa que se haya concedido el permiso de enviar correos.` : `Gmail rechazó el envío (${reason}).`,
      'GOOGLE_SEND',
      res.status
    );
  }
  return data; // { id, threadId, labelIds }
}

module.exports = { SCOPES, GMAIL_SEND, config, isConfigured, pkcePair, buildAuthUrl, exchangeCode, refreshAccessToken, revokeToken, emailFromIdToken, sendRawMessage, GoogleError };
