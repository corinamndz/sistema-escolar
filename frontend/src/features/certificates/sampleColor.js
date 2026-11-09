const toHex = (n) => Math.round(n).toString(16).padStart(2, '0');

/**
 * Lector de colores del fondo del certificado, para los navegadores sin EyeDropper.
 * Admite el lienzo del PDF o la imagen del fondo. Devuelve (fx, fy) => '#rrggbb', con
 * fx, fy como fracciones de la hoja, o null si el fondo aún no está dibujado.
 */
export function createBackgroundSampler(element) {
  if (!element) return null;
  let source = element;
  if (element.tagName === 'IMG') {
    if (!element.complete || !element.naturalWidth) return null;
    // La imagen viene de la sesión (blob:), así que el lienzo se puede leer.
    source = document.createElement('canvas');
    source.width = element.naturalWidth;
    source.height = element.naturalHeight;
    source.getContext('2d', { willReadFrequently: true }).drawImage(element, 0, 0);
  }
  if (!source.width || !source.height) return null;
  const context = source.getContext('2d');
  return (fx, fy) => {
    const x = Math.min(source.width - 1, Math.max(0, Math.floor(fx * source.width)));
    const y = Math.min(source.height - 1, Math.max(0, Math.floor(fy * source.height)));
    const [r, g, b, a] = context.getImageData(x, y, 1, 1).data;
    // Lo transparente se imprime sobre la hoja blanca del certificado.
    const over = (c) => c * (a / 255) + 255 * (1 - a / 255);
    return `#${toHex(over(r))}${toHex(over(g))}${toHex(over(b))}`;
  };
}
