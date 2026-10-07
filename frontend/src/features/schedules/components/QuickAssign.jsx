import { useState } from 'react';
import Icon from '../../../components/ui/Icon';

/**
 * Asignación rápida de un profesor sin salir de la pantalla: un botón que se
 * convierte en un selector de docentes (A-Z) y guarda al elegir.
 *
 *   teachers   [{ id, name }] docentes activos
 *   currentId  profesor actual (para "Cambiar")
 *   onAssign(teacherId | null) → Promise   guarda (null = quitar)
 *   label      texto del botón ("Asignar profesor", "Cambiar"…)
 *   allowClear muestra "Quitar profesor" en la lista
 *
 * Detiene la propagación de clics y arrastres para poder vivir dentro de una
 * tarjeta arrastrable o clicable.
 */
function QuickAssign({ teachers = [], currentId = null, onAssign, label = 'Asignar profesor', variant = 'warning', allowClear = false, disabled }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const stop = (e) => e.stopPropagation();

  const choose = async (value) => {
    if (value === '' || value === currentId) return setOpen(false);
    setSaving(true);
    try {
      await onAssign(value === '__none' ? null : value);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className={`quick-assign__btn quick-assign__btn--${variant}`}
        onClick={(e) => {
          stop(e);
          setOpen(true);
        }}
        onKeyDown={stop}
        onMouseDown={stop}
        disabled={disabled}
      >
        <Icon name={variant === 'warning' ? 'plus' : 'pencil'} size={12} /> {label}
      </button>
    );
  }
  const sorted = [...teachers].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  return (
    <span className="quick-assign" onClick={stop} onKeyDown={stop} onMouseDown={stop} onDragStart={(e) => e.preventDefault()}>
      <select
        className="input quick-assign__select"
        autoFocus
        defaultValue={currentId || ''}
        disabled={saving}
        onChange={(e) => choose(e.target.value)}
        onBlur={() => !saving && setOpen(false)}
        aria-label="Elegir profesor"
      >
        <option value="">{saving ? 'Guardando…' : 'Elige un profesor…'}</option>
        {sorted.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
        {allowClear && currentId && <option value="__none">— Quitar profesor</option>}
      </select>
      {!teachers.length && <span className="quick-assign__empty">No hay docentes activos: regístralos en Personal.</span>}
    </span>
  );
}

export default QuickAssign;
