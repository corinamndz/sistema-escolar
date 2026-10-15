import { useMemo } from 'react';
import Icon from '../../../components/ui/Icon';

/**
 * Selector múltiple de grados (multipicklist): fichas marcables agrupadas por
 * nivel, en el orden de la jerarquía escolar, con "Todo el nivel" para marcar
 * o desmarcar los grados de un nivel de una vez.
 *
 *   grades    [{ id, name, level_code, level_name }] (ya en orden jerárquico)
 *   value     [gradeId]
 *   onChange  (gradeIds) => void
 */
function GradeMultiPicker({ grades = [], value = [], onChange, disabled }) {
  const selected = useMemo(() => new Set(value), [value]);
  const levels = useMemo(() => {
    const map = new Map();
    grades.forEach((g) => {
      if (!map.has(g.level_code)) map.set(g.level_code, { code: g.level_code, name: g.level_name, grades: [] });
      map.get(g.level_code).grades.push(g);
    });
    return [...map.values()];
  }, [grades]);

  const toggle = (id) => onChange(selected.has(id) ? value.filter((x) => x !== id) : [...value, id]);
  const toggleLevel = (level) => {
    const ids = level.grades.map((g) => g.id);
    const all = ids.every((id) => selected.has(id));
    onChange(all ? value.filter((x) => !ids.includes(x)) : [...new Set([...value, ...ids])]);
  };

  if (!grades.length) return <p className="text-sm text-muted">Aún no hay grados: créalos en Grados y secciones.</p>;

  return (
    <div className="grade-picker" role="group" aria-label="Grados donde se dicta">
      {levels.map((level) => {
        const count = level.grades.filter((g) => selected.has(g.id)).length;
        const all = count === level.grades.length;
        return (
          <div key={level.code} className="grade-picker__level">
            <div className="grade-picker__head">
              <span className="student-card__label">
                {level.name} {count > 0 && <span className="grade-picker__count">{count}</span>}
              </span>
              {level.grades.length > 1 && (
                <button type="button" className="link-button" onClick={() => toggleLevel(level)} disabled={disabled}>
                  {all ? 'Quitar todo el nivel' : 'Todo el nivel'}
                </button>
              )}
            </div>
            <div className="chip-list">
              {level.grades.map((g) => {
                const on = selected.has(g.id);
                return (
                  <label key={g.id} className={`chip-toggle ${on ? 'is-on' : ''}`}>
                    <input type="checkbox" checked={on} onChange={() => toggle(g.id)} disabled={disabled} />
                    {on && <Icon name="check" size={13} />}
                    {g.name}
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
      <span className="form-hint">
        {value.length ? `Se dicta en ${value.length} grado${value.length === 1 ? '' : 's'}.` : 'Sin grados: la materia queda solo en el catálogo.'}
      </span>
    </div>
  );
}

export default GradeMultiPicker;
