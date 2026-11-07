import { useState } from 'react';
import reviewsApi from '../../../api/endpoints/reviews.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useAuth } from '../../../context/AuthContext';
import Button from '../../../components/ui/Button';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { useToast } from '../../../components/ui/Toast';

/**
 * ¿Puede este usuario aprobar directamente algo de ese nivel? El Administrador
 * siempre; el Coordinador, solo en su nivel. Es para mostrar el botón: el
 * servidor vuelve a validarlo (reviews/review.service → directApprove).
 */
export function useCanDirectApprove() {
  const { user } = useAuth();
  return (levelCode) => Boolean(user?.isAdmin || (user?.coordinator?.level && user.coordinator.level === levelCode));
}

/**
 * «Aprobar» de acceso rápido: aprueba un plan o un programa sin que el docente
 * lo envíe a revisión (borrador / con observaciones / en revisión → aprobado).
 * Pide confirmación y queda registrado en el hilo de revisión.
 *
 *   target   { planId } | { gradeId, subjectId, schoolPeriodId }
 *   what     'plan' | 'content'
 */
export function DirectApproveButton({ target, what = 'plan', status, onApproved, size = 'sm', variant = 'secondary', label = 'Aprobar' }) {
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const toast = useToast();
  const noun = what === 'plan' ? 'el plan de evaluación' : 'el contenido programático';

  const approve = async (e) => {
    e?.stopPropagation();
    const ok = await confirm({
      title: what === 'plan' ? '¿Aprobar este plan directamente?' : '¿Aprobar este contenido directamente?',
      message: `Se aprueba ${noun} sin pasar por el envío a revisión${status === 'en_revision' ? '' : ' del docente'}. Queda registrado con tu nombre y la fecha${what === 'plan' ? ', y las familias ven el plan en el portal' : ''}.`,
      confirmLabel: 'Aprobar',
      icon: 'checkCircle',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await reviewsApi.directApprove(target);
      toast.success(what === 'plan' ? 'Plan aprobado' : 'Contenido aprobado', 'Aprobación directa registrada.');
      onApproved?.(r);
    } catch (err) {
      toast.error('No se pudo aprobar', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button size={size} variant={variant} icon="checkCircle" className="direct-approve" loading={busy} onClick={approve} title="Aprobación directa (sin pasar por revisión)">
      {label}
    </Button>
  );
}
