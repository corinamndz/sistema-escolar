import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { useTenant } from '../../../context/TenantContext';
import staffApi from '../../../api/endpoints/staff.api';
import studentsApi from '../../../api/endpoints/students.api';
import paymentsApi from '../../../api/endpoints/payments.api';
import Card from '../../../components/ui/Card';
import StatCard from '../../../components/ui/StatCard';
import Icon from '../../../components/ui/Icon';
import { NAV_SECTIONS } from '../../../components/layout/navigation';
import GuardianPanel from '../components/GuardianPanel';

const STAT_DEFS = [
  {
    key: 'students',
    module: 'students',
    label: 'Alumnos activos',
    icon: 'graduation',
    tone: 'primary',
    to: '/students',
    hint: 'Matrícula vigente',
    load: async () => (await studentsApi.list({ status: 'active' })).length,
  },
  {
    key: 'staff',
    module: 'staff',
    label: 'Personal registrado',
    icon: 'briefcase',
    tone: 'violet',
    to: '/staff',
    hint: 'Docentes y administrativos',
    load: async () => (await staffApi.list()).length,
  },
  {
    key: 'pendingPayments',
    module: 'payments',
    blockTeacher: true,
    label: 'Pagos pendientes',
    icon: 'wallet',
    tone: 'warning',
    to: '/payments',
    hint: 'Por confirmar',
    load: async () => (await paymentsApi.list({ status: 'pending' })).length,
  },
];

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

/**
 * Panel de inicio. Si el usuario es un representante (`user.guardianId`, viene
 * de /auth/me) se muestra el portal de padres con sus alumnos; si no, las
 * tarjetas de resumen del colegio. Cada tarjeta solo se consulta si el
 * usuario tiene permiso de lectura sobre ese módulo, para no disparar
 * requests que el backend rechazaría con 403.
 */
function DashboardPage() {
  const { user, can } = useAuth();
  const { settings } = useTenant();
  const [stats, setStats] = useState({}); // key → número | null (falló) ; ausente = cargando
  const isGuardian = Boolean(user?.guardianId);

  // Las cifras de todo el colegio son para el personal, no para el portal de padres.
  const statAllowed = (d) => can(d.module, 'read') && !(d.blockTeacher && user?.isRestrictedTeacher);
  const visibleStats = isGuardian ? [] : STAT_DEFS.filter(statAllowed);

  useEffect(() => {
    let cancelled = false;
    if (isGuardian) return undefined;
    STAT_DEFS.filter(statAllowed).forEach(async (def) => {
      let value;
      try {
        value = await def.load();
      } catch {
        value = null; // si algo falla, esa tarjeta se oculta
      }
      if (!cancelled) setStats((s) => ({ ...s, [def.key]: value }));
    });
    return () => {
      cancelled = true;
    };
  }, [can, isGuardian]);

  const cards = visibleStats.filter((d) => stats[d.key] !== null);

  const displayName = user?.fullName || user?.username || '';
  const quickLinks = NAV_SECTIONS.flatMap((s) => s.items)
    .filter((item) => item.path !== '/' && (item.public || can(item.moduleCode, 'read')))
    .slice(0, 6);

  const today = new Date().toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div>
      <section className="welcome">
        <div>
          <h2>
            {greeting()}, {displayName} 👋
          </h2>
          <p>{isGuardian ? `Bienvenido al portal de ${settings.name}.` : `Este es el resumen de ${settings.name}.`}</p>
        </div>
        <span className="welcome__date">{today}</span>
      </section>

      {cards.length > 0 && (
        <div className="grid grid--3" style={{ marginBottom: 24 }}>
          {cards.map((d) => (
            <StatCard
              key={d.key}
              label={d.label}
              value={stats[d.key]}
              icon={d.icon}
              tone={d.tone}
              to={d.to}
              hint={d.hint}
            />
          ))}
        </div>
      )}

      {isGuardian && <GuardianPanel />}

      {!isGuardian && (
      <Card title="Accesos rápidos" subtitle="Ve directo a los módulos que más usas">
        {quickLinks.length > 0 ? (
          <div className="quick-links">
            {quickLinks.map((item) => (
              <Link key={item.path} to={item.path} className="quick-link">
                <span className="quick-link__icon">
                  <Icon name={item.icon} size={18} />
                </span>
                {item.label}
                <Icon name="arrowRight" size={16} />
              </Link>
            ))}
          </div>
        ) : (
          <p>Usa el menú lateral para empezar a gestionar el colegio.</p>
        )}
      </Card>
      )}
    </div>
  );
}

export default DashboardPage;
