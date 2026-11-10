import { useState } from 'react';
import carryoversApi from '../../../api/endpoints/carryovers.api';
import { getErrorMessage, getFieldErrors } from '../../../api/axiosClient';
import Drawer from '../../../components/ui/Drawer';
import Button from '../../../components/ui/Button';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import MomentTimeline, { CARRYOVER_STATUS, fmtDate, fmtGrade } from './MomentTimeline';

const isGraded = (m) => ['passed', 'failed'].includes(m.status);
let nextKey = 0;
const newKey = () => {
  nextKey += 1;
  return `m${nextKey}`;
};

const MAX_MOMENTS = 12;
const newRow = (n, passing) => ({ key: newKey(), name: `Momento ${n}`, description: '', scheduledOn: '', passingGrade: String(passing) });
const parseGrade = (v) => (String(v).trim() === '' ? null : Number(String(v).replace(',', '.')));

/**
 * Plan de evaluación especial: cuántos momentos y, en cada uno, su nombre, qué
 * se evaluará, la fecha estimada y la nota mínima para aprobarlo (la del año o
 * más alta). Edita solo los momentos aún sin calificar; los calificados quedan.
 */
function PlanEditor({ carryover, onCancel, onSaved }) {
  const official = carryover.passing_grade;
  const pending = carryover.moments.filter((m) => !isGraded(m));
  const gradedCount = carryover.moments.length - pending.length;
  const room = MAX_MOMENTS - gradedCount;
  const [rows, setRows] = useState(() =>
    pending.length
      ? pending.map((m) => ({ key: m.id, name: m.name, description: m.description || '', scheduledOn: m.scheduled_on ? String(m.scheduled_on).slice(0, 10) : '', passingGrade: String(m.passing_grade ?? official) }))
      : [1, 2, 3].slice(0, Math.max(1, Math.min(3, room))).map((i) => newRow(gradedCount + i, official))
  );
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const patch = (key, values) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...values } : r)));
  const move = (i, delta) =>
    setRows((list) => {
      const next = [...list];
      const [item] = next.splice(i, 1);
      next.splice(i + delta, 0, item);
      return next;
    });
  // Cantidad de momentos: agrega al final o quita los últimos.
  const setCount = (n) => setRows((list) => (n > list.length ? [...list, ...Array.from({ length: n - list.length }, (_, i) => newRow(gradedCount + list.length + i + 1, official))] : list.slice(0, n)));

  // Validación local, con los mismos límites que el servidor.
  const localErrors = {};
  rows.forEach((r, i) => {
    if (!r.name.trim()) localErrors[`moments.${i}.name`] = 'Escribe el nombre del momento.';
    const g = parseGrade(r.passingGrade);
    if (g === null || !Number.isFinite(g) || g < 0 || g > 20) localErrors[`moments.${i}.passingGrade`] = 'Entre 0 y 20.';
    else if (g < official) localErrors[`moments.${i}.passingGrade`] = `No puede ser menor que ${fmtGrade(official)}, la mínima del año.`;
  });
  const shown = errors;

  const save = async (e) => {
    e.preventDefault();
    if (Object.keys(localErrors).length) {
      setErrors(localErrors);
      return;
    }
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      const saved = await carryoversApi.savePlan(
        carryover.id,
        rows.map((r) => ({ name: r.name.trim(), description: r.description.trim() || null, scheduledOn: r.scheduledOn || null, passingGrade: parseGrade(r.passingGrade) }))
      );
      toast.success('Plan de evaluación especial guardado', `${carryover.subject_name}: ${saved.moments.length} momento${saved.moments.length === 1 ? '' : 's'}. ${saved.moments.find((m) => m.status === 'open')?.name || ''} queda habilitado para calificar.`);
      onSaved();
    } catch (err) {
      setErrors(getFieldErrors(err));
      setFormError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} noValidate className="cm-plan">
      <Alert>{formError}</Alert>
      <p className="text-sm text-muted">
        Cada momento es una oportunidad completa de aprobar la materia, no una parte de la nota. Se presentan en orden: el siguiente se habilita solo si el alumno reprueba el anterior.
        {gradedCount > 0 && ` Los ${gradedCount} ya calificados no cambian; aquí defines los que siguen.`}
      </p>
      <div className="cm-plan__count">
        <Field label={gradedCount ? 'Momentos por presentar' : 'Cantidad de momentos'} hint={`Máximo ${MAX_MOMENTS} en total.`}>
          <Select value={rows.length} onChange={(e) => setCount(Number(e.target.value))}>
            {Array.from({ length: room }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n} momento{n === 1 ? '' : 's'}
              </option>
            ))}
          </Select>
        </Field>
        <p className="cm-plan__official">
          <Icon name="info" size={15} />
          <span>
            Nota mínima del año: <strong>{fmtGrade(official)}</strong>. Un momento puede exigir más, no menos.
          </span>
        </p>
      </div>
      <ol className="cm-plan__rows">
        {rows.map((r, i) => {
          const err = (k) => shown[`moments.${i}.${k}`];
          return (
            <li key={r.key} className="cm-plan__row">
              <span className="cm-plan__n" aria-hidden="true">
                {gradedCount + i + 1}
              </span>
              <div className="cm-plan__fields">
                <Field label="Nombre del momento" required error={err('name')}>
                  <Input value={r.name} onChange={(e) => patch(r.key, { name: e.target.value })} maxLength={80} placeholder="Ej.: Recuperación parcial" />
                </Field>
                <Field label="Fecha estimada" error={err('scheduledOn')}>
                  <Input type="date" value={r.scheduledOn} onChange={(e) => patch(r.key, { scheduledOn: e.target.value })} />
                </Field>
                <Field label="Nota mínima para aprobar" required error={err('passingGrade')}>
                  <Input type="number" inputMode="decimal" min={official} max={20} step="0.01" value={r.passingGrade} onChange={(e) => patch(r.key, { passingGrade: e.target.value })} />
                </Field>
                <Field label="Estrategia de evaluación" error={err('description')} hint={`Qué contendrá la prueba o el trabajo. ${r.description.length}/500`}>
                  <textarea className="input cm-plan__text" rows={2} value={r.description} onChange={(e) => patch(r.key, { description: e.target.value })} maxLength={500} placeholder="Ej.: Prueba escrita de análisis de textos y ortografía." />
                </Field>
              </div>
              <span className="ep-row__actions">
                <button type="button" className="ep-icon" onClick={() => move(i, -1)} disabled={i === 0} title="Subir" aria-label={`Subir ${r.name || 'momento'}`}>
                  <Icon name="chevronUp" size={15} />
                </button>
                <button type="button" className="ep-icon" onClick={() => move(i, 1)} disabled={i === rows.length - 1} title="Bajar" aria-label={`Bajar ${r.name || 'momento'}`}>
                  <Icon name="chevronDown" size={15} />
                </button>
                <button type="button" className="ep-icon is-danger" onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))} disabled={rows.length === 1 && gradedCount === 0} title="Quitar" aria-label={`Quitar ${r.name || 'momento'}`}>
                  <Icon name="trash" size={15} />
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <div className="form-actions ep-list__actions">
        <Button type="button" variant="ghost" icon="plus" disabled={gradedCount + rows.length >= MAX_MOMENTS} onClick={() => setCount(rows.length + 1)}>
          Agregar momento
        </Button>
        <span className="cm-plan__save">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" icon="check" loading={saving}>
            Guardar plan
          </Button>
        </span>
      </div>
    </form>
  );
}

/** Calificar el momento abierto o corregir el último calificado. */
function GradeForm({ moment, carryover, correcting, onCancel, onSaved }) {
  const [grade, setGrade] = useState(correcting ? String(moment.grade) : '');
  const [notes, setNotes] = useState(correcting ? moment.notes || '' : '');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const value = grade === '' ? null : Number(String(grade).replace(',', '.'));
  const valid = value !== null && Number.isFinite(value) && value >= 0 && value <= 20;
  const passing = moment.passing_grade ?? carryover.passing_grade;
  const passes = valid && value >= passing;
  const later = carryover.moments.filter((m) => m.position > moment.position);

  const submit = async (e) => {
    e.preventDefault();
    if (!valid) {
      setErrors({ grade: 'Entre 0 y 20.' });
      return;
    }
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      const saved = await carryoversApi.grade(moment.id, { grade: value, notes: notes.trim() || null });
      const msg = {
        passed: 'La materia queda liberada.',
        in_progress: `Se habilitó ${saved.moments.find((m) => m.status === 'open')?.name || 'el siguiente momento'}.`,
        failed: 'Completó el plan sin aprobar.',
      }[saved.status];
      toast.success(correcting ? 'Nota corregida' : 'Nota registrada', msg);
      onSaved();
    } catch (err) {
      setErrors(getFieldErrors(err));
      setFormError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="cm-grade">
      <Alert>{formError}</Alert>
      <div className="cm-grade__fields">
        <Field label={`Nota (0 a 20; este momento se aprueba con ${fmtGrade(passing)})`} required error={errors.grade}>
          <Input type="number" inputMode="decimal" min={0} max={20} step="0.01" value={grade} onChange={(e) => setGrade(e.target.value)} autoFocus={correcting} />
        </Field>
        <Field label="Observación" error={errors.notes}>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="Opcional" />
        </Field>
      </div>
      {valid && (
        <p className={`cm-grade__effect ${passes ? 'is-pass' : 'is-fail'}`}>
          <Icon name={passes ? 'checkCircle' : 'alertTriangle'} size={14} />
          {passes ? 'Aprueba: se cierra la pendencia y la materia queda liberada.' : later.length ? `Reprueba: se habilitará ${later[0].name}.` : 'Reprueba: es el último momento, la pendencia queda no aprobada.'}
        </p>
      )}
      <div className="cm-grade__actions">
        {correcting && (
          <Button type="button" size="sm" variant="secondary" onClick={onCancel} disabled={saving}>
            Cancelar
          </Button>
        )}
        <Button type="submit" size="sm" icon="check" loading={saving} disabled={!valid}>
          {correcting ? 'Corregir nota' : 'Registrar nota'}
        </Button>
      </div>
    </form>
  );
}

/** Materia pendiente: plan especial, notas y, para la dirección, anular o restaurar. */
function CarryoverDrawer({ carryover: c, canManage, onClose, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  const status = CARRYOVER_STATUS[c.status];
  const live = ['pending', 'in_progress'].includes(c.status);
  const closedFailed = c.status === 'failed';
  const lastGraded = [...c.moments].reverse().find(isGraded);
  const canGrade = live || c.status === 'passed' || closedFailed;
  const canPlan = live || (closedFailed && canManage);

  const changed = () => {
    setEditing(false);
    setCorrecting(false);
    setCancelling(false);
    onChanged();
  };

  const doCancel = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await carryoversApi.cancel(c.id, reason.trim());
      toast.success('Materia pendiente anulada', c.subject_name);
      changed();
    } catch (err) {
      toast.error('No se pudo anular', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const doReinstate = async () => {
    if (!(await confirm({ title: `¿Restaurar ${c.subject_name}?`, message: 'La materia pendiente vuelve a estar abierta donde iba.', confirmLabel: 'Restaurar' }))) return;
    try {
      await carryoversApi.reinstate(c.id);
      toast.success('Materia pendiente restaurada', c.subject_name);
      changed();
    } catch (err) {
      toast.error('No se pudo restaurar', getErrorMessage(err));
    }
  };

  return (
    <Drawer title={c.subject_name} subtitle={`${c.first_name} ${c.last_name}`} icon="refresh" size="lg" onClose={onClose}>
      <dl className="cm-facts">
        <div>
          <dt>Estado</dt>
          <dd>
            <Badge variant={status.variant}>{status.label}</Badge>
          </dd>
        </div>
        <div>
          <dt>Reprobada en</dt>
          <dd>
            {c.source_grade_name} · {c.source_period_name} · nota {fmtGrade(c.source_final_grade)}
          </dd>
        </div>
        <div>
          <dt>Cursa ahora</dt>
          <dd>{c.current_grade_name ? `${c.current_grade_name} ${c.current_section_name} · ${c.current_period_name}` : '—'}</dd>
        </div>
        <div>
          <dt>Profesor</dt>
          <dd>{c.teacher_name || 'Sin asignar'}</dd>
        </div>
        {c.final_grade !== null && (
          <div>
            <dt>Nota final</dt>
            <dd>
              <strong>{fmtGrade(c.final_grade)}</strong> · {fmtDate(c.resolved_at)}
            </dd>
          </div>
        )}
      </dl>
      {c.status === 'cancelled' && <Alert variant="info">Anulada. Motivo: {c.cancel_reason}</Alert>}
      {c.status === 'suspended' && <Alert variant="warning">El alumno está retirado. La materia sigue donde iba cuando se reactive.</Alert>}
      {closedFailed && <Alert variant="warning">Completó el plan sin aprobar. {canManage ? 'Puedes agregar más momentos o anular la pendencia.' : 'La dirección o la coordinación indicarán cómo continuar.'}</Alert>}

      <div className="cm-section-head">
        <h3 className="card__title">Plan de evaluación especial</h3>
        {canPlan && !editing && c.moments.length > 0 && (
          <Button size="sm" variant="secondary" icon="pencil" onClick={() => setEditing(true)}>
            Configurar momentos
          </Button>
        )}
      </div>

      {editing ? (
        <PlanEditor carryover={c} onCancel={() => setEditing(false)} onSaved={changed} />
      ) : c.moments.length ? (
        <MomentTimeline
          moments={c.moments}
          renderExtra={(m) => {
            if (!canGrade) return null;
            if (m.status === 'open') return <GradeForm key={m.id} moment={m} carryover={c} onSaved={changed} />;
            if (lastGraded?.id !== m.id) return m.grade_history?.length ? <p className="cm-step__text">Nota corregida {m.grade_history.length} vez/veces.</p> : null;
            return (
              <>
                {m.grade_history?.length > 0 && (
                  <p className="cm-step__text">
                    Antes: {m.grade_history.map((h) => `${fmtGrade(h.grade)}${h.by ? ` (${h.by})` : ''}`).join(', ')}
                  </p>
                )}
                {m.graded_by_name && <p className="cm-step__text">Calificó {m.graded_by_name}, {fmtDate(m.graded_at)}.</p>}
                {correcting ? (
                  <GradeForm key={m.id} moment={m} carryover={c} correcting onCancel={() => setCorrecting(false)} onSaved={changed} />
                ) : (
                  <button type="button" className="link-button" onClick={() => setCorrecting(true)}>
                    Corregir nota
                  </button>
                )}
              </>
            );
          }}
        />
      ) : (
        <div className="cm-plan-empty">
          <Icon name="clipboard" size={22} />
          <div>
            <strong>Aún no tiene plan de evaluación especial</strong>
            <span>{canPlan ? 'Define cuántos momentos tendrá, qué se evaluará en cada uno, su fecha estimada y la nota para aprobarlo.' : c.teacher_name ? 'El profesor aún no ha definido los momentos.' : 'Asígnale un profesor para que diseñe el plan.'}</span>
          </div>
          {canPlan && (
            <Button size="sm" icon="plus" onClick={() => setEditing(true)}>
              Configurar momentos
            </Button>
          )}
        </div>
      )}

      {canManage && (live || closedFailed) && !cancelling && (
        <div className="cm-danger">
          <button type="button" className="link-button" onClick={() => setCancelling(true)}>
            Anular esta materia pendiente
          </button>
        </div>
      )}
      {cancelling && (
        <form onSubmit={doCancel} className="cm-grade">
          <Field label="Motivo de la anulación" required hint="Por ejemplo, una equivalencia o un error de carga. Queda registrado.">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} autoFocus />
          </Field>
          <div className="cm-grade__actions">
            <Button type="button" size="sm" variant="secondary" onClick={() => setCancelling(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" variant="danger" loading={busy} disabled={reason.trim().length < 5}>
              Anular
            </Button>
          </div>
        </form>
      )}
      {canManage && c.status === 'cancelled' && (
        <div className="cm-danger">
          <button type="button" className="link-button" onClick={doReinstate}>
            Restaurar materia pendiente
          </button>
        </div>
      )}
    </Drawer>
  );
}

export default CarryoverDrawer;
