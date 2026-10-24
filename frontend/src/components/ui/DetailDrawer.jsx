import { useRef } from 'react';
import Drawer from './Drawer';
import Button from './Button';

/**
 * Panel lateral de solo lectura para la acción "Ver" de un DataTable.
 *
 *   <DetailDrawer
 *     title="Ana Pérez" subtitle="Docente"
 *     fields={[{ label: 'Correo', value: row.email }, { label: 'Notas', value: row.notes, full: true }]}
 *     onClose={...} onEdit={canEdit ? () => ... : undefined}
 *   />
 *
 * Valores vacíos (null/undefined/'') se muestran como "—".
 */
function DetailDrawer({ title, subtitle, badge, fields, onClose, onEdit, children }) {
  const drawer = useRef(null);
  return (
    <Drawer
      ref={drawer}
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => drawer.current?.close()}>
            Cerrar
          </Button>
          {onEdit && (
            <Button type="button" icon="pencil" onClick={onEdit}>
              Editar
            </Button>
          )}
        </>
      }
    >
      {badge && (!Array.isArray(badge) || badge.length > 0) && <div className="detail__intro">{badge}</div>}

      {fields.length > 0 && (
        <dl className="detail-list">
          {fields.map((f) => (
            <div key={f.label} className={`detail-list__item ${f.full ? 'detail-list__item--full' : ''}`}>
              <dt>{f.label}</dt>
              <dd>{f.value === null || f.value === undefined || f.value === '' ? '—' : f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {children}
    </Drawer>
  );
}

export default DetailDrawer;
