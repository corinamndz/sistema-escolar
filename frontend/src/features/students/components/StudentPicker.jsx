import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Icon from '../../../components/ui/Icon';

const MAX_RESULTS = 50;

/** "Lucía" → "lucia": búsqueda sin acentos ni mayúsculas. */
const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const fullName = (s) => `${s.first_name} ${s.last_name}`;
const courseOf = (s) => (s.grade_name ? `${s.grade_name} ${s.section_name || ''}`.trim() : 'Sin sección');

/**
 * Selector de alumno con búsqueda (combobox accesible).
 *
 *   - Filtra en tiempo real por nombre, apellido, cédula, grado o sección:
 *     cada palabra escrita debe aparecer (en cualquier orden, sin acentos).
 *   - Cada opción muestra nombre, cédula y "3er Año A" para distinguir
 *     alumnos con nombres parecidos.
 *   - Teclado: ↓/↑ recorren, Enter elige, Esc cierra (o borra la búsqueda),
 *     Inicio/Fin van al primero/último. También con el ratón o el dedo.
 *
 *   students  [{ id, first_name, last_name, national_id?, grade_name?, section_name? }]
 *   value     id del alumno elegido ('' si ninguno)
 *   onChange  (id) => void
 */
function StudentPicker({ students = [], value, onChange, id, required, disabled, invalid, placeholder = 'Escribe nombre, apellido o cédula…', autoFocus }) {
  const uid = useId();
  const inputId = id || `student-picker-${uid}`;
  const listId = `${inputId}-list`;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  const selected = students.find((s) => s.id === value) || null;

  // Índice de búsqueda (una vez por lista) y orden alfabético por nombre.
  const indexed = useMemo(
    () =>
      [...students]
        .sort((a, b) => fullName(a).localeCompare(fullName(b), 'es', { sensitivity: 'base' }))
        .map((s) => ({ s, text: norm(`${fullName(s)} ${s.national_id || ''} ${courseOf(s)} ${s.grade_name || ''}${s.section_name || ''}`) })),
    [students],
  );
  const matches = useMemo(() => {
    const words = norm(query).split(/\s+/).filter(Boolean);
    const list = words.length ? indexed.filter(({ text }) => words.every((w) => text.includes(w))) : indexed;
    return list.map(({ s }) => s);
  }, [indexed, query]);
  const shown = matches.slice(0, MAX_RESULTS);

  useEffect(() => setActive(0), [query]);
  // Mantiene visible la opción activa al moverse con el teclado.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (student) => {
    onChange(student.id);
    setQuery('');
    setOpen(false);
  };
  const clear = () => {
    onChange('');
    setQuery('');
    setOpen(true);
    inputRef.current?.focus();
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) return setOpen(true);
      setActive((i) => Math.min(i + 1, shown.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Home' && open) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End' && open) {
      e.preventDefault();
      setActive(Math.max(shown.length - 1, 0));
    } else if (e.key === 'Enter') {
      // Enter elige (no envía el formulario mientras la lista está abierta).
      if (open && shown[active]) {
        e.preventDefault();
        choose(shown[active]);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        e.stopPropagation(); // no cerrar el modal
        if (query) setQuery('');
        else setOpen(false);
      }
    } else if (e.key === 'Backspace' && selected && !query) {
      clear();
    }
  };

  const activeId = open && shown[active] ? `${inputId}-opt-${shown[active].id}` : undefined;

  return (
    <div className={`student-picker ${open ? 'is-open' : ''} ${invalid ? 'is-invalid' : ''}`}>
      <div className="student-picker__control">
        <Icon name="search" size={16} className="student-picker__icon" />
        <input
          ref={inputRef}
          id={inputId}
          className="input student-picker__input"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-invalid={invalid || undefined}
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          disabled={disabled}
          // Con un alumno elegido y sin escribir, el campo muestra a ese alumno.
          value={query || (selected && !open ? `${fullName(selected)} — ${courseOf(selected)}` : query)}
          placeholder={selected ? `${fullName(selected)} — ${courseOf(selected)}` : placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        {selected && !disabled && (
          <button type="button" className="student-picker__clear" onMouseDown={(e) => e.preventDefault()} onClick={clear} aria-label="Quitar alumno elegido">
            <Icon name="x" size={14} />
          </button>
        )}
        {/* Valida "requerido" en el formulario nativo aunque el input visible sea de búsqueda. */}
        {required && <input tabIndex={-1} aria-hidden="true" className="student-picker__required" value={value || ''} onChange={() => {}} required />}
      </div>

      {open && (
        <ul ref={listRef} id={listId} role="listbox" className="student-picker__list" aria-label="Alumnos">
          {shown.length === 0 ? (
            <li className="student-picker__empty" role="presentation">
              Ningún alumno coincide con “{query}”.
            </li>
          ) : (
            shown.map((s, i) => (
              <li
                key={s.id}
                id={`${inputId}-opt-${s.id}`}
                role="option"
                data-index={i}
                aria-selected={s.id === value}
                className={`student-picker__option ${i === active ? 'is-active' : ''} ${s.id === value ? 'is-selected' : ''}`}
                // mousedown + preventDefault: elegir antes de que el input pierda el foco.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(s);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="student-picker__name">{fullName(s)}</span>
                <span className="student-picker__meta">
                  {s.national_id && <span>{s.national_id}</span>}
                  <span className={`student-picker__course ${s.grade_name ? '' : 'is-none'}`}>{courseOf(s)}</span>
                </span>
                {s.id === value && <Icon name="check" size={15} className="student-picker__check" />}
              </li>
            ))
          )}
          {matches.length > MAX_RESULTS && (
            <li className="student-picker__more" role="presentation">
              Mostrando {MAX_RESULTS} de {matches.length}: sigue escribiendo para afinar la búsqueda.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export default StudentPicker;
