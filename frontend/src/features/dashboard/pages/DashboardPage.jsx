import { Suspense, lazy, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { useTenant } from '../../../context/TenantContext';
import dashboardApi from '../../../api/endpoints/dashboard.api';
import staffApi from '../../../api/endpoints/staff.api';
import studentsApi from '../../../api/endpoints/students.api';
import { useFetch } from '../../../hooks/useFetch';
import Card from '../../../components/ui/Card';
import StatCard from '../../../components/ui/StatCard';
import Alert from '../../../components/ui/Alert';
import Icon from '../../../components/ui/Icon';
import { NAV_SECTIONS } from '../../../components/layout/navigation';
import GuardianPanel from '../components/GuardianPanel';

// Recharts solo se descarga para quien ve los gráficos (administración y directiva).
const DashboardCharts = lazy(() => import('../components/DashboardCharts'));

/** Tarjetas del docente con carga restringida (sus alumnos y el personal), como hasta ahora. */
const TEACHER_STATS = [
  { key: 'students', module: 'students', label: 'Alumnos activos', icon: 'graduation', tone: 'primary', to: '/students', hint: 'Matrícula vigente', load: async () => (await studentsApi.list({ status: 'active' })).length },
  { key: 'staff', module: 'staff', label: 'Personal registrado', icon: 'briefcase', tone: 'violet', to: '/staff', hint: 'Docentes y administrativos', load: async () => (await staffApi.list()).length },
];

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

/** KPIs del colegio a partir del resumen del backend; cada tarjeta solo si el usuario puede leer ese módulo. */
function kpisFrom(summary) {
  if (!summary) return [];
  const { enrollment, guardians, staff, academics } = summary;
  return [
    enrollment && {
      key: 'students',
      label: 'Alumnos matriculados',
      value: enrollment.total,
      icon: 'graduation',
      tone: 'primary',
      to: '/students',
      hint: enrollment.unenrolled ? `${enrollment.unenrolled} sin inscripción en el año` : 'Alumnos activos del colegio',
    },
    guardians && {
      key: 'guardians',
      label: 'Representantes',
      value: guardians.total,
      icon: 'users',
      tone: 'info',
      to: '/guardians',
      hint: `${guardians.with_access} con acceso al portal`,
    },
    staff && {
      key: 'staff',
      label: 'Personal activo',
      value: staff.total,
      icon: 'briefcase',
      tone: 'violet',
      to: '/staff',
      hint: `${staff.coordinator ? `${plural(staff.coordinator, 'coordinador', 'coordinadores')} · ` : ''}${plural(staff.teaching, 'docente', 'docentes')} · ${staff.administrative + staff.support} administrativo${staff.administrative + staff.support === 1 ? '' : 's'} y obrero${staff.administrative + staff.support === 1 ? '' : 's'}`,
    },
    academics && {
      key: 'academics',
      label: 'Materias activas',
      value: academics.subjects,
      icon: 'book',
      tone: 'success',
      to: '/academics/subjects',
      hint: `${plural(academics.sections, 'sección', 'secciones')}${academics.school_period ? ` en ${academics.school_period}` : ''}`,
    },
  ].filter(Boolean);
}

/**
 * Inicio.
 *   Representante  portal de padres con sus alumnos.
 *   Administración y directiva  KPIs del colegio + gráficos (matrícula por nivel y solvencia), desde /dashboard/summary.
 *   Docente con carga restringida  sus tarjetas de siempre (alumnos de su carga y personal).
 */
function DashboardPage() {
  const { user, can } = useAuth();
  const { settings } = useTenant();
  const isGuardian = Boolean(user?.guardianId);
  const isTeacher = Boolean(user?.isRestrictedTeacher);
  const showManagement = !isGuardian && !isTeacher && can('dashboard', 'read');

  const { data: summary, loading, error } = useFetch(() => (showManagement ? dashboardApi.summary() : Promise.resolve(null)), [showManagement]);

  // Docente: las mismas tarjetas que antes, cada una solo con permiso de lectura.
  const [teacherStats, setTeacherStats] = useState({});
  const teacherDefs = isTeacher && !isGuardian ? TEACHER_STATS.filter((d) => can(d.module, 'read')) : [];
  useEffect(() => {
    let cancelled = false;
    teacherDefs.forEach(async (def) => {
      let value;
      try {
        value = await def.load();
      } catch {
        value = null; // si falla, esa tarjeta se oculta
      }
      if (!cancelled) setTeacherStats((s) => ({ ...s, [def.key]: value }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTeacher, isGuardian, can]);

  const kpis = showManagement
    ? loading && !summary
      ? Array.from({ length: 4 }, (_, i) => ({ key: `sk-${i}`, label: 'Cargando…', value: undefined }))
      : kpisFrom(summary)
    : teacherDefs.filter((d) => teacherStats[d.key] !== null).map((d) => ({ ...d, value: teacherStats[d.key] }));

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

      {showManagement && <Alert>{error}</Alert>}

      {kpis.length > 0 && (
        <div className={`grid ${kpis.length >= 4 ? 'grid--4' : 'grid--3'} dashboard-kpis`}>
          {kpis.map((d) => (
            <StatCard key={d.key} label={d.label} value={d.value} icon={d.icon} tone={d.tone} to={d.to} hint={d.hint} />
          ))}
        </div>
      )}

      {showManagement && summary && (
        <Suspense
          fallback={
            <div className="grid grid--2 dashboard-charts">
              <div className="card chart-skeleton skeleton" />
              <div className="card chart-skeleton skeleton" />
            </div>
          }
        >
          <DashboardCharts summary={summary} />
        </Suspense>
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
