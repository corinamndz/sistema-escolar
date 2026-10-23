/** Estados de una cita con padres (mismos códigos que el backend). */
export const APPOINTMENT_STATUSES = {
  // Así nace toda cita: el representante la confirma desde el portal.
  pending: { label: 'Pendiente de confirmación', short: 'Por confirmar', variant: 'warning' },
  confirmed: { label: 'Confirmada', short: 'Confirmada', variant: 'info' },
  completed: { label: 'Concluida', variant: 'success' },
  cancelled: { label: 'Cancelada', variant: 'neutral' },
};
export const STATUS_KEYS = Object.keys(APPOINTMENT_STATUSES);

/** Texto para el toast con lo que se avisó al representante: "Aviso enviado por la campana y por correo". */
export function notifiedText(notified) {
  if (!notified) return null;
  const channels = [notified.bell && 'la campana', notified.emails > 0 && 'correo'].filter(Boolean);
  if (channels.length) return `Aviso enviado por ${channels.join(' y por ')}.`;
  if (notified.reason === 'disabled') return 'Sin aviso: no se eligió ningún canal.';
  return null;
}
