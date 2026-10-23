import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Icon from './Icon';

const MAX_RESULTS = 60;

/** "Lucía" → "lucia": búsqueda sin acentos ni mayúsculas. */
const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * Selector MÚLTIPLE con búsqueda (combobox accesible).
 *
 *   options   [{ id, label, sub?, search? }]  `search`: texto extra para buscar (cédula, grado…)
 *   value     ids elegidos
 *   onChange  (ids) => void
 *   showChips muestra lo elegido como etiquetas (false si el padre lo dibuja de otra forma)
 *
 * Cada palabra escrita debe aparecer (en cualquier orden, sin acentos). Teclado:
 * ↓/↑ recorren, Enter marca/desmarca, Esc cierra, Retroceso con la búsqueda
 * vacía quita el último elegido.
 */
function MultiSelect({ options = [], value = [], onChange, placeholder = 'Buscar…', emptyText = 'Sin coincidencias', showChips = true, disabled, id, invalid, ariaLabel }) {
  const uid = useId();
  const inputId = id || `multiselect-${uid}`;
  const listId = `${inputId}-list`;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const selected = useMemo(() => new Set(value), [value]);

  const indexed = useMemo(() => options.map((o) => ({ o, text: norm(`${o.label} ${o.sub || ''} ${o.search || ''}`) })), [options]);
  const matches = useMemo(() => {
    const words = norm(query).split(/\s+/).filter(Boolean);
    return (words.length ? indexed.filter(({ text }) => words.every((w) => text.includes(w))) : indexed).map(({ o }) => o);
  }, [indexed, query]);
  const shown = matches.slice(0, MAX_RESULTS);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  // Cerrar al hacer clic fuera.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => !rootRef.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const toggle = (optionId) => onChange(selected.has(optionId) ? value.filter((v) => v !== optionId) : [...value, optionId]);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, shown.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && shown[active]) {
        e.preventDefault();
        toggle(shown[active].id);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.stopPropagation(); // no cerrar el modal que lo contiene
        setOpen(false);
      }
    } else if (e.key === 'Backspace' && !query && value.length && showChips) {
      onChange(value.slice(0, -1));
    }
  };

  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);

  return (
    <div className={`multiselect ${open ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''}`} ref={rootRef}>
      <div className={`multiselect__control input ${invalid ? 'input--error' : ''}`} onClick={() => !disabled && setOpen(true)}>
        {showChips &&
          value.map((v) => (
            <span key={v} className="multiselect__chip">
              {byId.get(v)?.label || '—'}
              <button type="button" onClick={(e) => { e.stopPropagation(); toggle(v); }} aria-label={`Quitar ${byId.get(v)?.label || ''}`} disabled={disabled}>
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
        <Icon name="search" size={16} className="multiselect__icon" />
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={ariaLabel}
          aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
          value={query}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          autoComplete="off"
        />
        {value.length > 0 && <span className="multiselect__count">{value.length} elegido{value.length === 1 ? '' : 's'}</span>}
      </div>
      {open && !disabled && (
        <ul className="multiselect__list" id={listId} role="listbox" aria-multiselectable="true" ref={listRef}>
          {shown.length === 0 && <li className="multiselect__empty">{query ? `${emptyText} "${query}".` : emptyText}</li>}
          {shown.map((o, i) => {
            const isSelected = selected.has(o.id);
            return (
              <li
                key={o.id}
                id={`${listId}-${i}`}
                data-index={i}
                role="option"
                aria-selected={isSelected}
                className={`multiselect__option ${i === active ? 'is-active' : ''} ${isSelected ? 'is-selected' : ''}`}
                onMouseDown={(e) => e.preventDefault()} // mantiene el foco en la búsqueda
                onMouseEnter={() => setActive(i)}
                onClick={() => toggle(o.id)}
              >
                <span className="multiselect__check" aria-hidden="true">{isSelected && <Icon name="check" size={13} strokeWidth={2.6} />}</span>
                <span className="multiselect__text">
                  <strong>{o.label}</strong>
                  {o.sub && <small>{o.sub}</small>}
                </span>
              </li>
            );
          })}
          {matches.length > shown.length && <li className="multiselect__empty">Y {matches.length - shown.length} más: escribe para acotar.</li>}
        </ul>
      )}
    </div>
  );
}

export default MultiSelect;
