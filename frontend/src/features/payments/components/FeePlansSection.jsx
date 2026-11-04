import { useState } from 'react';
import paymentsApi from '../../../api/endpoints/payments.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import Button from '../../../components/ui/Button';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { useToast } from '../../../components/ui/Toast';
import { FEE_PLAN_KINDS, describeFeePlan, isExempt } from '../feePlans';

/**
 * Catálogo de tarifas especiales (becas, convenios, descuentos), dentro del
 * panel «Tarifas de mensualidad». Se asignan a cada alumno desde su ficha.
 * Editar el valor de una tarifa en uso recalcula las mensualidades pendientes
 * de sus alumnos (desde el mes en curso).
 */
function FeePlansSection({ canEdit = true }) {
  const { data: plans, loading, error, refetch } = useFetch(() => paymentsApi.listFeePlans(), []);
  const [editing, setEditing] = useState(null); // null | 'new' | id
  const confirm = useConfirm();
  const toast = useToast();

  const remove = async (plan) => {
    const ok = await confirm({
      title: `¿Eliminar «${plan.name}»?`,
      message: 'La tarifa dejará de estar disponible. Las mensualidades ya generadas no cambian.',
      confirmLabel: 'Eliminar',
      danger: true,
      icon: 'trash',
    });
    if (!ok) return;
    try {
      await paymentsApi.deleteFeePlan(plan.id);
      toast.success('Tarifa eliminada', plan.name);
      refetch();
    } catch (err) {
      toast.error('No se pudo eliminar', getErrorMessage(err));
    }
  };

  return (
    <section className="fee-plans">
      <div className="fee-plans__head">
        <div>
          <h3 className="fee-plans__title">Tarifas especiales</h3>
          <p className="fee-plans__intro">
            Becas, convenios y descuentos. Cada alumno usa por defecto la <strong>tarifa general de su nivel</strong>; desde su ficha se le puede asignar una de estas.
          </p>
        </div>
        {canEdit && editing !== 'new' && (
          <Button size="sm" icon="plus" onClick={() => setEditing('new')}>
            Nueva tarifa
          </Button>
        )}
      </div>

      <Alert>{error}</Alert>
      {loading ? (
        <Spinner />
      ) : (
        <ul className="fee-plans__list">
          {editing === 'new' && (
            <li>
              <FeePlanForm
                onCancel={() => setEditing(null)}
                onSaved={() => {
                  setEditing(null);
                  refetch();
                }}
              />
            </li>
          )}
          {plans.map((plan) =>
            editing === plan.id ? (
              <li key={plan.id}>
                <FeePlanForm
                  plan={plan}
                  onCancel={() => setEditing(null)}
                  onSaved={() => {
                    setEditing(null);
                    refetch();
                  }}
                />
              </li>
            ) : (
              <li key={plan.id} className="fee-plan">
                <span className={`fee-plan__icon ${plan.kind === 'fixed' ? 'fee-plan__icon--fixed' : ''}`} aria-hidden="true">
                  {plan.kind === 'fixed' ? '$' : '%'}
                </span>
                <div className="fee-plan__body">
                  <strong className="fee-plan__name">{plan.name}</strong>
                  <span className="fee-plan__meta">
                    <span className={`fee-plan__value ${isExempt(plan) ? 'is-exempt' : ''}`}>{describeFeePlan(plan)}</span>
                    <span>·</span>
                    <span>{plan.student_count === 1 ? '1 alumno' : `${plan.student_count} alumnos`}</span>
                  </span>
                  {plan.description && <span className="fee-plan__desc">{plan.description}</span>}
                </div>
                {canEdit && (
                  <div className="row-actions">
                    <button type="button" className="row-action" onClick={() => setEditing(plan.id)} title="Editar" aria-label={`Editar ${plan.name}`}>
                      <Icon name="pencil" size={15} />
                    </button>
                    <button
                      type="button"
                      className="row-action row-action--delete"
                      onClick={() => remove(plan)}
                      title={plan.student_count ? 'Asignada a alumnos: cámbiales la tarifa antes de eliminarla' : 'Eliminar'}
                      aria-label={`Eliminar ${plan.name}`}
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                )}
              </li>
            )
          )}
          {!plans.length && editing !== 'new' && (
            <li className="fee-plans__empty">Aún no hay tarifas especiales. Crea una para becas o convenios (ej. «Beca 50 %», «Convenio Empresa»).</li>
          )}
        </ul>
      )}
    </section>
  );
}

function FeePlanForm({ plan, onCancel, onSaved }) {
  const [form, setForm] = useState({
    name: plan?.name || '',
    kind: plan?.kind || 'percentage',
    value: plan ? String(Number(plan.kind === 'fixed' ? plan.amount : plan.percentage)) : '',
    description: plan?.description || '',
  });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const { run, loading, error, fieldErrors } = useMutation((data) => (plan ? paymentsApi.updateFeePlan(plan.id, data) : paymentsApi.createFeePlan(data)));
  const toast = useToast();

  const value = Number(form.value);
  const invalid = form.name.trim().length < 2 || !(value > 0) || (form.kind === 'percentage' && value > 100);

  const submit = async (e) => {
    e.preventDefault();
    try {
      const result = await run({
        name: form.name.trim(),
        kind: form.kind,
        percentage: form.kind === 'percentage' ? value : null,
        amount: form.kind === 'fixed' ? value : null,
        description: form.description.trim() || null,
      });
      const r = result?.recalculated;
      toast.success(
        plan ? 'Tarifa actualizada' : 'Tarifa creada',
        r && r.updated + r.cancelled + r.reactivated > 0
          ? `Se recalcularon las mensualidades pendientes de ${r.students === 1 ? '1 alumno' : `${r.students} alumnos`}.`
          : form.name.trim()
      );
      onSaved();
    } catch {
      // error visible en el formulario
    }
  };

  return (
    <form className="fee-plan-form" onSubmit={submit}>
      <Alert>{error}</Alert>
      <div className="fee-plan-form__kinds" role="radiogroup" aria-label="Tipo de tarifa">
        {Object.entries(FEE_PLAN_KINDS).map(([kind, k]) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={form.kind === kind}
            className={`fee-plan-form__kind ${form.kind === kind ? 'is-active' : ''}`}
            onClick={() => setForm((f) => ({ ...f, kind }))}
          >
            <strong>{k.label}</strong>
            <span>{k.hint}</span>
          </button>
        ))}
      </div>
      <div className="fee-plan-form__grid">
        <Field label="Nombre" error={fieldErrors.name} required>
          <Input value={form.name} onChange={set('name')} maxLength={80} placeholder={form.kind === 'fixed' ? 'Ej.: Convenio Empresa' : 'Ej.: Beca 50 %'} autoFocus />
        </Field>
        <Field label={form.kind === 'fixed' ? 'Monto mensual (USD)' : 'Descuento (%)'} error={fieldErrors.percentage || fieldErrors.amount} required>
          <div className="input-affix">
            <span className="input-affix__label">{form.kind === 'fixed' ? '$' : '%'}</span>
            <Input type="number" min="0.01" max={form.kind === 'percentage' ? 100 : undefined} step="0.01" value={form.value} onChange={set('value')} />
          </div>
        </Field>
      </div>
      <Field label="Descripción" hint="Opcional. Ej.: requisitos o empresa del convenio." error={fieldErrors.description}>
        <Input value={form.description} onChange={set('description')} maxLength={300} />
      </Field>
      {plan?.student_count > 0 && (
        <p className="form-hint">
          Asignada a {plan.student_count === 1 ? '1 alumno' : `${plan.student_count} alumnos`}: si cambias el valor, se recalculan sus mensualidades pendientes desde el mes en curso.
        </p>
      )}
      <div className="fee-plan-form__actions">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" loading={loading} disabled={invalid}>
          {plan ? 'Guardar cambios' : 'Crear tarifa'}
        </Button>
      </div>
    </form>
  );
}

export default FeePlansSection;
