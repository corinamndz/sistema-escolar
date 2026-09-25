import Modal from './Modal';
import Button from './Button';

/**
 * Modal de solo lectura para la acción "Ver" de un DataTable.
 *
 *   <DetailModal
 *     title="Ana Pérez" subtitle="Docente"
 *     fields={[{ label: 'Correo', value: row.email }, { label: 'Notas', value: row.notes, full: true }]}
 *     onClose={...} onEdit={canEdit ? () => ... : undefined}
 *   />
 *
 * Valores vacíos (null/undefined/'') se muestran como "—".
 */
function DetailModal({ title, subtitle, badge, fields, onClose, onEdit, children }) {
  return (
    <Modal title={title} onClose={onClose}>
      {(subtitle || badge) && (
        <div className="detail__intro">
          {subtitle && <span className="text-muted">{subtitle}</span>}
          {badge}
        </div>
      )}

      <dl className="detail-list">
        {fields.map((f) => (
          <div key={f.label} className={`detail-list__item ${f.full ? 'detail-list__item--full' : ''}`}>
            <dt>{f.label}</dt>
            <dd>{f.value === null || f.value === undefined || f.value === '' ? '—' : f.value}</dd>
          </div>
        ))}
      </dl>

      {children}

      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cerrar
        </Button>
        {onEdit && (
          <Button type="button" icon="pencil" onClick={onEdit}>
            Editar
          </Button>
        )}
      </div>
    </Modal>
  );
}

export default DetailModal;
