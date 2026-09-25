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
import SectionDetailPage from '../features/academics/pages/SectionDetailPage';
import EvaluationPlansPage from '../features/evaluation-plans/pages/EvaluationPlansPage';
import EvaluationPlanDetailPage from '../features/evaluation-plans/pages/EvaluationPlanDetailPage';
import GradebookPage from '../features/grading/pages/GradebookPage';
import PaymentsPage from '../features/payments/pages/PaymentsPage';
import MyPaymentsPage from '../features/payments/pages/MyPaymentsPage';
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

            <Route element={<PermissionRoute module="academics" />}>
              <Route path="academics" element={<AcademicsPage />} />
              <Route path="academics/sections/:id" element={<SectionDetailPage />} />
            </Route>

            <Route element={<PermissionRoute module="evaluation_plans" />}>
              <Route path="evaluation-plans" element={<EvaluationPlansPage />} />
              <Route path="evaluation-plans/:id" element={<EvaluationPlanDetailPage />} />
            </Route>

            <Route element={<PermissionRoute module="grading" />}>
              <Route path="grading/plans/:id" element={<GradebookPage />} />
            </Route>

            <Route element={<PermissionRoute module="payments" />}>
              <Route path="payments" element={<PaymentsPage />} />
            </Route>

            {/* Vista de padres: cualquier usuario autenticado con hijos asociados, sin permiso administrativo */}
            <Route path="payments/mine" element={<MyPaymentsPage />} />

            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
    </ThemeProvider>
  );
}

export default App;
