import { Routes, Route } from 'react-router-dom';
import { ThemeProvider } from '../theme/ThemeProvider';
import AppLayout from '../components/layout/AppLayout';
import ProtectedRoute from './ProtectedRoute';
import PermissionRoute from './PermissionRoute';

import LoginPage from '../features/auth/pages/LoginPage';
import DashboardPage from '../features/dashboard/pages/DashboardPage';
import TenantSettingsPage from '../features/tenant/pages/TenantSettingsPage';
import RolesPage from '../features/roles/pages/RolesPage';
import RoleDetailPage from '../features/roles/pages/RoleDetailPage';
import StaffPage from '../features/staff/pages/StaffPage';
import StudentsPage from '../features/students/pages/StudentsPage';
import StudentDetailPage from '../features/students/pages/StudentDetailPage';
import GuardiansPage from '../features/students/pages/GuardiansPage';
import AcademicsPage from '../features/academics/pages/AcademicsPage';
import PromotionPage from '../features/academics/pages/PromotionPage';
import SchedulesPage from '../features/schedules/pages/SchedulesPage';
import MySchedulePage from '../features/schedules/pages/MySchedulePage';
import DisciplinePage from '../features/discipline/pages/DisciplinePage';
import SectionDetailPage from '../features/academics/pages/SectionDetailPage';
import EvaluationPlansPage from '../features/evaluation-plans/pages/EvaluationPlansPage';
import EvaluationPlanDetailPage from '../features/evaluation-plans/pages/EvaluationPlanDetailPage';
import GradebookPage from '../features/grading/pages/GradebookPage';
import PaymentsPage from '../features/payments/pages/PaymentsPage';
import MyPaymentsPage from '../features/payments/pages/MyPaymentsPage';
import CurrenciesPage from '../features/payments/pages/CurrenciesPage';
import PortalStudentPage from '../features/portal/pages/PortalStudentPage';
import NotFoundPage from '../features/dashboard/pages/NotFoundPage';

function App() {
  return (
    <ThemeProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route index element={<DashboardPage />} />

            <Route element={<PermissionRoute module="tenant_settings" />}>
              <Route path="tenant/settings" element={<TenantSettingsPage />} />
            </Route>

            <Route element={<PermissionRoute module="roles" />}>
              <Route path="roles" element={<RolesPage />} />
              <Route path="roles/:id" element={<RoleDetailPage />} />
            </Route>

            <Route element={<PermissionRoute module="staff" />}>
              <Route path="staff" element={<StaffPage />} />
            </Route>

            <Route element={<PermissionRoute module="students" />}>
              <Route path="students" element={<StudentsPage />} />
              <Route path="students/:id" element={<StudentDetailPage />} />
            </Route>

            <Route element={<PermissionRoute module="guardians" />}>
              <Route path="guardians" element={<GuardiansPage />} />
            </Route>

            <Route element={<PermissionRoute module="academics" blockTeacher />}>
              <Route path="academics" element={<AcademicsPage />} />
              <Route path="academics/sections/:id" element={<SectionDetailPage />} />
            </Route>

            {/* Convivencia: sanciones disciplinarias. */}
            <Route element={<PermissionRoute module="discipline" blockTeacher />}>
              <Route path="discipline" element={<DisciplinePage />} />
            </Route>

            {/* Horarios: la administración los arma; el docente ve "Mi horario". */}
            <Route element={<PermissionRoute module="schedules" blockTeacher />}>
              <Route path="schedules" element={<SchedulesPage />} />
            </Route>
            <Route element={<PermissionRoute teacherOnly />}>
              <Route path="schedules/mine" element={<MySchedulePage />} />
            </Route>

            {/* Cierre y promoción: módulo propio, vedado a los docentes. */}
            <Route element={<PermissionRoute module="promotion" blockTeacher />}>
              <Route path="academics/promotion" element={<PromotionPage />} />
            </Route>

            <Route element={<PermissionRoute module="evaluation_plans" />}>
              <Route path="evaluation-plans" element={<EvaluationPlansPage />} />
              <Route path="evaluation-plans/:id" element={<EvaluationPlanDetailPage />} />
            </Route>

            <Route element={<PermissionRoute module="grading" />}>
              <Route path="grading/plans/:id" element={<GradebookPage />} />
            </Route>

            <Route element={<PermissionRoute module="payments" blockTeacher />}>
              <Route path="payments" element={<PaymentsPage />} />
              <Route path="payments/currencies" element={<CurrenciesPage />} />
            </Route>

            {/* Vista de padres: cualquier usuario autenticado con hijos asociados, sin permiso administrativo */}
            <Route element={<PermissionRoute guardianOnly blockTeacher />}>
              <Route path="payments/mine" element={<MyPaymentsPage />} />
            </Route>
            {/* Portal de padres: detalle y calificaciones de un representado (el backend valida el vínculo) */}
            <Route path="portal/students/:studentId" element={<PortalStudentPage />} />

            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
    </ThemeProvider>
  );
}

export default App;
