import { useEffect, useState } from 'react';
import defaultLogoFull from '../../assets/modo-educa-logo-stacked.png';
import defaultLogoFullDark from '../../assets/modo-educa-logo-stacked-dark.png';
import defaultLogoCompact from '../../assets/modo-educa-isotipo.png';
import defaultLogoCompactDark from '../../assets/modo-educa-isotipo-dark.png';

/** Logos oficiales de MoDo Educa usados cuando el colegio no tiene uno propio. */
// compact = isotipo de la marca (el birrete), legible en 24–40 px.
export const DEFAULT_SCHOOL_LOGO = {
  full: defaultLogoFull,
  fullDark: defaultLogoFullDark,
  compact: defaultLogoCompact,
  compactDark: defaultLogoCompactDark,
};

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
 *   - `tone="dark"`: sobre fondo oscuro (menú, panel del login) el logo por
 *     defecto usa la versión con "Educa" y el lema en claro, sin placa blanca.
 *   - `className` lleva el tamaño de cada lugar; al logo por defecto se le
 *     agrega `school-logo--default` (placa blanca: el texto "Educa" es oscuro
 *     y debe leerse también sobre el menú oscuro).
 */
function SchoolLogo({ src, name, variant = 'compact', tone = 'light', className = '', alt, ...props }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  const useCustom = isUsableLogoUrl(src) && !failed;
  const label = alt ?? (name ? `Logo de ${name}` : 'Logo del colegio');
  return (
    <img
      src={useCustom ? src : (tone === 'dark' && DEFAULT_SCHOOL_LOGO[`${variant}Dark`]) || DEFAULT_SCHOOL_LOGO[variant] || DEFAULT_SCHOOL_LOGO.compact}
      alt={useCustom ? label : alt === '' ? '' : 'MoDo Educa'}
      className={`school-logo ${useCustom ? '' : 'school-logo--default'} ${className}`.trim()}
      onError={useCustom ? () => setFailed(true) : undefined}
      decoding="async"
      {...props}
    />
  );
}

export default SchoolLogo;
