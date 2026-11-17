const { PDFDocument, rgb } = require('pdf-lib');

/**
 * Plantillas estándar del certificado, para los colegios sin diseño propio: fondos
 * vectoriales (A4 horizontal) con el color principal del colegio, y una distribución
 * sugerida de textos y variables que encaja en cada fondo. Al aplicarla, el fondo
 * queda como el de cualquier otro diseño y los textos se editan normalmente.
 */

const W = 841.89;
const H = 595.28;
const GOLD = '#b08d57';
const INK = '#1f2937';
const GRAY = '#6b7280';

const validHex = (c, fb) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c.toLowerCase() : fb);
const toRgb = (hex) => rgb(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255));
/** Mezcla con blanco (amount 0 = color, 1 = blanco), para tonos suaves del color del colegio. */
const tint = (hex, amount) => `#${[1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) + (255 - parseInt(hex.slice(i, i + 2), 16)) * amount).toString(16).padStart(2, '0')).join('')}`;
/** Oscurece (amount 0 = color, 1 = negro). */
const shade = (hex, amount) => `#${[1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - amount)).toString(16).padStart(2, '0')).join('')}`;
/** y medida desde arriba, en fracción de la hoja → coordenada PDF. */
const fromTop = (f) => H * (1 - f);

/** Dos líneas de firma, a la altura de los rótulos de la distribución sugerida. */
function signatureLines(page, color, { y = 0.835, xs = [0.28, 0.72], half = 0.11 } = {}) {
  for (const x of xs) page.drawLine({ start: { x: W * (x - half), y: fromTop(y) }, end: { x: W * (x + half), y: fromTop(y) }, thickness: 0.8, color: toRgb(color) });
}

const DESIGNS = {
  classic: {
    label: 'Marco clásico elegante',
    description: 'Fondo marfil, marco dorado doble con adornos en las esquinas y sello.',
    draw(page, brand) {
      page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: toRgb('#fbf7ee') });
      page.drawRectangle({ x: 18, y: 18, width: W - 36, height: H - 36, borderColor: toRgb(GOLD), borderWidth: 3 });
      page.drawRectangle({ x: 27, y: 27, width: W - 54, height: H - 54, borderColor: toRgb(GOLD), borderWidth: 0.8 });
      page.drawRectangle({ x: 33, y: 33, width: W - 66, height: H - 66, borderColor: toRgb(shade(brand, 0.1)), borderWidth: 0.5 });
      // Esquinas: rombo y dos trazos.
      for (const [cx, cy, sx, sy] of [[27, 27, 1, 1], [W - 27, 27, -1, 1], [27, H - 27, 1, -1], [W - 27, H - 27, -1, -1]]) {
        page.drawSvgPath('M 0 -9 L 9 0 L 0 9 L -9 0 Z', { x: cx, y: cy, color: toRgb(GOLD) });
        page.drawLine({ start: { x: cx + sx * 14, y: cy + sy * 6 }, end: { x: cx + sx * 60, y: cy + sy * 6 }, thickness: 0.8, color: toRgb(GOLD) });
        page.drawLine({ start: { x: cx + sx * 6, y: cy + sy * 14 }, end: { x: cx + sx * 6, y: cy + sy * 60 }, thickness: 0.8, color: toRgb(GOLD) });
      }
      // Filete bajo el título.
      page.drawLine({ start: { x: W * 0.36, y: fromTop(0.275) }, end: { x: W * 0.64, y: fromTop(0.275) }, thickness: 0.8, color: toRgb(GOLD) });
      page.drawSvgPath('M 0 -4 L 4 0 L 0 4 L -4 0 Z', { x: W / 2, y: fromTop(0.275), color: toRgb(GOLD) });
      // Sello.
      page.drawCircle({ x: W / 2, y: fromTop(0.84), size: 36, borderColor: toRgb(GOLD), borderWidth: 1.6 });
      page.drawCircle({ x: W / 2, y: fromTop(0.84), size: 30, borderColor: toRgb(GOLD), borderWidth: 0.6, borderDashArray: [2, 2] });
      signatureLines(page, GOLD, { xs: [0.25, 0.75] });
    },
    fonts: { title: 'cinzel', name: 'greatvibes', body: 'gelasio' },
    colors: (brand) => ({ title: shade(GOLD, 0.25), name: shade(brand, 0.25), body: INK }),
    layout: { cx: 0.5, sigXs: [0.25, 0.75], titleY: 0.2, nameSize: 44 },
  },
  modern: {
    label: 'Moderno minimalista',
    description: 'Fondo blanco, una franja lateral con el color del colegio y mucho aire.',
    draw(page, brand) {
      page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: toRgb('#ffffff') });
      page.drawRectangle({ x: 0, y: 0, width: W * 0.075, height: H, color: toRgb(brand) });
      page.drawRectangle({ x: W * 0.075, y: 0, width: 5, height: H, color: toRgb(tint(brand, 0.55)) });
      // Puntos en la esquina superior derecha.
      for (let r = 0; r < 4; r += 1) for (let c = 0; c < 7; c += 1) page.drawCircle({ x: W - 46 - c * 12, y: H - 40 - r * 12, size: 1.8, color: toRgb(tint(brand, 0.45)) });
      page.drawRectangle({ x: W * 0.47, y: fromTop(0.285), width: W * 0.13, height: 3, color: toRgb(brand) });
      page.drawLine({ start: { x: W * 0.13, y: 34 }, end: { x: W - 40, y: 34 }, thickness: 0.6, color: toRgb(tint(brand, 0.5)) });
      signatureLines(page, '#9ca3af', { xs: [0.33, 0.75] });
    },
    fonts: { title: 'montserrat', name: 'playfair', body: 'montserrat' },
    colors: (brand) => ({ title: brand, name: INK, body: GRAY }),
    layout: { cx: 0.535, sigXs: [0.33, 0.75], titleY: 0.2, nameSize: 34 },
  },
  institutional: {
    label: 'Institucional ejecutivo',
    description: 'Bandas superior e inferior con el color del colegio, marco fino y marca de agua.',
    draw(page, brand) {
      page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: toRgb('#ffffff') });
      page.drawRectangle({ x: 0, y: H - H * 0.085, width: W, height: H * 0.085, color: toRgb(shade(brand, 0.2)) });
      page.drawRectangle({ x: 0, y: H - H * 0.085 - 4, width: W, height: 4, color: toRgb(GOLD) });
      page.drawRectangle({ x: 0, y: 0, width: W, height: H * 0.04, color: toRgb(shade(brand, 0.2)) });
      page.drawRectangle({ x: 22, y: H * 0.04 + 14, width: W - 44, height: H - H * 0.085 - 4 - H * 0.04 - 28, borderColor: toRgb('#cbd5e1'), borderWidth: 0.8 });
      page.drawCircle({ x: W / 2, y: H * 0.47, size: 150, color: toRgb(brand), opacity: 0.05 });
      page.drawCircle({ x: W / 2, y: H * 0.47, size: 150, borderColor: toRgb(brand), borderWidth: 1, borderOpacity: 0.12 });
      signatureLines(page, '#6b7280', { xs: [0.28, 0.72] });
    },
    fonts: { title: 'playfair', name: 'gelasio', body: 'arimo' },
    colors: (brand) => ({ title: shade(brand, 0.2), name: INK, body: '#374151' }),
    layout: { cx: 0.5, sigXs: [0.28, 0.72], titleY: 0.215, nameSize: 32 },
  },
  geometric: {
    label: 'Borde geométrico',
    description: 'Marco de triángulos con el color del colegio y dorado, y panel central blanco.',
    draw(page, brand) {
      page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: toRgb(tint(brand, 0.9)) });
      const size = 22;
      const tri = (x, y, up, color) => page.drawSvgPath(up ? `M 0 ${size} L ${size / 2} 0 L ${size} ${size} Z` : `M 0 0 L ${size} 0 L ${size / 2} ${size} Z`, { x, y: y + size, color: toRgb(color) });
      for (let i = 0, x = 0; x < W; i += 1, x += size / 2) {
        tri(x - size / 4, H - size, i % 2 === 0, i % 4 < 2 ? brand : GOLD);
        tri(x - size / 4, 0, i % 2 === 1, i % 4 < 2 ? brand : GOLD);
      }
      for (let i = 0, y = size; y < H - size; i += 1, y += size / 2) {
        const c = i % 4 < 2 ? brand : GOLD;
        page.drawSvgPath(i % 2 === 0 ? `M 0 0 L ${size} ${size / 2} L 0 ${size} Z` : `M ${size} 0 L 0 ${size / 2} L ${size} ${size} Z`, { x: 0, y: y + size, color: toRgb(c) });
        page.drawSvgPath(i % 2 === 0 ? `M ${size} 0 L 0 ${size / 2} L ${size} ${size} Z` : `M 0 0 L ${size} ${size / 2} L 0 ${size} Z`, { x: W - size, y: y + size, color: toRgb(c) });
      }
      page.drawRectangle({ x: 42, y: 42, width: W - 84, height: H - 84, color: toRgb('#ffffff'), borderColor: toRgb(brand), borderWidth: 1.2 });
      page.drawRectangle({ x: 48, y: 48, width: W - 96, height: H - 96, borderColor: toRgb(GOLD), borderWidth: 0.6 });
      signatureLines(page, '#9ca3af', { xs: [0.28, 0.72] });
    },
    fonts: { title: 'montserrat', name: 'playfair', body: 'arimo' },
    colors: (brand) => ({ title: shade(brand, 0.15), name: INK, body: '#374151' }),
    layout: { cx: 0.5, sigXs: [0.28, 0.72], titleY: 0.2, nameSize: 34 },
  },

  // ---- Clásicos ----
  laurel: {
    category: 'clasico',
    label: 'Laureles y sello',
    description: 'Doble filete, esquinas con arcos y una corona de laurel alrededor del sello con el logo.',
    draw(page, brand) {
      const dark = shade(brand, 0.35);
      page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: toRgb('#fdfaf3') });
      page.drawRectangle({ x: 20, y: 20, width: W - 40, height: H - 40, borderColor: toRgb(dark), borderWidth: 2.4 });
      page.drawRectangle({ x: 29, y: 29, width: W - 58, height: H - 58, borderColor: toRgb(GOLD), borderWidth: 0.8 });
      // Esquinas: dos arcos concéntricos y un punto.
      for (const [cx, cy, sx, sy] of [[29, 29, 1, 1], [W - 29, 29, -1, 1], [29, H - 29, 1, -1], [W - 29, H - 29, -1, -1]]) {
        for (const r of [26, 34]) page.drawSvgPath(`M ${sx * r} 0 A ${r} ${r} 0 0 ${sx * sy > 0 ? 0 : 1} 0 ${-sy * r}`, { x: cx, y: cy, borderColor: toRgb(GOLD), borderWidth: 0.9 });
        page.drawCircle({ x: cx + sx * 12, y: cy + sy * 12, size: 2.6, color: toRgb(dark) });
      }
      // Adorno superior: tres rombos.
      for (const [dx, s] of [[-16, 3], [0, 5], [16, 3]]) page.drawSvgPath(`M 0 ${-s} L ${s} 0 L 0 ${s} L ${-s} 0 Z`, { x: W / 2 + dx, y: H - 52, color: toRgb(GOLD) });
      page.drawLine({ start: { x: W * 0.38, y: fromTop(0.275) }, end: { x: W * 0.62, y: fromTop(0.275) }, thickness: 0.7, color: toRgb(GOLD) });
      // Corona de laurel alrededor del sello (centro abajo).
      const sx = W / 2;
      const sy = fromTop(0.835);
      const R = 44;
      const leaf = (deg, side) => {
        const a = (deg * Math.PI) / 180;
        page.drawEllipse({ x: sx + R * Math.cos(a), y: sy + R * Math.sin(a), xScale: 7.5, yScale: 2.8, rotate: { type: 'degrees', angle: deg + 90 + side * 28 }, color: toRgb(shade(brand, 0.15)), opacity: 0.85 });
      };
      // Dos ramas que suben por los costados del sello y se abren arriba.
      for (let d = 255; d >= 125; d -= 16) leaf(d, 1);
      for (let d = -75; d <= 55; d += 16) leaf(d, -1);
      page.drawCircle({ x: sx, y: sy, size: 33, color: toRgb('#fffdf8'), borderColor: toRgb(GOLD), borderWidth: 1.6 });
      page.drawCircle({ x: sx, y: sy, size: 28, borderColor: toRgb(GOLD), borderWidth: 0.6, borderDashArray: [1.5, 2] });
      signatureLines(page, dark, { xs: [0.25, 0.75] });
    },
    fonts: { title: 'cinzel', name: 'greatvibes', body: 'gelasio' },
    colors: (brand) => ({ title: shade(brand, 0.35), name: shade(brand, 0.2), body: INK }),
    layout: { cx: 0.5, sigXs: [0.25, 0.75], titleY: 0.2, nameSize: 46, logo: { x: 0.5, y: 0.835, w: 0.07, h: 0.08 } },
  },
  diploma: {
    category: 'clasico',
    label: 'Diploma de honor',
    description: 'Banda ancha con guilloché dorado, como los títulos tradicionales, y rosetas en las esquinas.',
    draw(page, brand) {
      const band = shade(brand, 0.3);
      page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: toRgb(band) });
      page.drawRectangle({ x: 44, y: 44, width: W - 88, height: H - 88, color: toRgb('#fffdf6'), borderColor: toRgb(GOLD), borderWidth: 1.2 });
      page.drawRectangle({ x: 50, y: 50, width: W - 100, height: H - 100, borderColor: toRgb(GOLD), borderWidth: 0.5 });
      // Guilloché: dos ondas desfasadas a lo largo de la banda.
      const wave = (len, phase, amp = 7, wl = 26) => {
        const pts = [];
        for (let t = 0; t <= len; t += 3) pts.push([t, amp * Math.sin(((t / wl) * 2 + phase) * Math.PI)]);
        return pts;
      };
      const stroke = (pts, x, y, vertical) => {
        const d = pts.map(([t, v], i) => `${i ? 'L' : 'M'} ${(vertical ? v : t).toFixed(1)} ${(vertical ? t : v).toFixed(1)}`).join(' ');
        page.drawSvgPath(d, { x, y, borderColor: toRgb(GOLD), borderWidth: 0.55, borderOpacity: 0.9 });
      };
      for (const phase of [0, 0.5, 1]) {
        stroke(wave(W - 88, phase), 44, H - 22, false);
        stroke(wave(W - 88, phase), 44, 22, false);
        stroke(wave(H - 88, phase), 22, H - 44, true);
        stroke(wave(H - 88, phase), W - 22, H - 44, true);
      }
      // Rosetas en las esquinas.
      for (const [cx, cy] of [[22, 22], [W - 22, 22], [22, H - 22], [W - 22, H - 22]]) {
        page.drawCircle({ x: cx, y: cy, size: 17, color: toRgb(band), borderColor: toRgb(GOLD), borderWidth: 1 });
        for (let k = 0; k < 8; k += 1) {
          const a = (k * Math.PI) / 4;
          page.drawCircle({ x: cx + 7 * Math.cos(a), y: cy + 7 * Math.sin(a), size: 6, borderColor: toRgb(GOLD), borderWidth: 0.5 });
        }
      }
      page.drawLine({ start: { x: W * 0.4, y: fromTop(0.275) }, end: { x: W * 0.6, y: fromTop(0.275) }, thickness: 0.8, color: toRgb(GOLD) });
      signatureLines(page, band, { xs: [0.27, 0.73] });
    },
    fonts: { title: 'cinzel', name: 'playfair', body: 'gelasio' },
    colors: (brand) => ({ title: shade(brand, 0.3), name: INK, body: '#374151' }),
    layout: { cx: 0.5, sigXs: [0.27, 0.73], titleY: 0.2, nameSize: 36, bodyWidth: 0.62 },
  },

  // ---- Modernos ----
  accent: {
    category: 'moderno',
    label: 'Barra de acento',
    description: 'Barra superior con el color del colegio, círculos suaves y tipografía limpia.',
    draw(page, brand) {
      page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: toRgb('#ffffff') });
      page.drawCircle({ x: W - 20, y: H - 30, size: 150, color: toRgb(tint(brand, 0.93)) });
      page.drawCircle({ x: 40, y: 10, size: 110, color: toRgb(tint(brand, 0.95)) });
      page.drawRectangle({ x: 0, y: H - H * 0.055, width: W, height: H * 0.055, color: toRgb(brand) });
      page.drawRectangle({ x: 0, y: H - H * 0.055 - 3, width: W * 0.35, height: 3, color: toRgb(shade(brand, 0.3)) });
      page.drawRectangle({ x: W * 0.46, y: fromTop(0.27), width: W * 0.08, height: 3, color: toRgb(brand) });
      page.drawRectangle({ x: 0, y: 0, width: W, height: 6, color: toRgb(tint(brand, 0.4)) });
      signatureLines(page, '#94a3b8', { xs: [0.28, 0.72] });
    },
    fonts: { title: 'montserrat', name: 'playfair', body: 'montserrat' },
    colors: (brand) => ({ title: INK, name: shade(brand, 0.1), body: GRAY }),
    layout: { cx: 0.5, sigXs: [0.28, 0.72], titleY: 0.205, nameSize: 36, logo: { x: 0.5, y: 0.115, w: 0.12, h: 0.075 } },
  },
  diagonal: {
    category: 'moderno',
    label: 'Bloques diagonales',
    description: 'Esquinas con bloques en diagonal en tonos del color del colegio y un filete dorado.',
    draw(page, brand) {
      page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: toRgb('#ffffff') });
      const tri = (pts, color, opacity = 1) => page.drawSvgPath(`M ${pts.map((p) => p.join(' ')).join(' L ')} Z`, { x: 0, y: H, color: toRgb(color), opacity });
      // Arriba a la derecha (coordenadas SVG: y hacia abajo desde el borde superior).
      tri([[W * 0.7, 0], [W, 0], [W, H * 0.36]], tint(brand, 0.75));
      tri([[W * 0.78, 0], [W, 0], [W, H * 0.3]], brand);
      tri([[W * 0.9, 0], [W, 0], [W, H * 0.14]], shade(brand, 0.35));
      // Abajo a la izquierda.
      tri([[0, H * 0.64], [0, H], [W * 0.3, H]], tint(brand, 0.75));
      tri([[0, H * 0.7], [0, H], [W * 0.22, H]], brand);
      tri([[0, H * 0.86], [0, H], [W * 0.1, H]], shade(brand, 0.35));
      page.drawLine({ start: { x: W * 0.06, y: H - 26 }, end: { x: W * 0.62, y: H - 26 }, thickness: 0.8, color: toRgb(GOLD) });
      page.drawLine({ start: { x: W * 0.38, y: 26 }, end: { x: W * 0.94, y: 26 }, thickness: 0.8, color: toRgb(GOLD) });
      page.drawRectangle({ x: W * 0.47, y: fromTop(0.275), width: W * 0.06, height: 2.5, color: toRgb(GOLD) });
      signatureLines(page, '#94a3b8', { xs: [0.3, 0.7] });
    },
    fonts: { title: 'montserrat', name: 'playfair', body: 'arimo' },
    colors: (brand) => ({ title: shade(brand, 0.25), name: INK, body: '#4b5563' }),
    layout: { cx: 0.5, sigXs: [0.3, 0.7], titleY: 0.2, nameSize: 34, titleWidth: 0.6, bodyWidth: 0.6 },
  },

  // ---- Escolares (preescolar y primaria) ----
  confetti: {
    category: 'escolar',
    label: 'Estrellas y confeti',
    description: 'Marco redondeado, estrellas y confeti de colores. Cálido, para preescolar y primaria.',
    draw(page, brand) {
      page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: toRgb('#fffaf0') });
      const rounded = (x, y, w, h, r) => `M ${x + r} ${y} H ${x + w - r} A ${r} ${r} 0 0 1 ${x + w} ${y + r} V ${y + h - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${y + h - r} V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`;
      page.drawSvgPath(rounded(22, 22, W - 44, H - 44, 28), { x: 0, y: H, borderColor: toRgb(brand), borderWidth: 4 });
      page.drawSvgPath(rounded(32, 32, W - 64, H - 64, 20), { x: 0, y: H, borderColor: toRgb('#f59e0b'), borderWidth: 1.4, borderDashArray: [2, 5], borderLineCap: 1 });
      const palette = [brand, '#f59e0b', '#ef4444', '#10b981', '#8b5cf6', '#ec4899', '#0ea5e9'];
      // Confeti en el margen (posiciones fijas, pseudoaleatorias).
      let seed = 7;
      const rnd = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };
      for (let i = 0; i < 70; i += 1) {
        const zone = i % 4;
        const x = zone < 2 ? 40 + rnd() * (W - 80) : zone === 2 ? 40 + rnd() * 60 : W - 100 + rnd() * 60;
        const y = zone === 0 ? H - 40 - rnd() * 38 : zone === 1 ? 40 + rnd() * 30 : 60 + rnd() * (H - 120);
        // Abajo, sin pisar las firmas: solo en los extremos y el centro.
        if (zone === 1 && ((x > W * 0.14 && x < W * 0.42) || (x > W * 0.58 && x < W * 0.86))) continue;
        const color = toRgb(palette[i % palette.length]);
        if (i % 3 === 0) page.drawCircle({ x, y, size: 2.2 + rnd() * 2, color });
        else page.drawRectangle({ x, y, width: 7, height: 3, color, rotate: { type: 'degrees', angle: rnd() * 180 } });
      }
      const star = (cx, cy, r, color, rot = 0) => {
        const pts = [];
        for (let k = 0; k < 10; k += 1) {
          const a = ((k * 36 - 90 + rot) * Math.PI) / 180;
          const rr = k % 2 ? r * 0.45 : r;
          pts.push(`${(rr * Math.cos(a)).toFixed(1)} ${(rr * Math.sin(a)).toFixed(1)}`);
        }
        page.drawSvgPath(`M ${pts.join(' L ')} Z`, { x: cx, y: cy, color: toRgb(color) });
      };
      star(70, H - 72, 22, '#fbbf24', -8);
      star(108, H - 58, 10, brand, 12);
      star(W - 72, H - 76, 20, brand, 10);
      star(W - 112, H - 56, 11, '#fbbf24', -6);
      star(W / 2, fromTop(0.835), 16, '#fbbf24');
      signatureLines(page, brand, { xs: [0.28, 0.72] });
    },
    fonts: { title: 'montserrat', name: 'playfair', body: 'montserrat' },
    colors: (brand) => ({ title: brand, name: shade(brand, 0.25), body: '#374151' }),
    layout: { cx: 0.5, sigXs: [0.28, 0.72], titleY: 0.215, nameSize: 38, logo: { x: 0.5, y: 0.12, w: 0.12, h: 0.075 } },
  },
  rainbow: {
    category: 'escolar',
    label: 'Arcoíris y nubes',
    description: 'Cielo claro, arcoíris en las esquinas y nubes. Alegre, para preescolar.',
    draw(page, brand) {
      page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: toRgb('#f0f9ff') });
      page.drawRectangle({ x: 16, y: 16, width: W - 32, height: H - 32, borderColor: toRgb(brand), borderWidth: 3 });
      const bands = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#8b5cf6'];
      // Arcoíris: cuartos de círculo concéntricos en las esquinas de abajo.
      for (const [cx, sx] of [[0, 1], [W, -1]]) {
        bands.forEach((c, i) => {
          const r = 118 - i * 11;
          page.drawSvgPath(`M 0 0 L ${sx * r} 0 A ${r} ${r} 0 0 ${sx > 0 ? 0 : 1} 0 ${-r} Z`, { x: cx, y: 0, color: toRgb(c) });
        });
        page.drawSvgPath(`M 0 0 L ${sx * 52} 0 A 52 52 0 0 ${sx > 0 ? 0 : 1} 0 -52 Z`, { x: cx, y: 0, color: toRgb('#f0f9ff') });
      }
      // Nubes arriba.
      const cloud = (x, y, s) => {
        for (const [dx, dy, r] of [[0, 0, 16], [18, 6, 20], [38, 0, 15], [19, -6, 14]]) page.drawCircle({ x: x + dx * s, y: y + dy * s, size: r * s, color: toRgb('#ffffff') });
      };
      cloud(60, H - 70, 1.1);
      cloud(W - 120, H - 64, 1);
      cloud(W * 0.3, H - 44, 0.6);
      // Sol pequeño.
      page.drawCircle({ x: W - 60, y: H - 118, size: 14, color: toRgb('#fde047') });
      page.drawRectangle({ x: W * 0.44, y: fromTop(0.28), width: W * 0.12, height: 4, color: toRgb('#facc15') });
      signatureLines(page, shade(brand, 0.2), { xs: [0.3, 0.7] });
    },
    fonts: { title: 'montserrat', name: 'playfair', body: 'montserrat' },
    colors: (brand) => ({ title: shade(brand, 0.1), name: shade(brand, 0.3), body: '#334155' }),
    layout: { cx: 0.5, sigXs: [0.3, 0.7], titleY: 0.21, nameSize: 38, titleWidth: 0.62, logo: { x: 0.5, y: 0.11, w: 0.12, h: 0.075 } },
  },
};
// Categorías del catálogo (la galería las usa como filtro).
const CATEGORIES = { clasico: 'Clásicos', moderno: 'Modernos', escolar: 'Escolares' };
Object.assign(DESIGNS.classic, { category: 'clasico' });
Object.assign(DESIGNS.institutional, { category: 'clasico' });
Object.assign(DESIGNS.modern, { category: 'moderno' });
Object.assign(DESIGNS.geometric, { category: 'moderno' });
// Orden de la galería: por categoría (clásicos, modernos, escolares).
const STANDARD_KEYS = Object.keys(CATEGORIES).flatMap((cat) => Object.keys(DESIGNS).filter((k) => DESIGNS[k].category === cat));

/** Fondo de la plantilla `key` con el color del colegio. → Buffer (PDF de una página). */
async function standardBackground(key, brandColor) {
  const design = DESIGNS[key];
  if (!design) throw new Error(`Plantilla desconocida: ${key}`);
  const doc = await PDFDocument.create();
  doc.setTitle(`Plantilla estándar · ${design.label}`);
  const page = doc.addPage([W, H]);
  design.draw(page, validHex(brandColor, '#1e3a8a'));
  return Buffer.from(await doc.save());
}

/** Distribución sugerida de textos y variables para esa plantilla. */
function standardFields(key, brandColor) {
  const d = DESIGNS[key];
  const brand = validHex(brandColor, '#1e3a8a');
  const c = d.colors(brand);
  const { cx, sigXs, titleY, nameSize, titleWidth = 0.8, bodyWidth = 0.66, logo } = d.layout;
  const text = (id, content, extra) => ({ type: 'custom_text', id, content, x: cx, width: bodyWidth, align: 'center', bold: false, color: c.body, font: d.fonts.body, fontSize: 13, ...extra });
  return [
    // Logo del colegio (si la plantilla lo prevé): si el colegio no tiene, simplemente no se dibuja.
    ...(logo ? [{ type: 'logo', id: 'logo', x: logo.x, y: logo.y, width: logo.w, height: logo.h, align: 'center' }] : []),
    text('titulo', 'CERTIFICADO DE PROMOCIÓN', { y: titleY, width: titleWidth, fontSize: 30, bold: d.fonts.title !== 'greatvibes', font: d.fonts.title, color: c.title }),
    text('otorga', 'La Dirección del plantel certifica que', { y: 0.34, fontSize: 14 }),
    { key: 'student_name', x: cx, y: 0.435, fontSize: nameSize, color: c.name, align: 'center', font: d.fonts.name, bold: d.fonts.name !== 'greatvibes' },
    text('cuerpo', 'titular de la cédula {{student_id}}, cursó y aprobó el año escolar {{school_year}} y es promovido(a) a {{target_grade}}.', { y: 0.55 }),
    text('fecha', 'Expedido el {{issue_date}}.', { y: 0.65, fontSize: 11, color: GRAY }),
    text('firma1', 'Director(a)', { x: sigXs[0], y: 0.865, width: 0.24, fontSize: 11, bold: true, color: INK }),
    text('firma2', 'Docente guía', { x: sigXs[1], y: 0.865, width: 0.24, fontSize: 11, bold: true, color: INK }),
  ];
}

const standardList = () => STANDARD_KEYS.map((key) => ({ key, label: DESIGNS[key].label, description: DESIGNS[key].description, category: DESIGNS[key].category, category_label: CATEGORIES[DESIGNS[key].category] }));

module.exports = { STANDARD_KEYS, CATEGORIES, standardBackground, standardFields, standardList };
