import { useEffect, useState } from 'react';
import defaultLogoFull from '../../assets/modo-educa-logo-stacked.webp';
import defaultLogoCompact from '../../assets/modo-educa-logo-compact.webp';

/** Logos oficiales de MoDo Educa usados cuando el colegio no tiene uno propio. */
export const DEFAULT_SCHOOL_LOGO = { full: defaultLogoFull, compact: defaultLogoCompact };

/** true si `url` parece una imagen utilizable (no vacía, no "null"/"undefined"). */
export const isUsableLogoUrl = (url) => typeof url === 'string' && url.trim() !== '' && !['null', 'undefined'].includes(url.trim());

/**
 * Logo del colegio con respaldo automático: si el colegio no subió logo, lo
 * eliminó, la URL no es válida o la imagen no carga (404, archivo corrupto),
 * se muestra el logotipo oficial de MoDo Educa. Nunca queda un hueco ni un
 * ícono de imagen rota.
 *
 *   - `variant="compact"` (menú, barra superior, espacios chicos): versión sin
 *     el lema, legible en pocos píxeles. `"full"`: con "Sistema de gestión
 *     escolar" (login, tarjetas, bienvenida).
 *   - `className` lleva el tamaño de cada lugar; al logo por defecto se le
 *     agrega `school-logo--default` (placa blanca: el texto "Educa" es oscuro
 *     y debe leerse también sobre el menú oscuro).
 */
function SchoolLogo({ src, name, variant = 'compact', className = '', alt, ...props }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  const useCustom = isUsableLogoUrl(src) && !failed;
  const label = alt ?? (name ? `Logo de ${name}` : 'Logo del colegio');
  return (
    <img
      src={useCustom ? src : DEFAULT_SCHOOL_LOGO[variant] || DEFAULT_SCHOOL_LOGO.compact}
      alt={useCustom ? label : alt === '' ? '' : 'MoDo Educa'}
      className={`school-logo ${useCustom ? '' : 'school-logo--default'} ${className}`.trim()}
      onError={useCustom ? () => setFailed(true) : undefined}
      decoding="async"
      {...props}
    />
  );
}

export default SchoolLogo;
