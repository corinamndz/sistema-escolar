import MultiSelect from '../../../components/ui/MultiSelect';
import Select from '../../../components/ui/Select';
import Icon from '../../../components/ui/Icon';

/** Relación del representante con el alumno (las mismas que en la ficha del alumno). */
export const RELATIONSHIPS = ['Madre', 'Padre', 'Representante Legal', 'Tutor / Familiar', 'Otro'];

/**
 * Vínculos alumno ↔ representante (N:M) dentro de un formulario: un selector
 * múltiple con búsqueda y, por cada elegido, su relación y si es el
 * representante PRINCIPAL del alumno.
 *
 *   options  [{ id, label, sub?, search? }]  (alumnos o representantes)
 *   links    [{ id, relationship, isPrimary }]
 *   onChange (links) => void
 *   primaryMode
 *     'single' (ficha del alumno): un solo principal entre sus representantes;
 *     'each'   (ficha del representante): "principal" por alumno, independiente
 *              (marcarlo le quita la marca al principal anterior de ese alumno).
 */
function LinksField({ options, links, onChange, primaryMode, placeholder, emptyText, hint }) {
  const byId = new Map(options.map((o) => [o.id, o]));
  const ids = links.map((l) => l.id);

  const setIds = (next) => {
    const kept = links.filter((l) => next.includes(l.id));
    const added = next.filter((id) => !links.some((l) => l.id === id)).map((id) => ({ id, relationship: '', isPrimary: false }));
    let list = [...kept, ...added];
    // Ficha del alumno: el primer representante queda como principal si no hay otro.
    if (primaryMode === 'single' && list.length && !list.some((l) => l.isPrimary)) list = list.map((l, i) => ({ ...l, isPrimary: i === 0 }));
    onChange(list);
  };
  const update = (id, patch) =>
    onChange(
      links.map((l) => {
        if (l.id === id) return { ...l, ...patch };
        // Un solo principal en la ficha del alumno.
        if (primaryMode === 'single' && patch.isPrimary) return { ...l, isPrimary: false };
        return l;
      })
    );

  return (
    <div className="links-field">
      <MultiSelect options={options} value={ids} onChange={setIds} placeholder={placeholder} emptyText={emptyText} showChips={false} ariaLabel={placeholder} />
      {hint && !links.length && <span className="form-hint">{hint}</span>}
      {links.length > 0 && (
        <ul className="links-field__list">
          {links.map((l) => {
            const o = byId.get(l.id);
            const preset = RELATIONSHIPS.includes(l.relationship) || !l.relationship;
            return (
              <li key={l.id} className={`links-field__row ${l.isPrimary ? 'is-primary' : ''}`}>
                <span className="avatar avatar--sm">{(o?.label || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
                <span className="links-field__who">
                  <strong>{o?.label || 'Registro no disponible'}</strong>
                  {o?.sub && <small>{o.sub}</small>}
                </span>
                <Select
                  value={preset ? l.relationship || '' : 'Otro'}
                  onChange={(e) => update(l.id, { relationship: e.target.value })}
                  aria-label={`Relación con ${o?.label || ''}`}
                  className="links-field__relationship"
                >
                  <option value="">Relación…</option>
                  {RELATIONSHIPS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                  {!preset && <option value={l.relationship}>{l.relationship}</option>}
                </Select>
                <label className="links-field__primary" title={primaryMode === 'single' ? 'Representante principal del alumno' : 'Este representante es el principal de este alumno'}>
                  <input
                    type={primaryMode === 'single' ? 'radio' : 'checkbox'}
                    name={primaryMode === 'single' ? 'primary-guardian' : undefined}
                    checked={l.isPrimary}
                    onChange={(e) => update(l.id, { isPrimary: primaryMode === 'single' ? true : e.target.checked })}
                  />
                  Principal
                </label>
                <button type="button" className="links-field__remove" onClick={() => setIds(ids.filter((x) => x !== l.id))} aria-label={`Quitar ${o?.label || ''}`} title="Quitar">
                  <Icon name="x" size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** ¿Cambió la lista de vínculos respecto de la original? (para enviarla solo si hace falta). */
export function linksChanged(original, links) {
  if (original.length !== links.length) return true;
  const byId = new Map(original.map((l) => [l.id, l]));
  return links.some((l) => {
    const o = byId.get(l.id);
    return !o || (o.relationship || '') !== (l.relationship || '') || Boolean(o.isPrimary) !== Boolean(l.isPrimary);
  });
}

export default LinksField;
