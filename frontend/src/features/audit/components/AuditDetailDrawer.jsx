import { useRef, useState } from 'react';
import auditApi from '../../../api/endpoints/audit.api';
import { useFetch } from '../../../hooks/useFetch';
import Drawer from '../../../components/ui/Drawer';
import Button from '../../../components/ui/Button';
import Badge from '../../../components/ui/Badge';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { actionTone, TONE_ICON, longDateTime, describeAgent, ipLabel, displayValue } from '../auditFormat';

/** Lista clave → valor de un objeto (datos enviados, detalles); "[oculto]" se marca como protegido. */
function KeyValues({ data }) {
  const entries = Object.entries(data || {});
  if (!entries.length) return <p className="text-sm text-muted">Sin datos.</p>;
  return (
    <dl className="audit-kv">
      {entries.map(([k, v]) => (
        <div key={k} className="audit-kv__row">
          <dt>{k}</dt>
          <dd>
            {v === '[oculto]' ? (
              <span className="audit-kv__hidden">
                <Icon name="lock" size={12} /> oculto por seguridad
              </span>
            ) : (
              displayValue(v)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ title, children }) {
  return (
    <section className="audit-section">
      <h4 className="drawer-section__title">{title}</h4>
      {children}
    </section>
  );
}

/** Detalle completo de un evento de la bitácora, en el panel lateral. */
function AuditDetailDrawer({ id, preview, onClose }) {
  const drawer = useRef(null);
  const [showJson, setShowJson] = useState(false);
  const { data, loading, error } = useFetch(() => auditApi.getOne(id), [id]);
  const e = data || preview;
  const tone = actionTone(e?.action);
  const req = data?.request;
  const renamed = data && data.user_id && data.current_user_name && data.current_user_name !== data.actor_name;

  return (
    <Drawer
      ref={drawer}
      title={e?.action_label || 'Evento'}
      subtitle={e ? longDateTime(e.created_at) : ''}
      icon={TONE_ICON[tone]}
      onClose={onClose}
      footer={
        <>
          <span className="text-sm text-muted audit-id" title={id}>
            ID {String(id).slice(0, 8)}
          </span>
          <Button variant="secondary" onClick={() => drawer.current?.close()}>
            Cerrar
          </Button>
        </>
      }
    >
      <Alert>{error}</Alert>
      {e && (
        <div className={`audit-summary audit-summary--${tone}`}>
          <div className="audit-summary__tags">
            <Badge variant="neutral">{e.module_label}</Badge>
            <code>{e.action}</code>
          </div>
          <p>{e.summary || e.action_label}</p>
        </div>
      )}

      {loading && !data ? (
        <Spinner label="Cargando detalle…" />
      ) : (
        data && (
          <>
            <Section title="Quién">
              <dl className="audit-kv">
                <div className="audit-kv__row">
                  <dt>Usuario</dt>
                  <dd>
                    <strong>{data.actor_name || 'Sistema'}</strong>
                    {data.actor_username && <span className="text-muted"> · {data.actor_username}</span>}
                    {renamed && <div className="text-sm text-muted">Hoy se llama {data.current_user_name}</div>}
                    {data.user_id && !data.current_user_name && <div className="text-sm text-warning">El usuario ya no existe</div>}
                  </dd>
                </div>
                <div className="audit-kv__row">
                  <dt>Dirección IP</dt>
                  <dd>{ipLabel(data.ip_address)}</dd>
                </div>
                <div className="audit-kv__row">
                  <dt>Navegador</dt>
                  <dd title={data.user_agent || ''}>{describeAgent(data.user_agent) || '—'}</dd>
                </div>
              </dl>
            </Section>

            <Section title="Qué">
              <dl className="audit-kv">
                <div className="audit-kv__row">
                  <dt>Módulo</dt>
                  <dd>{data.module_label}</dd>
                </div>
                <div className="audit-kv__row">
                  <dt>Registro afectado</dt>
                  <dd>
                    {data.entity}
                    {data.entity_id && <code className="audit-code"> {data.entity_id}</code>}
                  </dd>
                </div>
                {req && (
                  <div className="audit-kv__row">
                    <dt>Petición</dt>
                    <dd>
                      <code className="audit-code">
                        {req.method} {req.path}
                      </code>{' '}
                      <Badge variant={req.status < 300 ? 'success' : 'warning'}>{req.status}</Badge>
                    </dd>
                  </div>
                )}
              </dl>
            </Section>

            {req?.body && (
              <Section title="Datos enviados">
                <KeyValues data={req.body} />
              </Section>
            )}
            {req?.file && (
              <Section title="Archivo adjunto">
                <KeyValues data={{ nombre: req.file.name, tamaño: `${Math.round(req.file.size / 1024)} KB`, tipo: req.file.type }} />
              </Section>
            )}
            {data.diff && (
              <Section title="Cambios y detalles">
                <KeyValues data={typeof data.diff === 'object' && !Array.isArray(data.diff) ? data.diff : { valor: data.diff }} />
              </Section>
            )}

            <button type="button" className="link-button audit-json-toggle" onClick={() => setShowJson((v) => !v)}>
              <Icon name={showJson ? 'chevronDown' : 'chevronRight'} size={14} /> {showJson ? 'Ocultar' : 'Ver'} registro técnico (JSON)
            </button>
            {showJson && <pre className="audit-json">{JSON.stringify({ request: data.request, diff: data.diff }, null, 2)}</pre>}
          </>
        )
      )}
    </Drawer>
  );
}

export default AuditDetailDrawer;
