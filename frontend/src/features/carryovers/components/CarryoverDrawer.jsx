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

/** Editor del plan: los momentos aún sin calificar, en orden. Los ya calificados no se tocan. */
function PlanEditor({ carryover, onCancel, onSaved }) {
  const pending = carryover.moments.filter((m) => !isGraded(m));
  const gradedCount = carryover.moments.length - pending.length;
  const [rows, setRows] = useState(() =>
    pending.length
      ? pending.map((m) => ({ key: m.id, name: m.name, description: m.description || '', scheduledOn: m.scheduled_on ? String(m.scheduled_on).slice(0, 10) : '' }))
      : [{ key: newKey(), name: `Momento ${gradedCount + 1}`, description: '', scheduledOn: '' }]
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

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      const saved = await carryoversApi.savePlan(
        carryover.id,
        rows.map((r) => ({ name: r.name, description: r.description || null, scheduledOn: r.scheduledOn || null }))
      );
      toast.success('Plan especial guardado', `${carryover.subject_name}: ${saved.moments.length} momento${saved.moments.length === 1 ? '' : 's'}`);
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
        Define cuántos momentos necesita este alumno; no dependen de los períodos del colegio. Se presentan en orden: el siguiente se habilita solo si reprueba el anterior.
        {gradedCount > 0 && ` Los ${gradedCount} ya calificados no se pueden cambiar.`}
      </p>
      <ol className="cm-plan__rows">
        {rows.map((r, i) => (
          <li key={r.key} className="cm-plan__row">
            <div className="cm-plan__fields">
              <Field label={`Momento ${gradedCount + i + 1}`} required error={errors[`moments.${i}.name`]}>
                <Input value={r.name} onChange={(e) => patch(r.key, { name: e.target.value })} maxLength={80} placeholder="Ej.: Prueba escrita" />
              </Field>
              <Field label="Fecha" error={errors[`moments.${i}.scheduledOn`]}>
                <Input type="date" value={r.scheduledOn} onChange={(e) => patch(r.key, { scheduledOn: e.target.value })} />
              </Field>
              <Field label="Qué se evaluará" full error={errors[`moments.${i}.description`]}>
                <Input value={r.description} onChange={(e) => patch(r.key, { description: e.target.value })} maxLength={500} placeholder="Opcional" />
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
        ))}
      </ol>
      <div className="form-actions ep-list__actions">
        <Button type="button" variant="ghost" icon="plus" disabled={gradedCount + rows.length >= 12} onClick={() => setRows((list) => [...list, { key: newKey(), name: `Momento ${gradedCount + list.length + 1}`, description: '', scheduledOn: '' }])}>
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
  const passes = valid && value >= carryover.passing_grade;
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
        <Field label={`Nota (0 a 20; se aprueba con ${fmtGrade(carryover.passing_grade)})`} required error={errors.grade}>
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
        <h3 className="card__title">Plan especial</h3>
        {canPlan && !editing && (
          <Button size="sm" variant="secondary" icon="pencil" onClick={() => setEditing(true)}>
            {c.moments.length ? 'Editar momentos' : 'Diseñar plan'}
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
        <p className="text-sm text-muted">{c.teacher_name ? 'Aún no se han definido los momentos de recuperación.' : 'Asígnale un profesor para que diseñe el plan.'}</p>
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
