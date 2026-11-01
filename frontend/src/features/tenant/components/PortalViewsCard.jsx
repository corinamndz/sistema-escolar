import { useEffect, useState } from 'react';
import tenantApi from '../../../api/endpoints/tenant.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useFetch } from '../../../hooks/useFetch';
import { useTenant } from '../../../context/TenantContext';
import Card from '../../../components/ui/Card';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import Switch from '../../../components/ui/Switch';
import { useToast } from '../../../components/ui/Toast';

const GROUPS = [
  { key: 'menu', title: 'Menú e inicio del portal', subtitle: 'Secciones del menú lateral y bloques del panel de inicio de la familia.' },
  { key: 'student', title: 'Ficha de cada alumno', subtitle: 'Pestañas que ve la familia al abrir a uno de sus representados.' },
];

/**
 * Configuración → Vistas del representante: qué secciones del portal ven las
 * familias. Cada interruptor se guarda al instante; el menú y las pestañas
 * del representante se ajustan en su próxima carga, y el servidor rechaza
 * (403) las secciones apagadas aunque se conozca la dirección.
 */
function PortalViewsCard({ canEdit }) {
  const toast = useToast();
  const { refreshTenant } = useTenant();
  const { data, loading, error } = useFetch(() => tenantApi.getPortalViews(), []);
  const [views, setViews] = useState([]);
  const [saving, setSaving] = useState(null);

  useEffect(() => {
    if (data) setViews(data.views);
  }, [data]);

  const change = async (key, enabled) => {
    const previous = views;
    setViews((vs) => vs.map((v) => (v.key === key ? { ...v, enabled } : v)));
    setSaving(key);
    try {
      const saved = await tenantApi.savePortalViews({ [key]: enabled });
      setViews(saved.views);
      const label = previous.find((v) => v.key === key)?.label;
      toast.success(enabled ? 'Sección visible' : 'Sección oculta', `«${label}» ${enabled ? 'ya aparece' : 'ya no aparece'} en el portal de las familias.`);
      refreshTenant(); // el perfil del colegio (y su `portalViews`) al día en esta sesión
    } catch (err) {
      setViews(previous);
      toast.error('No se pudo guardar', getErrorMessage(err));
    } finally {
      setSaving(null);
    }
  };

  if (loading && !data) return <Spinner />;
  const hidden = views.filter((v) => !v.enabled).length;

  return (
    <Card title="Vistas del representante" subtitle="Elige qué secciones del portal ven las familias. Los cambios se guardan al instante.">
      <Alert>{error}</Alert>
      {hidden > 0 && (
        <p className="pv-summary">
          <Icon name="eye" size={14} /> {hidden} sección{hidden === 1 ? '' : 'es'} oculta{hidden === 1 ? '' : 's'} para las familias.
        </p>
      )}
      {GROUPS.map((g) => (
        <section key={g.key} className="pv-group" aria-labelledby={`pv-${g.key}`}>
          <h4 id={`pv-${g.key}`} className="pv-group__title">
            {g.title}
          </h4>
          <p className="pv-group__subtitle text-sm text-muted">{g.subtitle}</p>
          <ul className="pv-list">
            {views
              .filter((v) => v.group === g.key)
              .map((v) => (
                <li key={v.key} className={`pv-item ${v.enabled ? '' : 'is-off'}`}>
                  <span className="pv-item__icon">
                    <Icon name={v.icon} size={16} />
                  </span>
                  <span className="pv-item__text">
                    <strong>{v.label}</strong>
                    <span className="text-sm text-muted">{v.description}</span>
                  </span>
                  <span className="pv-item__state">{v.enabled ? 'Visible' : 'Oculta'}</span>
                  <Switch checked={v.enabled} onChange={(on) => change(v.key, on)} disabled={!canEdit || saving === v.key} ariaLabel={`${v.label}: ${v.enabled ? 'visible' : 'oculta'}`} />
                </li>
              ))}
          </ul>
        </section>
      ))}
      <p className="form-hint pv-note">
        <Icon name="info" size={13} /> Ocultar una sección no borra datos: al volver a activarla, la familia ve todo como antes. Los avisos de la campana se siguen
        enviando según Configuración → Notificaciones.
      </p>
    </Card>
  );
}

export default PortalViewsCard;
