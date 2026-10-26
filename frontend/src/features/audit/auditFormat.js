/** Utilidades de presentación de la bitácora (tabla y panel de detalle). */

/**
 * Tono visual según el tipo de acción. No se usa el color principal del colegio:
 * puede ser rojo (ej. carmesí) y una edición se confundiría con un error.
 */
export function actionTone(action = '') {
  if (/FALLIDO|ELIMINAR|ANULAR|RETIRAR|DESASOCIAR|QUITAR/.test(action)) return 'danger';
  if (/^(CREAR|REGISTRAR|INSCRIBIR|AGREGAR|ASOCIAR|CONFIRMAR|PROMOVER|GENERAR|IMPORTAR)/.test(action)) return 'success';
  if (/SESION/.test(action)) return 'session';
  return 'update';
}

export const TONE_ICON = { danger: 'alertTriangle', success: 'checkCircle', session: 'user', update: 'pencil' };

export const dateTime = (v) =>
  new Date(v).toLocaleString('es', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const longDateTime = (v) =>
  new Date(v).toLocaleString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** "Chrome · Windows" a partir del user-agent (aproximado, solo para leer). */
export function describeAgent(ua) {
  if (!ua) return null;
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : null;
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : null;
  return [browser, os].filter(Boolean).join(' · ') || ua.slice(0, 60);
}

const LOCAL_IPS = new Set(['::1', '127.0.0.1']);
export const ipLabel = (ip) => (!ip ? '—' : LOCAL_IPS.has(ip) ? `${ip} (este equipo)` : ip);

/** Fecha local 'YYYY-MM-DD' de hace `days` días. */
export function daysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Valor de un dato enviado para mostrarlo en una lista clave → valor. */
export function displayValue(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (Array.isArray(v)) return v.every((x) => typeof x !== 'object') ? v.join(', ') : `${v.length} elemento${v.length === 1 ? '' : 's'}`;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
