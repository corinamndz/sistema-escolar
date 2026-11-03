import { useState } from 'react';
import portalApi from '../../../api/endpoints/portal.api';
import { getErrorMessage } from '../../../api/axiosClient';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Icon from '../../../components/ui/Icon';

/** "lunes, 3 de noviembre de 2026, 10:42 a. m." */
export const formatAckDate = (iso) =>
  new Date(iso).toLocaleString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * Constancia de lectura del plan (069), arriba del plan en el portal:
 *   - pendiente / versión anterior: casilla "Leí el plan completo" + botón
 *     "He leído y acepto el plan de evaluación";
 *   - confirmado: sello verde con fecha y hora (ya no hay botón).
 * `state`: { status: 'pending' | 'confirmed' | 'outdated', last } del backend.
 */
function PlanAcknowledgment({ studentId, planId, state, onChange }) {
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  if (!state) return null; // el usuario no es representante (no aplica)

  if (state.status === 'confirmed') {
    return (
      <div className="plan-ack plan-ack--ok" role="status">
        <span className="plan-ack__seal" aria-hidden="true">
          <Icon name="checkCircle" size={26} />
        </span>
        <div className="plan-ack__text">
          <strong>Plan de evaluación leído y aceptado</strong>
          <span>Confirmado el {formatAckDate(state.last.acknowledged_at)}. La constancia quedó registrada para la Dirección del colegio.</span>
        </div>
      </div>
    );
  }

  const confirm = async () => {
    setSaving(true);
    setError(null);
    try {
      onChange(await portalApi.acknowledgePlan(studentId, planId));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  const outdated = state.status === 'outdated';

  return (
    <div className={`plan-ack ${outdated ? 'plan-ack--outdated' : 'plan-ack--pending'}`}>
      <span className="plan-ack__seal" aria-hidden="true">
        <Icon name={outdated ? 'alertTriangle' : 'clipboard'} size={22} />
      </span>
      <div className="plan-ack__text">
        <strong>{outdated ? 'El plan cambió después de tu confirmación' : 'Confirma que leíste este plan de evaluación'}</strong>
        <span>
          {outdated
            ? `Lo confirmaste el ${formatAckDate(state.last.acknowledged_at)}, pero el docente lo actualizó. Revísalo y vuelve a confirmar.`
            : 'Al confirmar dejas constancia ante el colegio de que revisaste las actividades, su ponderación, criterios, fechas y los temas del contenido programático que evalúan.'}
        </span>
        <label className="plan-ack__check">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} disabled={saving} />
          Leí el plan de evaluación completo
        </label>
        <Alert>{error}</Alert>
      </div>
      <Button icon="check" onClick={confirm} loading={saving} loadingText="Registrando…" disabled={!checked} className="plan-ack__btn">
        He leído y acepto el plan de evaluación
      </Button>
    </div>
  );
}

export default PlanAcknowledgment;
