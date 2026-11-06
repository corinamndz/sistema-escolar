import { useEffect, useState } from 'react';
import paymentsApi from '../../../api/endpoints/payments.api';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import Card from '../../../components/ui/Card';
import Button from '../../../components/ui/Button';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { formatMoney, formatDate } from '../paymentStatus';
import { GENERAL_FEE_LABEL, describeFeePlan, effectiveFee, isExempt } from '../feePlans';

/**
 * Ficha del alumno → «Mensualidad»: cuánto paga y con qué tarifa. Por defecto,
 * la tarifa general de su nivel; quien administra pagos puede asignarle una
 * tarifa especial (beca, convenio). Al guardar se recalculan sus mensualidades
 * pendientes desde el mes en curso (las pagadas, reportadas o pasadas no cambian).
 */
function StudentFeeCard({ studentId, canEdit }) {
  const { data: fee, setData: setFee, loading, error } = useFetch(() => paymentsApi.studentFee(studentId), [studentId]);
  const { data: plans } = useFetch(() => (canEdit ? paymentsApi.listFeePlans() : Promise.resolve([])), [canEdit]);
  const [form, setForm] = useState({ planId: '', note: '' });
  const { run, loading: saving, error: saveError, fieldErrors } = useMutation((data) => paymentsApi.assignStudentFeePlan(studentId, data));
  const toast = useToast();

  // El formulario parte de la tarifa guardada (y vuelve a ella tras guardar).
  useEffect(() => {
    if (fee) setForm({ planId: fee.plan?.id || '', note: fee.note || '' });
  }, [fee]);

  if (loading) return <Card title="Mensualidad"><Spinner /></Card>;
  if (error) return <Card title="Mensualidad"><Alert>{error}</Alert></Card>;
  if (!fee) return null;

  const base = fee.base?.amount ?? null;
  const selected = (plans || []).find((p) => p.id === form.planId) || null;
  const dirty = form.planId !== (fee.plan?.id || '') || (form.planId && form.note.trim() !== (fee.note || ''));
  const preview = effectiveFee(base, selected);
  const special = Boolean(fee.plan);

  const save = async () => {
    try {
      const { applied } = await run({ feePlanId: form.planId || null, note: form.planId ? form.note.trim() || null : null });
      const result = await paymentsApi.studentFee(studentId);
      setFee(result);
      const changed = applied.updated + applied.cancelled + applied.reactivated;
      toast.success(
        'Tarifa actualizada',
        changed
          ? `${changed === 1 ? 'Se recalculó 1 mensualidad pendiente' : `Se recalcularon ${changed} mensualidades pendientes`}.`
          : 'Se aplicará a las próximas mensualidades.'
      );
    } catch {
      // error visible en la tarjeta
    }
  };

  return (
    <Card title="Mensualidad" subtitle={fee.enrollment ? `${fee.enrollment.grade_name} ${fee.enrollment.section_name} · ${fee.enrollment.school_period_name}` : 'Tarifa que se cobra a este alumno'}>
      <div className="student-fee">
        <div className={`student-fee__summary ${special ? 'is-special' : ''}`}>
          <span className="student-fee__icon" aria-hidden="true">
            <Icon name={special ? 'graduation' : 'wallet'} size={20} />
          </span>
          <div className="student-fee__amounts">
            {fee.effective_amount !== null ? (
              <span className="student-fee__amount">
                {isExempt(fee.plan) ? 'Exonerado' : formatMoney(fee.effective_amount, 'USD')}
                {!isExempt(fee.plan) && <small> / mes</small>}
              </span>
            ) : (
              <span className="student-fee__amount student-fee__amount--none">Sin monto</span>
            )}
            {special && base !== null && fee.effective_amount !== base && (
              <span className="student-fee__base">
                Tarifa del nivel: <s>{formatMoney(base, 'USD')}</s>
              </span>
            )}
          </div>
          <span className={`student-fee__tag ${special ? 'student-fee__tag--special' : ''}`}>{special ? fee.plan.name : GENERAL_FEE_LABEL}</span>
        </div>

        {special && (
          <p className="student-fee__meta">
            {describeFeePlan(fee.plan)}
            {fee.note && <> · Motivo: <strong>{fee.note}</strong></>}
            {fee.assigned_at && <> · Asignada el {formatDate(fee.assigned_at)}</>}
          </p>
        )}
        {!fee.enrollment && <Alert variant="info">Sin inscripción activa: la tarifa se aplicará a sus mensualidades cuando se inscriba.</Alert>}
        {fee.enrollment && base === null && fee.plan?.kind !== 'fixed' && (
          <Alert variant="warning">No hay tarifa de mensualidad para su nivel en {fee.enrollment.school_period_name}. Configúrala en Pagos → Tarifas.</Alert>
        )}

        {canEdit && (
          <div className="student-fee__editor">
            <Alert>{saveError}</Alert>
            <Field label="Tarifa asignada" error={fieldErrors.feePlanId}>
              <Select value={form.planId} onChange={(e) => setForm((f) => ({ ...f, planId: e.target.value }))}>
                <option value="">
                  {GENERAL_FEE_LABEL}
                  {base !== null ? ` (${formatMoney(base, 'USD')})` : ''}
                </option>
                {(plans || []).map((p) => {
                  const amount = effectiveFee(base, p);
                  return (
                    <option key={p.id} value={p.id}>
                      {p.name} — {describeFeePlan(p)}
                      {amount !== null && !isExempt(p) ? ` → ${formatMoney(amount, 'USD')}` : ''}
                    </option>
                  );
                })}
              </Select>
            </Field>
            {!(plans || []).length && (
              <p className="form-hint">Aún no hay tarifas especiales. Créalas en Pagos → Tarifas → Tarifas especiales.</p>
            )}
            {form.planId && (
              <Field label="Motivo o referencia" hint="Opcional. Ej.: acta de beca, empresa del convenio." error={fieldErrors.note}>
                <Input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} maxLength={200} />
              </Field>
            )}
            {dirty && (
              <div className="student-fee__preview" role="status">
                <Icon name="info" size={16} />
                <span>
                  {isExempt(selected) ? (
                    <>Quedará <strong>exonerado</strong>: se anulan sus mensualidades pendientes</>
                  ) : (
                    <>
                      Nuevo monto: <strong>{preview !== null ? `${formatMoney(preview, 'USD')} / mes` : 'según la tarifa del nivel'}</strong>. Se aplica a
                      {fee.upcoming_months ? ` ${fee.upcoming_months === 1 ? 'la mensualidad pendiente' : `las ${fee.upcoming_months} mensualidades pendientes`}` : ' las mensualidades'}
                    </>
                  )}{' '}
                  desde el mes en curso. Las pagadas, reportadas o de meses anteriores no cambian.
                </span>
              </div>
            )}
            {dirty && (
              <div className="student-fee__actions">
                <Button type="button" variant="secondary" size="sm" onClick={() => setForm({ planId: fee.plan?.id || '', note: fee.note || '' })}>
                  Cancelar
                </Button>
                <Button type="button" size="sm" icon="check" loading={saving} onClick={save}>
                  Guardar tarifa
                </Button>
              </div>
            )}
          </div>
        )}

        <PaymentAgreement studentId={studentId} fee={fee} canEdit={canEdit} onSaved={setFee} />
      </div>
    </Card>
  );
}

/**
 * Plazo de pago del alumno: el estándar de su nivel (vence el día N) o un
 * ACUERDO especial con días de gracia adicionales (1–60). El acuerdo corre la
 * fecha límite de sus mensualidades pendientes desde el mes en curso.
 */
function PaymentAgreement({ studentId, fee, canEdit, onSaved }) {
  const agreement = fee.agreement;
  const dueDay = fee.base?.due_day || null;
  const [editing, setEditing] = useState(false);
  const [days, setDays] = useState(agreement?.grace_days ? String(agreement.grace_days) : '');
  const [note, setNote] = useState(agreement?.note || '');
  const { run, loading, error, fieldErrors } = useMutation((data) => paymentsApi.setPaymentAgreement(studentId, data));
  const toast = useToast();

  useEffect(() => {
    setDays(agreement?.grace_days ? String(agreement.grace_days) : '');
    setNote(agreement?.note || '');
  }, [agreement?.grace_days, agreement?.note]);

  const n = Number(days);
  const valid = Number.isInteger(n) && n >= 1 && n <= 60;
  const save = async (graceDays) => {
    try {
      const r = await run({ graceDays, note: graceDays ? note.trim() || null : null });
      onSaved(r.fee);
      setEditing(false);
      toast.success(
        graceDays ? `Acuerdo de pago: +${graceDays} días` : 'Plazo estándar restablecido',
        r.updated ? `Se ajustó la fecha límite de ${r.updated === 1 ? '1 mensualidad pendiente' : `${r.updated} mensualidades pendientes`}.` : 'Se aplicará a las próximas mensualidades.'
      );
    } catch {
      // error visible en la sección
    }
  };

  return (
    <div className={`fee-agreement ${agreement ? 'is-active' : ''}`}>
      <div className="fee-agreement__head">
        <span className="fee-agreement__icon" aria-hidden="true">
          <Icon name={agreement ? 'calendar' : 'clock'} size={18} />
        </span>
        <div className="fee-agreement__text">
          <strong>Plazo de pago</strong>
          <span>
            {agreement ? (
              <>
                Acuerdo especial: <strong>{agreement.grace_days} día{agreement.grace_days === 1 ? '' : 's'} de gracia</strong>
                {dueDay ? ` (vence el día ${dueDay + agreement.grace_days <= 28 ? dueDay + agreement.grace_days : `${dueDay} + ${agreement.grace_days} días`} en lugar del ${dueDay})` : ''}
                {agreement.note && <> · {agreement.note}</>}
              </>
            ) : dueDay ? (
              `Estándar del nivel: vence el día ${dueDay} de cada mes.`
            ) : (
              'Estándar del nivel.'
            )}
          </span>
        </div>
        {agreement && <span className="fee-agreement__badge">Acuerdo de pago · +{agreement.grace_days} días</span>}
        {canEdit && !editing && (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            {agreement ? 'Cambiar' : 'Dar plazo especial'}
          </Button>
        )}
      </div>

      {canEdit && editing && (
        <div className="fee-agreement__form">
          <Alert>{error}</Alert>
          <div className="fee-agreement__fields">
            <Field label="Días de gracia adicionales" error={fieldErrors.graceDays} hint={dueDay && valid ? `Vencerá ${n} día${n === 1 ? '' : 's'} después del día ${dueDay}.` : 'Entre 1 y 60 días.'}>
              <Input type="number" min="1" max="60" step="1" value={days} onChange={(e) => setDays(e.target.value)} autoFocus />
            </Field>
            <Field label="Motivo o referencia" hint="Opcional. Ej.: acuerdo firmado, situación familiar." error={fieldErrors.note}>
              <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
            </Field>
          </div>
          <p className="form-hint">
            Se corre la fecha límite de sus mensualidades pendientes desde el mes en curso (si la de este mes estaba vencida, deja de estarlo). Las pagadas y las de meses anteriores no cambian.
          </p>
          <div className="student-fee__actions">
            {agreement && (
              <Button type="button" variant="ghost" size="sm" onClick={() => save(null)} disabled={loading} style={{ marginRight: 'auto' }}>
                Quitar acuerdo
              </Button>
            )}
            <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(false)} disabled={loading}>
              Cancelar
            </Button>
            <Button type="button" size="sm" icon="check" loading={loading} disabled={!valid} onClick={() => save(n)}>
              Guardar plazo
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default StudentFeeCard;
