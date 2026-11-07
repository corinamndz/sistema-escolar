import { useEffect, useRef, useState } from 'react';
import { useAcademicYear } from '../../context/AcademicYearContext';
import Icon from '../ui/Icon';

const day = (d) => String(d || '').slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

/** Cómo se describe cada año en la lista. */
function yearTag(p, currentId) {
  if (p.id === currentId) return { label: 'En curso', tone: 'current' };
  if (p.closed_at) return { label: 'Finalizado', tone: 'closed' };
  if (day(p.start_date) > today()) return { label: 'Próximo', tone: 'next' };
  return { label: 'Abierto', tone: 'open' };
}

/**
 * Selector de AÑO ESCOLAR GLOBAL (barra superior). Cambiarlo actualiza al
 * instante los módulos conectados (alumnos, pagos, secciones, horarios,
 * planillas…); la elección se recuerda en el navegador. Si se está viendo un
 * año distinto al en curso, el botón lo marca y ofrece volver.
 */
function YearSwitcher() {
  const { periods, period, periodId, currentId, isCurrent, setPeriodId, resetToCurrent, loading } = useAcademicYear();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (loading || !periods.length || !period) return null;

  const pick = (id) => {
    setPeriodId(id === currentId ? '' : id); // el año en curso no se «fija»: el próximo septiembre avanza solo
    setOpen(false);
  };

  return (
    <div className="dropdown year-switcher" ref={ref}>
      <button
        type="button"
        className={`year-switcher__btn ${isCurrent ? '' : 'is-other'}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={isCurrent ? 'Año escolar en curso' : 'Estás viendo un año distinto al en curso'}
      >
        <Icon name="calendar" size={16} />
        <span className="year-switcher__text">
          <span className="year-switcher__label">Año escolar</span>
          <span className="year-switcher__value">{period.name}</span>
        </span>
        {!isCurrent && <span className="year-switcher__flag">{yearTag(period, currentId).label}</span>}
        <Icon name="chevronDown" size={15} className="year-switcher__chevron" />
      </button>

      {open && (
        <div className="dropdown__panel year-switcher__menu" role="listbox" aria-label="Año escolar">
          <div className="year-switcher__head">Año escolar de trabajo</div>
          {periods.map((p) => {
            const tag = yearTag(p, currentId);
            const selected = p.id === periodId;
            return (
              <button key={p.id} type="button" role="option" aria-selected={selected} className={`year-switcher__option ${selected ? 'is-selected' : ''}`} onClick={() => pick(p.id)}>
                <span className="year-switcher__option-name">{p.name}</span>
                <span className={`year-switcher__tag year-switcher__tag--${tag.tone}`}>{tag.label}</span>
                {selected && <Icon name="check" size={15} className="year-switcher__check" />}
              </button>
            );
          })}
          {!isCurrent && (
            <button type="button" className="year-switcher__reset" onClick={() => (resetToCurrent(), setOpen(false))}>
              <Icon name="refresh" size={14} /> Volver al año en curso
            </button>
          )}
          <p className="year-switcher__hint">Los módulos muestran los datos de este año. Se recuerda en este navegador.</p>
        </div>
      )}
    </div>
  );
}

export default YearSwitcher;
