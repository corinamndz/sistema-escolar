import { useEffect, useState } from 'react';
import schedulesApi from '../../../api/endpoints/schedules.api';
import { getErrorMessage } from '../../../api/axiosClient';
import Modal from '../../../components/ui/Modal';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Field from '../../../components/ui/Field';
import Alert from '../../../components/ui/Alert';
import Icon from '../../../components/ui/Icon';
import Spinner from '../../../components/ui/Spinner';
import { useToast } from '../../../components/ui/Toast';

const toMin = (t) => {
  const [h, m] = String(t || '0:0')
    .split(':')
    .map(Number);
  return h * 60 + m;
};
const toTime = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/**
 * Bloques horarios del año escolar (los comparten todas sus secciones). Se
 * pueden editar uno a uno o generar de una vez: hora de inicio, duración,
 * cantidad de bloques y un recreo después de un bloque.
 */
function SlotsEditorModal({ period, onClose, onSaved }) {
  const toast = useToast();
  const [rows, setRows] = useState(null); // null = cargando los bloques guardados del año
  useEffect(() => {
    schedulesApi
      .getSlots(period.id)
      .then((slots) =>
        setRows(
          slots.map((s) => ({
            id: s.id,
            name: s.name,
            startTime: s.start_time,
            endTime: s.end_time,
            isBreak: s.is_break,
          })),
        ),
      )
      .catch((err) => {
        setError(getErrorMessage(err));
        setRows([]);
      });
  }, [period.id]);
  const [gen, setGen] = useState({
    start: '07:00',
    minutes: 45,
    count: 6,
    breakAfter: 3,
    breakMinutes: 20,
  });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const setRow = (i, patch) => setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  /** Genera los bloques; conserva los ids de los existentes por posición (así sus clases no se pierden). */
  const generate = () => {
    const out = [];
    let t = toMin(gen.start);
    let n = 1;
    for (let i = 0; i < Number(gen.count); i += 1) {
      out.push({
        name: `Bloque ${n}`,
        startTime: toTime(t),
        endTime: toTime(t + Number(gen.minutes)),
        isBreak: false,
      });
      t += Number(gen.minutes);
      n += 1;
      if (Number(gen.breakAfter) && i + 1 === Number(gen.breakAfter)) {
        out.push({
          name: 'Recreo',
          startTime: toTime(t),
          endTime: toTime(t + Number(gen.breakMinutes)),
          isBreak: true,
        });
        t += Number(gen.breakMinutes);
      }
    }
    const classes = rows.filter((r) => !r.isBreak);
    const breaks = rows.filter((r) => r.isBreak);
    let c = 0;
    let b = 0;
    setRows(
      out.map((r) => ({
        ...r,
        id: r.isBreak ? breaks[b++]?.id : classes[c++]?.id,
      })),
    );
  };

  const addRow = () => {
    const last = rows[rows.length - 1];
    const start = last ? toMin(last.endTime) : toMin('07:00');
    setRows([
      ...rows,
      {
        name: `Bloque ${rows.filter((r) => !r.isBreak).length + 1}`,
        startTime: toTime(start),
        endTime: toTime(start + 45),
        isBreak: false,
      },
    ]);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await schedulesApi.saveSlots(
        period.id,
        rows.map(({ id, name, startTime, endTime, isBreak }) => ({
          ...(id ? { id } : {}),
          name,
          startTime,
          endTime,
          isBreak,
        })),
      );
      toast.success('Bloques horarios guardados', `${rows.length} bloque${rows.length === 1 ? '' : 's'} · ${period.name}`);
      onSaved();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Bloques horarios · ${period.name}`} onClose={onClose} size="lg">
      <Alert>{error}</Alert>
      {rows === null ? (
        <Spinner label="Cargando bloques…" />
      ) : (
        <>
          <div className="slots-generator">
            <strong>
              <Icon name="sparkles" size={15} /> Generar automáticamente
            </strong>
            {/* Etiquetas cortas (una línea) y sin ayudas dentro de la fila: así todos los
                campos tienen la misma altura y los inputs quedan alineados. */}
            <div className="slots-generator__fields">
              <Field label="Inicio">
                <Input type="time" value={gen.start} onChange={(e) => setGen({ ...gen, start: e.target.value })} />
              </Field>
              <Field label="Min. por bloque">
                <Input type="number" min="10" max="180" value={gen.minutes} onChange={(e) => setGen({ ...gen, minutes: e.target.value })} />
              </Field>
              <Field label="Bloques">
                <Input type="number" min="1" max="15" value={gen.count} onChange={(e) => setGen({ ...gen, count: e.target.value })} />
              </Field>
              <Field label="Recreo tras bloque">
                <Input
                  type="number"
                  min="0"
                  max="15"
                  value={gen.breakAfter}
                  onChange={(e) => setGen({ ...gen, breakAfter: e.target.value })}
                  aria-describedby="slots-generator-note"
                />
              </Field>
              <Field label="Min. de recreo">
                <Input
                  type="number"
                  min="5"
                  max="90"
                  value={gen.breakMinutes}
                  onChange={(e) => setGen({ ...gen, breakMinutes: e.target.value })}
                />
              </Field>
            </div>
            <div className="slots-generator__footer">
              <span id="slots-generator-note" className="form-hint">
                "Recreo tras bloque": número del bloque después del cual va el recreo (0 = sin recreo).
              </span>
              <Button size="sm" variant="secondary" icon="sparkles" onClick={generate}>
                Generar bloques
              </Button>
            </div>
          </div>

          <div className="table-wrap">
            <table className="table slots-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Inicio</th>
                  <th>Fin</th>
                  <th>Recreo</th>
                  <th aria-label="Quitar" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id || `new-${i}`} className={r.isBreak ? 'is-break' : undefined}>
                    <td>
                      <Input
                        value={r.name}
                        maxLength={40}
                        onChange={(e) => setRow(i, { name: e.target.value })}
                        aria-label="Nombre del bloque"
                      />
                    </td>
                    <td>
                      <Input
                        type="time"
                        value={r.startTime}
                        onChange={(e) => setRow(i, { startTime: e.target.value })}
                        aria-label="Hora de inicio"
                      />
                    </td>
                    <td>
                      <Input
                        type="time"
                        value={r.endTime}
                        onChange={(e) => setRow(i, { endTime: e.target.value })}
                        aria-label="Hora de fin"
                      />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={r.isBreak}
                        onChange={(e) => setRow(i, { isBreak: e.target.checked })}
                        aria-label="Es recreo"
                      />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="trash"
                        onClick={() => setRows(rows.filter((_, j) => j !== i))}
                        aria-label="Quitar bloque"
                      />
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-muted">
                      Sin bloques: genéralos o agrégalos uno a uno.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Button size="sm" variant="ghost" icon="plus" onClick={addRow} style={{ marginTop: 8 }}>
            Agregar bloque
          </Button>
          <p className="text-sm text-muted">
            Los bloques son de todo el año escolar: los usan todas sus secciones. Un bloque con clases no se puede eliminar ni convertir en
            recreo.
          </p>
          <div className="form-actions">
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={save} loading={saving}>
              Guardar bloques
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

export default SlotsEditorModal;
