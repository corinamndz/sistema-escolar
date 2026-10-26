/** Estados de revisión (mismos códigos que el backend, migración 058). */
export const REVIEW_STATUSES = {
  borrador: { label: 'Borrador', variant: 'neutral', icon: 'pencil', hint: 'Aún no se envía a revisión.' },
  en_revision: { label: 'En revisión', variant: 'info', icon: 'clock', hint: 'Esperando la revisión de coordinación.' },
  observado: { label: 'Con observaciones', variant: 'warning', icon: 'alertTriangle', hint: 'Coordinación pidió ajustes: corrige y reenvía.' },
  aprobado: { label: 'Aprobado', variant: 'success', icon: 'checkCircle', hint: 'Revisado y aprobado.' },
};

/** Texto de cada entrada de estado en el hilo. */
export const ENTRY_LABELS = {
  submitted: 'Envió a revisión',
  observed: 'Solicitó ajustes',
  approved: 'Aprobó',
  reset: 'Volvió a borrador',
};
