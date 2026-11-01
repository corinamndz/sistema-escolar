import { useTenant } from '../context/TenantContext';

/**
 * Vistas del portal del representante (Configuración → Vistas del
 * representante, migración 066). Vienen en el perfil del colegio
 * (settings.portalViews: { payments: true, … }); una clave ausente cuenta como
 * activa, así el portal se ve completo mientras carga o si el colegio no configuró nada.
 *
 *   const isOn = usePortalViews();
 *   isOn('payments') // false si el colegio ocultó «Mis pagos»
 */
export function usePortalViews() {
  const { settings } = useTenant();
  const views = settings?.portalViews || {};
  return (key) => views[key] !== false;
}

/** ¿La vista está activa en este mapa? (para funciones fuera de componentes, como el filtro del menú). */
export const isPortalViewOn = (views, key) => !key || !views || views[key] !== false;
