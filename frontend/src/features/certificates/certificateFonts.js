import { useEffect } from 'react';
import { axiosClient } from '../../api/axiosClient';

/**
 * Fuentes del certificado en el editor. La lista (con sus métricas) viene del
 * servidor, la misma que usa el PDF (backend/src/services/pdf/certificateFonts.js):
 *   - las fuentes con archivo se descargan de /certificate-fonts: el MISMO archivo
 *     que se incrusta en el PDF;
 *   - Helvetica, Times y Courier usan sus equivalentes instalados en el equipo.
 * ascent-override y descent-override fijan dónde cae la línea base, igual en
 * Windows, Mac y en el PDF.
 */
const pct = (n) => `${Math.round(n * 10000) / 100}%`;
export const cssFamily = (font) => `"MoDoCert-${font?.key || 'helvetica'}", ${font?.fallback || 'sans-serif'}`;

function faceCss(font, weight) {
  const bold = weight === 700;
  const file = font.files ? (bold ? font.files.bold : font.files.regular) : null;
  const src = file
    ? `url("${axiosClient.defaults.baseURL}/certificate-fonts/${file}") format("truetype")`
    : font.local.map((name) => `local("${name}${bold ? ' Bold' : ''}")`).concat(font.local.map((name) => `local("${name}")`)).join(', ');
  if (bold && !font.has_bold) return '';
  return `@font-face { font-family: "MoDoCert-${font.key}"; font-weight: ${weight}; font-display: block; src: ${src};
    ascent-override: ${pct(bold ? font.bold_ascent : font.ascent)}; descent-override: ${pct(bold ? font.bold_descent : font.descent)}; line-gap-override: 0%; }`;
}

/** Inserta las @font-face de la lista una sola vez por página. */
export function useCertificateFonts(fonts) {
  useEffect(() => {
    if (!fonts?.length) return;
    const id = 'modo-certificate-fonts';
    let style = document.getElementById(id);
    if (!style) {
      style = document.createElement('style');
      style.id = id;
      document.head.appendChild(style);
    }
    style.textContent = fonts.flatMap((f) => [faceCss(f, 400), faceCss(f, 700)]).join('\n');
  }, [fonts]);
}
