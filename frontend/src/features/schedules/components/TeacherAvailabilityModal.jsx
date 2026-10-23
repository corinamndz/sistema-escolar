import { useEffect, useState } from 'react';
import schedulesApi from '../../../api/endpoints/schedules.api';
import { getErrorMessage } from '../../../api/axiosClient';
import Modal from '../../../components/ui/Modal';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Select from '../../../components/ui/Select';
import Input from '../../../components/ui/Input';
import Spinner from '../../../components/ui/Spinner';
import { useToast } from '../../../components/ui/Toast';
import ScheduleGrid from './ScheduleGrid';

// Mismos días que el backend (schedule.service DAYS): lunes a viernes.
const DAYS = [
  { day: 1, name: 'Lunes' },
  { day: 2, name: 'Martes' },
  { day: 3, name: 'Miércoles' },
  { day: 4, name: 'Jueves' },
  { day: 5, name: 'Viernes' },
];

const keyOf = (day, slotId) => `${day}|${slotId}`;

/**
 * Disponibilidad de un docente en el año: se marcan los bloques en que NO
 * puede dar clase (trabaja en otro colegio, tiene otra función…). El generador
 * automático no le asigna clases ahí y la grilla tampoco deja colocarlas.
 */
function TeacherAvailabilityModal({ periodId, slots, teachers, initialTeacherId, onClose }) {
  const toast = useToast();
  const [teacherId, setTeacherId] = useState(initialTeacherId || teachers[0]?.id || '');
  const [cells, setCells] = useState(null); // Map key → reason
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [warnings, setWarnings] = useState([]);

  useEffect(() => {
    if (!teacherId) return;
    setCells(null);
    setWarnings([]);
    schedulesApi
      .getUnavailability(periodId, teacherId)
      .then((r) => {
        setCells(new Map(r.cells.map((c) => [keyOf(c.day_of_week, c.time_slot_id), c.reason || ''])));
        setReason(r.cells.find((c) => c.reason)?.reason || '');
      })
      .catch((err) => setError(getErrorMessage(err)));
  }, [periodId, teacherId]);

  const toggle = (day, slot) =>
    setCells((prev) => {
      const next = new Map(prev);
      const k = keyOf(day, slot.id);
      if (next.has(k)) next.delete(k);
      else next.set(k, reason);
      return next;
    });
  const classSlots = (slots || []).filter((s) => !s.is_break);
  const setDay = (day, unavailable) =>
    setCells((prev) => {
      const next = new Map(prev);
      classSlots.forEach((s) => (unavailable ? next.set(keyOf(day, s.id), reason) : next.delete(keyOf(day, s.id))));
      return next;
    });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const list = [...cells.keys()].map((k) => {
        const [day, timeSlotId] = k.split('|');
        return { dayOfWeek: Number(day), timeSlotId, reason: reason.trim() || cells.get(k) || null };
      });
      const r = await schedulesApi.saveUnavailability(periodId, teacherId, list);
      if (r.warnings.length) setWarnings(r.warnings);
      else onClose();
      toast.success('Disponibilidad guardada', `${r.teacher.name}: ${r.cells} bloque${r.cells === 1 ? '' : 's'} no disponible${r.cells === 1 ? '' : 's'}`);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Disponibilidad del docente" onClose={onClose} size="lg">
      <p className="text-muted" style={{ marginTop: 0 }}>
        Toca los bloques en que el profesor <strong>no puede</strong> dar clase. El generador automático no le asignará clases ahí y la grilla tampoco
        dejará colocarlas.
      </p>
      <div className="availability__bar">
        <Select sorted value={teacherId} onChange={(e) => setTeacherId(e.target.value)} aria-label="Docente">
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (opcional): ej. trabaja en otro colegio" maxLength={120} aria-label="Motivo" />
      </div>
      <div className="availability__days">
        {DAYS.map((d) => (
          <span key={d.day}>
            {d.name}:{' '}
            <button type="button" className="link-button" onClick={() => setDay(d.day, true)} disabled={!cells}>
              todo el día
            </button>
            {' · '}
            <button type="button" className="link-button" onClick={() => setDay(d.day, false)} disabled={!cells}>
              libre
            </button>
          </span>
        ))}
      </div>
      <Alert>{error}</Alert>
      {warnings.length > 0 && (
        <Alert variant="warning">
          Guardado. Estas clases ya están en bloques que marcaste como no disponibles; muévelas desde la grilla o regenera el horario:
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}
      {!cells ? (
        <Spinner />
      ) : (
        <div className="availability__grid">
          <ScheduleGrid
            days={DAYS}
            slots={slots || []}
            entries={[]}
            editable
            cellState={() => ({})}
            onCellClick={toggle}
            cellHint={(day, slot) =>
              cells.has(keyOf(day, slot.id))
                ? { className: 'is-unavailable', label: 'No disponible', title: cells.get(keyOf(day, slot.id)) || 'No disponible' }
                : { className: 'is-available', label: 'Disponible' }
            }
          />
        </div>
      )}
      <div className="form-actions">
        <span className="text-sm text-muted" style={{ marginRight: 'auto' }}>
          {cells ? `${cells.size} bloque${cells.size === 1 ? '' : 's'} no disponible${cells.size === 1 ? '' : 's'}` : ''}
        </span>
        <Button variant="secondary" onClick={onClose}>
          {warnings.length ? 'Cerrar' : 'Cancelar'}
        </Button>
        <Button onClick={save} loading={saving} disabled={!cells || !teacherId}>
          Guardar disponibilidad
        </Button>
      </div>
    </Modal>
  );
}

export default TeacherAvailabilityModal;
