import { useEffect, useState } from 'react';
import { axiosClient, getErrorMessage, getFieldErrors } from '../../../api/axiosClient';
import { useFetch } from '../../../hooks/useFetch';
import { useAcademicYear } from '../../../context/AcademicYearContext';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Field from '../../../components/ui/Field';
import Icon from '../../../components/ui/Icon';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Spinner from '../../../components/ui/Spinner';
import { useToast } from '../../../components/ui/Toast';

const NOUNS = ['Lapso', 'Trimestre', 'Bimestre', 'Cuatrimestre', 'Semestre', 'Momento', 'Corte'];
const ymd = (d) => (d ? String(d).slice(0, 10) : '');
let nextKey = 0;
const newKey = () => {
  nextKey += 1;
  return `n${nextKey}`;
};
const toRow = (t) => ({ key: t.id, id: t.id, name: t.name, startDate: ymd(t.start_date), endDate: ymd(t.end_date), used: t.plan_count + t.sanction_count + t.adjustment_count, plans: t.plan_count, closed: Boolean(t.closed_at) });

/** Reparte el año escolar en `n` tramos iguales → [{ startDate, endDate }]; vacío si el año no tiene fechas. */
function splitYear(start, end, n) {
  if (!start || !end) return [];
  const from = new Date(`${start}T00:00:00Z`).getTime();
  const to = new Date(`${end}T00:00:00Z`).getTime();
  const DAY = 86400000;
  const days = Math.round((to - from) / DAY) + 1;
  if (days < n) return [];
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  return Array.from({ length: n }, (_, i) => ({
    startDate: iso(from + Math.floor((days * i) / n) * DAY),
    endDate: iso(from + (Math.floor((days * (i + 1)) / n) - 1) * DAY),
  }));
}

/**
 * Configuración → Períodos de evaluación (Administrador o Coordinador): cuántos
 * cortes tiene el año elegido en la barra superior, cómo se llaman y sus fechas.
 * Nada se guarda hasta pulsar «Guardar»; el servidor valida la lista completa.
 */
function EvaluationPeriodsTab() {
  const { periodId, currentId } = useAcademicYear();
  const yearId = periodId || currentId;
  const { data, loading, error, refetch } = useFetch(() => (yearId ? axiosClient.get(`/school-years/${yearId}/evaluation-periods`).then((r) => r.data) : Promise.resolve(null)), [yearId]);
  const [rows, setRows] = useState([]);
  const [noun, setNoun] = useState('Lapso');
  const [count, setCount] = useState(3);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!data) return;
    setRows(data.terms.map(toRow));
    setCount(data.terms.length || 3);
    setErrors({});
    setFormError(null);
  }, [data]);

  if (loading) return <Spinner label="Cargando períodos…" />;
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Alert variant="info">Crea un año escolar para configurar sus períodos.</Alert>;

  const year = data.school_period;
  const max = data.max_terms;
  const readOnly = year.closed;
  const patch = (key, values) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...values } : r)));
  const move = (i, delta) =>
    setRows((list) => {
      const next = [...list];
      const [item] = next.splice(i, 1);
      next.splice(i + delta, 0, item);
      return next;
    });
  const add = () => setRows((list) => [...list, { key: newKey(), name: '', startDate: '', endDate: '', used: 0, plans: 0, closed: false }]);

  /** Arma la lista con un nombre y una cantidad; conserva lo que ya tiene planes u otros datos. */
  const generate = () => {
    const n = Math.max(1, Math.min(max, Number(count) || 1));
    const dates = splitYear(year.start_date, year.end_date, n);
    setRows((list) => {
      const used = list.filter((r) => r.used);
      const free = list.filter((r) => !r.used);
      const total = Math.max(n, used.length); // los períodos con datos no se quitan aquí
      const base = [...list.filter((r) => r.used || free.indexOf(r) < n - used.length)];
      while (base.length < total) base.push({ key: newKey(), used: 0, plans: 0, closed: false });
      return base.map((r, i) => ({ ...r, name: `${noun} ${i + 1}`, ...(dates[i] || { startDate: r.startDate || '', endDate: r.endDate || '' }) }));
    });
    setErrors({});
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    setErrors({});
    setWarnings([]);
    try {
      const body = { terms: rows.map((r) => ({ ...(r.id ? { id: r.id } : {}), name: r.name || '', startDate: r.startDate || null, endDate: r.endDate || null })) };
      const res = await axiosClient.put(`/school-years/${yearId}/evaluation-periods`, body).then((r) => r.data);
      setWarnings(res.warnings || []);
      toast.success('Períodos guardados', `${year.name}: ${rows.length} período${rows.length === 1 ? '' : 's'}.`);
      refetch();
    } catch (err) {
      setErrors(getFieldErrors(err));
      setFormError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <p className="ep-year">
        <Icon name="calendar" size={15} />
        <span>
          Año escolar <strong>{year.name}</strong>. Cada año se configura por separado: para cambiarlo, usa el selector de la barra superior.
        </span>
      </p>
      {readOnly && <Alert variant="info">Este año escolar está finalizado: sus períodos ya no se pueden cambiar.</Alert>}

      {!readOnly && (
        <section className="card ep-generator">
          <h3 className="card__title">Generar rápidamente</h3>
          <p className="text-sm text-muted">Pone el nombre y la cantidad, y reparte las fechas del año escolar en partes iguales. Después puedes ajustar cada período. No se guarda hasta pulsar «Guardar».</p>
          <div className="ep-generator__row">
            <Field label="Nombre">
              <Input list="ep-nouns" value={noun} onChange={(e) => setNoun(e.target.value)} maxLength={50} />
              <datalist id="ep-nouns">
                {NOUNS.map((x) => (
                  <option key={x} value={x} />
                ))}
              </datalist>
            </Field>
            <Field label="Cantidad">
              <Select value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="button" variant="secondary" icon="refresh" onClick={generate} disabled={!noun.trim()}>
              Generar
            </Button>
          </div>
        </section>
      )}

      <form onSubmit={save} noValidate className="card ep-list">
        <Alert>{formError}</Alert>
        {warnings.map((w) => (
          <Alert key={w} variant="warning">
            {w}
          </Alert>
        ))}
        {year.weighted && <p className="form-hint">Este año usa promedio ponderado: si cambias la cantidad de períodos, revisa sus pesos en la normativa de evaluación.</p>}
        <ol className="ep-rows">
          {rows.map((r, i) => (
            <li key={r.key} className="ep-row">
              <span className="ep-row__pos">{i + 1}</span>
              <Field label="Nombre" required error={errors[`terms.${i}.name`]}>
                <Input value={r.name} onChange={(e) => patch(r.key, { name: e.target.value })} maxLength={60} placeholder="Ej.: Trimestre 1" disabled={readOnly} />
              </Field>
              <Field label="Inicio" required error={errors[`terms.${i}.startDate`]}>
                <Input type="date" value={r.startDate} onChange={(e) => patch(r.key, { startDate: e.target.value })} disabled={readOnly} />
              </Field>
              <Field label="Fin" required error={errors[`terms.${i}.endDate`]}>
                <Input type="date" value={r.endDate} onChange={(e) => patch(r.key, { endDate: e.target.value })} disabled={readOnly} />
              </Field>
              <div className="ep-row__side">
                <span className="text-sm text-muted">
                  {r.plans ? `${r.plans} plan${r.plans === 1 ? '' : 'es'}` : 'Sin planes'}
                  {r.closed ? ' · cerrado' : ''}
                </span>
                {!readOnly && (
                  <span className="ep-row__actions">
                    <button type="button" className="ep-icon" onClick={() => move(i, -1)} disabled={i === 0} title="Subir" aria-label={`Subir ${r.name || 'período'}`}>
                      <Icon name="chevronUp" size={15} />
                    </button>
                    <button type="button" className="ep-icon" onClick={() => move(i, 1)} disabled={i === rows.length - 1} title="Bajar" aria-label={`Bajar ${r.name || 'período'}`}>
                      <Icon name="chevronDown" size={15} />
                    </button>
                    <button
                      type="button"
                      className="ep-icon is-danger"
                      onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))}
                      disabled={r.used > 0 || rows.length === 1}
                      title={r.used > 0 ? 'Tiene planes, sanciones o ajustes: no se puede eliminar' : 'Eliminar'}
                      aria-label={`Eliminar ${r.name || 'período'}`}
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
        {!readOnly && (
          <div className="form-actions ep-list__actions">
            <Button type="button" variant="ghost" icon="plus" onClick={add} disabled={rows.length >= max}>
              Agregar período
            </Button>
            <Button type="submit" icon="check" loading={saving}>
              Guardar
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}

export default EvaluationPeriodsTab;
