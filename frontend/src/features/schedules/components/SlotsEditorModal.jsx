import { useEffect, useMemo, useState } from 'react';
import schedulesApi from '../../../api/endpoints/schedules.api';
import { getErrorMessage } from '../../../api/axiosClient';
import Drawer from '../../../components/ui/Drawer';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Field from '../../../components/ui/Field';
import Alert from '../../../components/ui/Alert';
import Icon from '../../../components/ui/Icon';
import Spinner from '../../../components/ui/Spinner';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { LEVEL_SHORT } from '../slotGrid';

const toMin = (t) => {
  const [h, m] = String(t || '0:0')
    .split(':')
    .map(Number);
  return h * 60 + m;
};
const toTime = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const toRows = (slots) => slots.map((s) => ({ id: s.id, name: s.name, startTime: s.start_time, endTime: s.end_time, isBreak: s.is_break }));
const GENERAL = 'general';

/**
 * Jornadas del año escolar (migración 074). Una jornada GENERAL y, si hace
 * falta, una propia por nivel (Inicial, Primaria, Secundaria) con su inicio,
 * duración de los bloques y todos los recreos que necesite (merienda,
 * almuerzo…). Un nivel sin jornada propia usa la general.
 *
 * `onlyLevel`: el coordinador de un nivel solo ve y edita la jornada de su nivel.
 */
function SlotsEditorModal({ period, onClose, onSaved, onlyLevel = null }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [structures, setStructures] = useState(null);
  const [tab, setTab] = useState(onlyLevel || GENERAL);
  const [rows, setRows] = useState(null);
  const [version, setVersion] = useState(0); // sube al cargar las filas de una pestaña: el editor se reinicia con ellas
  const [creating, setCreating] = useState(false); // nivel sin jornada propia que se está creando
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = () =>
    schedulesApi
      .getStructures(period.id)
      .then(setStructures)
      .catch((err) => setError(getErrorMessage(err)));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period.id]);

  const level = tab === GENERAL ? null : structures?.levels.find((l) => l.code === tab);
  const usesGeneral = Boolean(level && !level.own && !creating);
  // Filas en edición de la pestaña elegida.
  useEffect(() => {
    if (!structures) return;
    setError(null);
    if (tab === GENERAL) setRows(toRows(structures.general));
    else if (level?.own) setRows(toRows(level.slots));
    else setRows(creating ? toRows(structures.general).map(({ id, ...r }) => r) : []);
    setVersion((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structures, tab, creating]);

  const tabs = useMemo(() => {
    if (!structures) return [];
    const levelTabs = structures.levels.map((l) => ({ key: l.code, label: LEVEL_SHORT[l.code] || l.name, own: l.own }));
    return onlyLevel ? levelTabs.filter((t) => t.key === onlyLevel) : [{ key: GENERAL, label: 'General', own: true }, ...levelTabs];
  }, [structures, onlyLevel]);

  const changeTab = (key) => {
    setCreating(false);
    setTab(key);
  };

  const save = async (list = rows, { message } = {}) => {
    setSaving(true);
    setError(null);
    const where = tab === GENERAL ? 'la jornada general' : `la jornada de ${level?.name || tab}`;
    // Payload: el nivel (null = general) y TODOS los bloques y recreos de esa jornada.
    const payload = list.map(({ id, name, startTime, endTime, isBreak }) => ({ ...(id ? { id } : {}), name: name.trim(), startTime, endTime, isBreak: Boolean(isBreak) }));
    try {
      const fresh = await schedulesApi.saveSlots(period.id, payload, tab === GENERAL ? null : tab);
      // Se confirma con lo que devolvió el servidor (ya guardado), no con lo que se envió.
      const saved = tab === GENERAL ? fresh.general : fresh.levels.find((l) => l.code === tab)?.slots || [];
      if (list.length && saved.length !== list.length) {
        throw new Error(`El servidor respondió, pero ${where} quedó con ${saved.length} de ${list.length} bloques. Recarga y revisa.`);
      }
      setStructures(fresh);
      setCreating(false);
      toast.success(message || `Se guardó ${where}`, `${list.length} bloque${list.length === 1 ? '' : 's'} · ${period.name}`);
      onSaved();
    } catch (err) {
      const msg = getErrorMessage(err);
      setError(msg);
      // El botón está al pie del panel y el aviso arriba: también un aviso flotante, y se lleva el panel al mensaje.
      toast.error(`No se guardó ${where}`, msg);
      requestAnimationFrame(() => document.querySelector('.drawer .alert')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    } finally {
      setSaving(false);
    }
  };

  const useGeneralAgain = async () => {
    const ok = await confirm({
      title: `¿${level.name} vuelve a la jornada general?`,
      message: 'Se borran sus bloques propios y sus clases pasan al bloque de la jornada general que empieza a la misma hora. Si alguna no tiene equivalente, no se cambia nada.',
      confirmLabel: 'Usar la jornada general',
      icon: 'layers',
    });
    if (ok) await save([], { message: `${level.name} usa la jornada general` });
  };

  return (
    <Drawer title={`Jornadas y bloques · ${period.name}`} onClose={onClose} size="lg">
      {!structures ? (
        error ? <Alert>{error}</Alert> : <Spinner label="Cargando jornadas…" />
      ) : (
        <>
          <p className="slots-intro">
            {onlyLevel
              ? 'Bloques de clase y recreos de tu nivel. Ningún bloque puede solaparse con un recreo, y un docente que da clase en otro nivel nunca queda con dos clases a la vez.'
              : 'Cada nivel puede tener su propia jornada (inicio, duración de los bloques y todos los recreos que necesite); si no, usa la general. Un docente que da clase en varios niveles nunca queda con dos clases a la vez, aunque las horas sean distintas.'}
          </p>

          {tabs.length > 1 && (
            <div className="slots-tabs" role="tablist" aria-label="Jornada">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  className={`slots-tabs__tab ${tab === t.key ? 'is-active' : ''}`}
                  onClick={() => changeTab(t.key)}
                >
                  {t.label}
                  {t.key !== GENERAL && <span className={`slots-tabs__badge ${t.own ? 'is-own' : ''}`}>{t.own ? 'Propia' : 'General'}</span>}
                </button>
              ))}
            </div>
          )}

          <Alert>{error}</Alert>

          {usesGeneral ? (
            <div className="slots-uses-general">
              <Icon name="layers" size={22} />
              <div>
                <strong>{level.name} usa la jornada general</strong>
                <p className="text-sm text-muted">
                  {structures.general.filter((s) => !s.is_break).length} bloques de clase y {structures.general.filter((s) => s.is_break).length} recreo(s). Crea una jornada propia si
                  este nivel entra, sale o hace sus recreos a otra hora.
                </p>
              </div>
              <Button icon="plus" onClick={() => setCreating(true)} disabled={saving}>
                Crear jornada propia
              </Button>
            </div>
          ) : rows === null ? (
            <Spinner />
          ) : (
            <StructureEditor
              key={`${tab}-${creating}-${version}`}
              rows={rows}
              setRows={setRows}
              hint={
                creating
                  ? `Parte de una copia de la jornada general: ajústala para ${level.name}. Al guardar, sus clases pasan al bloque que empieza a la misma hora.`
                  : tab === GENERAL
                    ? 'La usan los niveles sin jornada propia. Un bloque con clases no se puede eliminar ni convertir en recreo.'
                    : 'Un bloque con clases no se puede eliminar ni convertir en recreo.'
              }
            />
          )}

          <div className="form-actions">
            {level?.own && !creating && (
              <Button variant="ghost" icon="layers" onClick={useGeneralAgain} disabled={saving} style={{ marginRight: 'auto' }}>
                Usar la jornada general
              </Button>
            )}
            {creating && (
              <Button variant="ghost" onClick={() => setCreating(false)} disabled={saving} style={{ marginRight: 'auto' }}>
                Cancelar jornada propia
              </Button>
            )}
            <Button variant="secondary" onClick={onClose}>
              Cerrar
            </Button>
            {!usesGeneral && (
              <Button onClick={() => save()} loading={saving} disabled={!rows?.length}>
                {creating ? `Crear jornada de ${LEVEL_SHORT[tab] || level?.name}` : 'Guardar jornada'}
              </Button>
            )}
          </div>
        </>
      )}
    </Drawer>
  );
}

/**
 * Bloques de una jornada: generador (inicio, minutos por bloque, cantidad y
 * los recreos que hagan falta, cada uno tras un bloque y con su duración) y
 * edición fila a fila.
 */
function StructureEditor({ rows, setRows, hint }) {
  // Valores iniciales del generador: los de la jornada que se edita (o 6 bloques de 45' desde las 07:00).
  const classRows = rows.filter((r) => !r.isBreak);
  const [gen, setGen] = useState({
    start: [...rows].sort((a, b) => toMin(a.startTime) - toMin(b.startTime))[0]?.startTime || '07:00',
    minutes: classRows[0] ? toMin(classRows[0].endTime) - toMin(classRows[0].startTime) : 45,
    count: classRows.length || 6,
  });
  // Recreos del generador: los de la jornada actual (tras qué bloque y cuánto duran) o uno por defecto.
  const [breaks, setBreaks] = useState(() => {
    const out = [];
    let n = 0;
    rows.forEach((r) => {
      if (r.isBreak) out.push({ name: r.name, after: n, minutes: toMin(r.endTime) - toMin(r.startTime) });
      else n += 1;
    });
    return out.length ? out : [{ name: 'Recreo', after: 3, minutes: 20 }];
  });
  const setRow = (i, patch) => setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const setBreak = (i, patch) => setBreaks((b) => b.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  /** Genera los bloques; conserva los ids de los existentes por posición (así sus clases no se pierden). */
  const generate = () => {
    const out = [];
    let t = toMin(gen.start);
    const pending = [...breaks].filter((b) => Number(b.minutes) > 0).sort((a, b) => Number(a.after) - Number(b.after));
    const pushBreaksAfter = (k) => {
      pending.filter((b) => Number(b.after) === k).forEach((b) => {
        out.push({ name: b.name?.trim() || 'Recreo', startTime: toTime(t), endTime: toTime(t + Number(b.minutes)), isBreak: true });
        t += Number(b.minutes);
      });
    };
    pushBreaksAfter(0);
    for (let i = 0; i < Number(gen.count); i += 1) {
      out.push({ name: `Bloque ${i + 1}`, startTime: toTime(t), endTime: toTime(t + Number(gen.minutes)), isBreak: false });
      t += Number(gen.minutes);
      pushBreaksAfter(i + 1);
    }
    const classes = rows.filter((r) => !r.isBreak);
    const olds = rows.filter((r) => r.isBreak);
    let c = 0;
    let b = 0;
    setRows(out.map((r) => ({ ...r, id: r.isBreak ? olds[b++]?.id : classes[c++]?.id })));
  };

  const addRow = (isBreak = false) => {
    const last = rows[rows.length - 1];
    const start = last ? toMin(last.endTime) : toMin('07:00');
    setRows([
      ...rows,
      {
        name: isBreak ? 'Recreo' : `Bloque ${rows.filter((r) => !r.isBreak).length + 1}`,
        startTime: toTime(start),
        endTime: toTime(start + (isBreak ? 20 : 45)),
        isBreak,
      },
    ]);
  };

  const end = rows.length ? rows.reduce((m, r) => Math.max(m, toMin(r.endTime)), 0) : null;

  return (
    <>
      <div className="slots-generator">
        <strong>
          <Icon name="sparkles" size={15} /> Generar automáticamente
        </strong>
        <div className="slots-generator__fields slots-generator__fields--3">
          <Field label="Inicio">
            <Input type="time" value={gen.start} onChange={(e) => setGen({ ...gen, start: e.target.value })} />
          </Field>
          <Field label="Min. por bloque">
            <Input type="number" min="10" max="180" value={gen.minutes} onChange={(e) => setGen({ ...gen, minutes: e.target.value })} />
          </Field>
          <Field label="Bloques">
            <Input type="number" min="1" max="15" value={gen.count} onChange={(e) => setGen({ ...gen, count: e.target.value })} />
          </Field>
        </div>
        <div className="slots-breaks">
          <span className="slots-breaks__title">Recreos</span>
          {breaks.map((b, i) => (
            <div key={i} className="slots-breaks__row">
              <Input value={b.name} maxLength={40} onChange={(e) => setBreak(i, { name: e.target.value })} aria-label="Nombre del recreo" placeholder="Recreo" />
              <label className="slots-breaks__field">
                tras el bloque
                <Input type="number" min="0" max="15" value={b.after} onChange={(e) => setBreak(i, { after: e.target.value })} aria-label="Después del bloque número" />
              </label>
              <label className="slots-breaks__field">
                min
                <Input type="number" min="5" max="120" value={b.minutes} onChange={(e) => setBreak(i, { minutes: e.target.value })} aria-label="Duración en minutos" />
              </label>
              <Button size="sm" variant="ghost" icon="trash" onClick={() => setBreaks(breaks.filter((_, j) => j !== i))} aria-label="Quitar recreo" />
            </div>
          ))}
          <Button size="sm" variant="ghost" icon="plus" onClick={() => setBreaks([...breaks, { name: breaks.length ? 'Almuerzo' : 'Recreo', after: Number(gen.count) || 1, minutes: 30 }])}>
            Agregar recreo
          </Button>
        </div>
        <div className="slots-generator__footer">
          <span className="form-hint">«Tras el bloque»: número del bloque después del cual va (0 = antes del primero).</span>
          <Button size="sm" variant="secondary" icon="sparkles" onClick={generate}>
            Generar bloques
          </Button>
        </div>
      </div>

      <div className="table-wrap slots-table-wrap">
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
                  <Input value={r.name} maxLength={40} onChange={(e) => setRow(i, { name: e.target.value })} aria-label="Nombre del bloque" />
                </td>
                <td>
                  <Input type="time" value={r.startTime} onChange={(e) => setRow(i, { startTime: e.target.value })} aria-label="Hora de inicio" />
                </td>
                <td>
                  <Input type="time" value={r.endTime} onChange={(e) => setRow(i, { endTime: e.target.value })} aria-label="Hora de fin" />
                </td>
                <td style={{ textAlign: 'center' }}>
                  <input type="checkbox" checked={r.isBreak} onChange={(e) => setRow(i, { isBreak: e.target.checked })} aria-label="Es recreo" />
                </td>
                <td style={{ textAlign: 'right' }}>
                  <Button size="sm" variant="ghost" icon="trash" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Quitar bloque" />
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
      <div className="slots-actions">
        <Button size="sm" variant="ghost" icon="plus" onClick={() => addRow(false)}>
          Agregar bloque
        </Button>
        <Button size="sm" variant="ghost" icon="plus" onClick={() => addRow(true)}>
          Agregar recreo
        </Button>
        {end !== null && (
          <span className="text-sm text-muted slots-actions__summary">
            {rows.filter((r) => !r.isBreak).length} bloques · {rows.filter((r) => r.isBreak).length} recreo(s) · {rows[0] && [...rows].sort((a, b) => toMin(a.startTime) - toMin(b.startTime))[0].startTime}–{toTime(end)}
          </span>
        )}
      </div>
      <p className="text-sm text-muted">{hint}</p>
    </>
  );
}

export default SlotsEditorModal;
