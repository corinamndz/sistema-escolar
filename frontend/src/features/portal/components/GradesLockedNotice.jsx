import { Link } from 'react-router-dom';
import Icon from '../../../components/ui/Icon';

/** Mismo texto que envía el backend al bloquear las calificaciones. */
export const GRADES_LOCKED_MESSAGE =
  'Acceso a detalles del alumno bloqueado por pagos pendientes. Por favor, comuníquese con administración o reporte su pago.';

/**
 * Aviso de calificaciones bloqueadas por cuotas vencidas, con acceso directo a
 * "Mis pagos" para reportar el pago (un pago reportado desbloquea al instante:
 * queda en revisión y deja de contar como vencido).
 */
function GradesLockedNotice({ overdueCount, compact = false, id }) {
  return (
    <div id={id} className={`grades-locked ${compact ? 'grades-locked--compact' : ''}`} role="alert">
      <Icon name="lock" size={compact ? 16 : 22} className="grades-locked__icon" />
      <div className="grades-locked__body">
        <strong>{GRADES_LOCKED_MESSAGE}</strong>
        {overdueCount > 0 && (
          <span className="text-sm">
            {overdueCount} cuota{overdueCount === 1 ? '' : 's'} vencida{overdueCount === 1 ? '' : 's'}.
          </span>
        )}
        <Link to="/payments/mine" className="btn btn--primary btn--sm">
          <Icon name="receipt" size={15} /> Reportar pago
        </Link>
      </div>
    </div>
  );
}

export default GradesLockedNotice;
