import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';

const GAP = 6; // entre el botón y la paleta
const EDGE = 8; // distancia mínima a los bordes de la ventana
const HEX = /^#[0-9a-f]{6}$/i;

function hexToHsv(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: h * 60, s: max ? d / max : 0, v: max };
}

function hsvToHex({ h, s, v }) {
  const channel = (n) => {
    const k = (n + h / 60) % 6;
    const value = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(value * 255).toString(16).padStart(2, '0');
  };
  return `#${channel(5)}${channel(3)}${channel(1)}`;
}

/**
 * Dónde abrir la paleta: debajo si cabe, arriba si no, y si no cabe en ninguno de
 * los dos, del lado con más espacio y siempre dentro de la ventana. Función pura.
 */
export function placePopover(anchor, popover, viewport) {
  const below = viewport.height - anchor.bottom - GAP - EDGE;
  const above = anchor.top - GAP - EDGE;
  let top;
  let placement;
  if (popover.height <= below || below >= above) {
    top = anchor.bottom + GAP;
    placement = 'bottom';
  } else {
    top = anchor.top - GAP - popover.height;
    placement = 'top';
  }
  return {
    placement,
    top: Math.max(EDGE, Math.min(top, viewport.height - popover.height - EDGE)),
    left: Math.max(EDGE, Math.min(anchor.left, viewport.width - popover.width - EDGE)),
  };
}

/**
 * Selector de color propio, en lugar de <input type="color">: la paleta nativa la
 * dibuja el navegador y su posición no se puede controlar. Esta se abre en una capa
 * sobre la página (no la recorta el scroll de ningún panel) y siempre queda visible,
 * también si se desplaza la página o cambia el tamaño de la ventana.
 *   value  '#rrggbb'  ·  onChange(hex)  ·  swatches  colores de acceso rápido
 *   onSampleFallback  gotero para los navegadores sin EyeDropper (Firefox, Safari o una
 *                     página sin HTTPS): lo aporta la pantalla, que sabe de dónde leer.
 *                     Sin esta función ni EyeDropper, no se muestra el botón.
 */
function ColorPicker({ value, onChange, swatches = [], label = 'Color', disabled = false, onSampleFallback }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const [draft, setDraft] = useState(value);
  const buttonRef = useRef(null);
  const popoverRef = useRef(null);
  const areaRef = useRef(null);
  const dragging = useRef(false);

  // Si el color cambia desde fuera (otro elemento, un acceso rápido). Se compara el
  // resultado para no perder el tono al llegar al blanco o al negro, que no lo tienen.
  useEffect(() => {
    setDraft(value);
    setHsv((current) => (hsvToHex(current).toLowerCase() === value.toLowerCase() ? current : hexToHsv(value)));
  }, [value]);

  const reposition = useCallback(() => {
    if (!buttonRef.current || !popoverRef.current) return;
    setPosition(placePopover(buttonRef.current.getBoundingClientRect(), popoverRef.current.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }));
  }, []);

  // Antes de pintar: nunca se ve en el lugar equivocado.
  useLayoutEffect(() => {
    if (open) reposition();
    else setPosition(null);
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    const onPointerDown = (e) => {
      if (!popoverRef.current?.contains(e.target) && !buttonRef.current?.contains(e.target)) close();
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true); // true: también el scroll de los paneles
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, reposition]);

  const apply = (next) => {
    setHsv(next);
    onChange(hsvToHex(next));
  };
  const pickFromArea = (e) => {
    const r = areaRef.current.getBoundingClientRect();
    apply({ ...hsv, s: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), v: 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) });
  };
  const onAreaKey = (e) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (!delta) return;
    e.preventDefault();
    apply({ ...hsv, s: Math.min(1, Math.max(0, hsv.s + delta[0])), v: Math.min(1, Math.max(0, hsv.v + delta[1])) });
  };
  const onHexChange = (e) => {
    const text = e.target.value.trim();
    const next = text.startsWith('#') ? text : `#${text}`;
    setDraft(next);
    if (HEX.test(next)) onChange(next.toLowerCase());
  };
  const hueColor = hsvToHex({ h: hsv.h, s: 1, v: 1 });

  const hasNative = typeof window !== 'undefined' && 'EyeDropper' in window;
  /** Gotero: el del navegador toma el color de cualquier punto de la pantalla. */
  const startEyedropper = async () => {
    setOpen(false); // para dejar a la vista lo que se quiere muestrear
    if (!hasNative) {
      onSampleFallback?.();
      return;
    }
    try {
      const { sRGBHex } = await new window.EyeDropper().open();
      if (HEX.test(sRGBHex)) onChange(sRGBHex.toLowerCase());
    } catch (err) {
      // Cancelar con Esc no es un error; si el navegador lo impide, queda la alternativa.
      if (err?.name !== 'AbortError') onSampleFallback?.();
    }
  };

  return (
    <div className="color-picker">
      <button
        ref={buttonRef}
        type="button"
        className="color-picker__button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${value}`}
      >
        <span className="color-picker__swatch" style={{ background: value }} aria-hidden="true" />
        <span className="color-picker__value">{value.toUpperCase()}</span>
      </button>
      {(hasNative || onSampleFallback) && (
        <button type="button" className="color-picker__eyedropper" onClick={startEyedropper} disabled={disabled} title="Tomar un color de la pantalla" aria-label={`${label}: tomar con el gotero`}>
          <Icon name="pipette" size={17} />
        </button>
      )}
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            className="color-picker__popover"
            role="dialog"
            aria-label={label}
            data-placement={position?.placement}
            // Oculta hasta medir, para no parpadear en el lugar equivocado.
            style={position ? { top: position.top, left: position.left } : { top: 0, left: 0, visibility: 'hidden' }}
          >
            <div
              ref={areaRef}
              className="color-picker__area"
              style={{ backgroundColor: hueColor }} // solo el color: los degradados de saturación y brillo están en el CSS
              role="slider"
              tabIndex={0}
              aria-label="Saturación y brillo"
              aria-valuenow={Math.round(hsv.s * 100)}
              aria-valuetext={value}
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.focus();
                e.currentTarget.setPointerCapture(e.pointerId);
                dragging.current = true;
                pickFromArea(e);
              }}
              onPointerMove={(e) => dragging.current && pickFromArea(e)}
              onPointerUp={() => {
                dragging.current = false;
              }}
              onPointerCancel={() => {
                dragging.current = false;
              }}
              onKeyDown={onAreaKey}
            >
              <span className="color-picker__thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: value }} aria-hidden="true" />
            </div>
            <input type="range" className="color-picker__hue" min={0} max={359} value={Math.round(hsv.h)} onChange={(e) => apply({ ...hsv, h: Number(e.target.value) })} aria-label="Tono" />
            {swatches.length > 0 && (
              <div className="color-picker__swatches">
                {swatches.map((c) => (
                  <button key={c} type="button" className={`color-picker__chip ${c.toLowerCase() === value.toLowerCase() ? 'is-active' : ''}`} style={{ background: c }} onClick={() => onChange(c.toLowerCase())} aria-label={`Usar ${c}`} title={c} />
                ))}
              </div>
            )}
            <label className="color-picker__hex">
              <span>Hex</span>
              <input
                className="input"
                value={draft}
                onChange={onHexChange}
                onBlur={() => setDraft(value)}
                maxLength={7}
                spellCheck={false}
                aria-invalid={!HEX.test(draft)}
              />
            </label>
          </div>,
          document.body
        )}
    </div>
  );
}

export default ColorPicker;
