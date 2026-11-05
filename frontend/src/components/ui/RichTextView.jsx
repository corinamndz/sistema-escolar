import { assetUrl } from './RichTextEditor';

/**
 * Muestra el texto con formato de un comunicado (notifications.body_html).
 * El HTML llega YA SANEADO por el servidor con lista blanca (párrafos, títulos,
 * negritas, cursivas, subrayado, tachado, colores, listas, enlaces seguros,
 * imágenes propias o https y alineación): por eso se puede insertar tal cual.
 * Nunca usar con HTML que no venga de ahí (para borradores: sanitizePreview).
 */
function RichTextView({ html, className = '' }) {
  if (!html) return null;
  // Imágenes subidas (/storage/…): si la API vive en otro dominio, se antepone.
  const resolved = html.replace(/src="(\/storage\/[^"]+)"/g, (m, src) => `src="${assetUrl(src)}"`);
  return <div className={`rich-text ${className}`} dangerouslySetInnerHTML={{ __html: resolved }} />;
}

/**
 * Saneado en el navegador con la MISMA lista blanca que el servidor, solo para
 * mostrar la vista previa de un borrador (lo que se guarda lo sanea el servidor).
 */
const ALLOWED = new Set(['P', 'BR', 'H1', 'H2', 'H3', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'STRIKE', 'SPAN', 'FONT', 'UL', 'OL', 'LI', 'A', 'BLOCKQUOTE', 'DIV', 'IMG']);
const RENAME = { B: 'strong', I: 'em', STRIKE: 's', DIV: 'p', FONT: 'span' };
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[\d.]+\s*)?\))$/i;
const STORED_IMG = /^\/storage\/announcements\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|gif|webp)$/i;

export function sanitizePreview(html) {
  const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
  const clean = (node, out) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        out.appendChild(document.createTextNode(child.textContent));
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (!ALLOWED.has(child.tagName)) {
          if (!['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'SVG'].includes(child.tagName.toUpperCase())) clean(child, out); // conserva el texto
          return;
        }
        if (child.tagName === 'IMG') {
          const src = child.getAttribute('src') || '';
          const stored = src.startsWith(`${import.meta.env.VITE_API_URL || ''}/storage/`) ? src.slice((import.meta.env.VITE_API_URL || '').length) : src;
          if (!STORED_IMG.test(stored) && !/^https:\/\/\S+$/i.test(src)) return;
          const img = document.createElement('img');
          img.setAttribute('src', assetUrl(stored));
          img.setAttribute('alt', child.getAttribute('alt') || '');
          out.appendChild(img);
          return;
        }
        const el = document.createElement(RENAME[child.tagName] || child.tagName.toLowerCase());
        const st = child.style || {};
        if (/^(left|right|center|justify)$/.test(st.textAlign || '')) el.style.textAlign = st.textAlign;
        const color = st.color || child.getAttribute('color') || '';
        if (COLOR.test(color.trim()) || /^rgb/.test(color)) el.style.color = color;
        if (/^rgb|^#/.test(st.backgroundColor || '') && COLOR.test(st.backgroundColor.trim())) el.style.backgroundColor = st.backgroundColor;
        if (child.tagName === 'A') {
          const href = child.getAttribute('href') || '';
          if (!/^(https?:|mailto:|tel:)/i.test(href)) {
            clean(child, out);
            return;
          }
          el.setAttribute('href', href);
          el.setAttribute('target', '_blank');
          el.setAttribute('rel', 'noopener noreferrer nofollow');
        }
        clean(child, el);
        out.appendChild(el);
      }
    });
    return out;
  };
  return clean(doc.body.firstChild, document.createElement('div')).innerHTML;
}

/** Categorías de los comunicados (backend: announcement.service → CATEGORIES). */
export const ANNOUNCEMENT_CATEGORIES = {
  academic: { label: 'Académico', icon: 'book' },
  administrative: { label: 'Administrativo', icon: 'briefcase' },
  urgent: { label: 'Urgente', icon: 'alertTriangle' },
  event: { label: 'Evento', icon: 'calendar' },
};

export default RichTextView;
