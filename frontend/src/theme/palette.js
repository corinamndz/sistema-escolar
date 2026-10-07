/**
 * Motor de paleta del colegio. A partir de DOS colores base calcula todas las
 * variables CSS de la interfaz, garantizando contraste legible (WCAG):
 *
 *   menuColor    color base del menú lateral → degradado automático
 *   accentColor  acento: botones principales, encabezados de tabla, bordes
 *                activos, enlaces y elementos interactivos
 *
 * Preferencias opcionales: estilo del degradado, acento secundario y estilo de
 * los encabezados de tabla. Funciones puras (sin DOM): se usan en el
 * ThemeProvider y en la vista previa de Configuración.
 */

export const DEFAULT_THEME = {
  menuColor: '#1E293B',
  accentColor: '#2563EB',
  menuGradient: 'deep', // deep | analogous | solid
  accentSecondaryColor: null, // null = automático
  tableHeaderStyle: 'subtle', // subtle | solid | neutral
};

const HEX = /^#[0-9A-Fa-f]{6}$/;
export const isHex = (v) => typeof v === 'string' && HEX.test(v);

// ---------------------------------------------------------------------------
// Conversión de color
// ---------------------------------------------------------------------------

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

const toHex = (rgb) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

function rgbToHsl([r, g, b]) {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return [h * 60, s * 100, l * 100];
}

function hslToRgb([h, s, l]) {
  const S = s / 100;
  const L = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/** Ajusta tono, saturación y luminosidad (en puntos). */
export function adjust(hex, { h = 0, s = 0, l = 0 } = {}) {
  const [H, S, L] = rgbToHsl(hexToRgb(hex));
  return toHex(hslToRgb([(H + h + 360) % 360, clamp(S + s, 0, 100), clamp(L + l, 0, 100)]));
}

/** Mezcla dos colores (t = 0 → a, 1 → b). */
export function mix(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return toHex(A.map((v, i) => v + (B[i] - v) * t));
}

// ---------------------------------------------------------------------------
// Contraste (WCAG 2.1)
// ---------------------------------------------------------------------------

export function luminance(hex) {
  return hexToRgb(hex)
    .map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    })
    .reduce((acc, c, i) => acc + c * [0.2126, 0.7152, 0.0722][i], 0);
}

export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

const WHITE = '#FFFFFF';
const INK = '#0F172A';

/** Texto legible sobre un fondo: blanco u oscuro, el de mayor contraste. */
export const readableOn = (bg) => (contrast(bg, WHITE) >= contrast(bg, INK) ? WHITE : INK);

/**
 * Variante del color que se lee bien como TEXTO sobre fondo blanco (enlaces,
 * etiquetas): se oscurece hasta llegar a contraste 4.5:1 (AA). Así un acento
 * claro (amarillo, celeste) no deja los enlaces ilegibles.
 */
export function textSafe(hex, on = WHITE, target = 4.5) {
  let c = hex;
  for (let i = 0; i < 40 && contrast(c, on) < target; i += 1) c = adjust(c, { l: -2.5 });
  return c;
}

// ---------------------------------------------------------------------------
// Paleta completa
// ---------------------------------------------------------------------------

/**
 * Degradado del menú a partir del color base:
 *   deep       mismo tono, más profundo y algo más saturado abajo
 *   analogous  hacia un tono vecino (rueda de color ±28°): armónico y vivo
 *   solid      sin degradado
 * El extremo superior se aclara un poco si el color es muy oscuro, para que el
 * degradado se note incluso en menús casi negros.
 */
export function menuGradient(base, style = 'deep') {
  const [, , L] = rgbToHsl(hexToRgb(base));
  if (style === 'solid') return { start: base, end: base };
  const start = L < 22 ? adjust(base, { l: 6 }) : base;
  if (style === 'analogous') {
    // Colores cálidos giran hacia el rojo y fríos hacia el violeta: siempre "hacia la sombra".
    const [H] = rgbToHsl(hexToRgb(base));
    const shift = H >= 40 && H < 200 ? 28 : -28;
    return { start, end: adjust(base, { h: shift, s: 6, l: L > 55 ? -22 : -12 }) };
  }
  return { start, end: adjust(base, { s: 8, l: L > 55 ? -24 : -14 }) };
}

/**
 * Todas las variables CSS del tema. Devuelve { vars, info } — `info` trae los
 * colores calculados y sus contrastes para mostrarlos en Configuración.
 */
export function buildTheme(input = {}) {
  const t = { ...DEFAULT_THEME, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
  const menu = isHex(t.menuColor) ? t.menuColor.toUpperCase() : DEFAULT_THEME.menuColor;
  const accent = isHex(t.accentColor) ? t.accentColor.toUpperCase() : DEFAULT_THEME.accentColor;

  const grad = menuGradient(menu, t.menuGradient);
  const menuMid = mix(grad.start, grad.end, 0.5);
  const menuFg = readableOn(menuMid);
  const onAccent = readableOn(accent);
  const accentText = textSafe(accent);
  const accentHover = adjust(accent, { l: luminance(accent) > 0.5 ? -10 : -7 });
  // Acento secundario: el elegido o, en automático, el complementario dividido (+150°) suavizado.
  const accent2 = isHex(t.accentSecondaryColor) ? t.accentSecondaryColor.toUpperCase() : adjust(accent, { h: 150, s: -10 });

  const header =
    t.tableHeaderStyle === 'solid'
      ? { bg: accent, fg: onAccent, border: accentHover }
      : t.tableHeaderStyle === 'neutral'
        ? { bg: '#F8FAFC', fg: '#64748B', border: '#E5E9F0' }
        : { bg: mix(accent, WHITE, 0.9), fg: textSafe(accent, mix(accent, WHITE, 0.9)), border: mix(accent, WHITE, 0.75) };

  const rgb = (hex) => hexToRgb(hex).join(', ');
  const vars = {
    // Acento
    '--color-primary': accent,
    '--color-primary-rgb': rgb(accent),
    '--color-on-primary': onAccent,
    '--color-primary-text': accentText,
    '--color-primary-hover': accentHover,
    '--color-accent-2': accent2,
    '--color-on-accent-2': readableOn(accent2),
    '--color-border-active': accent,
    // Menú lateral
    '--color-secondary': menu,
    '--sidebar-bg-start': grad.start,
    '--sidebar-bg-end': grad.end,
    '--sidebar-fg-rgb': rgb(menuFg),
    // Encabezados de tabla
    '--table-head-bg': header.bg,
    '--table-head-fg': header.fg,
    '--table-head-border': header.border,
  };

  const info = {
    menuStart: grad.start,
    menuEnd: grad.end,
    menuFg,
    accent,
    onAccent,
    accentText,
    accentHover,
    accent2,
    header,
    contrasts: {
      menu: Math.min(contrast(menuFg, grad.start), contrast(menuFg, grad.end)),
      button: contrast(onAccent, accent),
      link: contrast(accentText, WHITE),
      header: contrast(header.fg, header.bg),
    },
  };
  return { vars, info };
}

/** Combinaciones listas para elegir con un clic. */
export const PRESETS = [
  { name: 'Azul institucional', menuColor: '#1E293B', accentColor: '#2563EB' },
  { name: 'Verde bosque', menuColor: '#14532D', accentColor: '#16A34A' },
  { name: 'Vinotinto', menuColor: '#4C0519', accentColor: '#BE123C' },
  { name: 'Morado', menuColor: '#2E1065', accentColor: '#7C3AED' },
  { name: 'Océano', menuColor: '#0C4A6E', accentColor: '#0891B2' },
  { name: 'Atardecer', menuColor: '#431407', accentColor: '#EA580C' },
  { name: 'Grafito', menuColor: '#18181B', accentColor: '#52525B' },
];

/** Muestras para el color del menú: tonos oscuros/profundos, que dan buen contraste con texto claro. */
export const MENU_SWATCHES = [
  { name: 'Pizarra', color: '#1E293B' },
  { name: 'Azul marino', color: '#1E3A8A' },
  { name: 'Océano', color: '#0C4A6E' },
  { name: 'Verde azulado', color: '#134E4A' },
  { name: 'Verde bosque', color: '#14532D' },
  { name: 'Vinotinto', color: '#4C0519' },
  { name: 'Morado', color: '#2E1065' },
  { name: 'Café', color: '#431407' },
  { name: 'Grafito', color: '#18181B' },
];

/** Muestras para el color de acento: tonos vivos, legibles en botones. */
export const ACCENT_SWATCHES = [
  { name: 'Azul', color: '#2563EB' },
  { name: 'Celeste', color: '#0891B2' },
  { name: 'Verde azulado', color: '#0D9488' },
  { name: 'Verde', color: '#16A34A' },
  { name: 'Ámbar', color: '#D97706' },
  { name: 'Naranja', color: '#EA580C' },
  { name: 'Rojo', color: '#DC2626' },
  { name: 'Carmesí', color: '#BE123C' },
  { name: 'Rosa', color: '#DB2777' },
  { name: 'Morado', color: '#7C3AED' },
  { name: 'Gris', color: '#52525B' },
];

/**
 * Tema a partir de SOLO los dos colores que elige el colegio. Todo lo demás
 * (degradado del menú, hover, texto legible, acento secundario, encabezados
 * de tabla) se calcula en automático con los valores por defecto.
 */
export const themeFromColors = (menuColor, accentColor) => buildTheme({ menuColor, accentColor });
