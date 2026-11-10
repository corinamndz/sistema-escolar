import { Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from '../theme/ThemeProvider';
import AppLayout from '../components/layout/AppLayout';
import ProtectedRoute from './ProtectedRoute';
import SplashScreen from '../components/layout/SplashScreen';
import PermissionRoute from './PermissionRoute';

import LoginPage from '../features/auth/pages/LoginPage';
import HomeRoute from './HomeRoute';
import TenantSettingsPage from '../features/tenant/pages/TenantSettingsPage';
import RolesPage from '../features/roles/pages/RolesPage';
import RoleDetailPage from '../features/roles/pages/RoleDetailPage';
import StaffPage from '../features/staff/pages/StaffPage';
import StudentsPage from '../features/students/pages/StudentsPage';
import StudentDetailPage from '../features/students/pages/StudentDetailPage';
import GuardiansPage from '../features/students/pages/GuardiansPage';
import InitialSetupPage from '../features/academics/pages/InitialSetupPage';
import AcademicSectionsPage from '../features/academics/pages/AcademicSectionsPage';
import LegacyAcademicsRedirect from '../features/academics/pages/LegacyAcademicsRedirect';
import PromotionPage from '../features/academics/pages/PromotionPage';
import SchedulesPage from '../features/schedules/pages/SchedulesPage';
import MySchedulePage from '../features/schedules/pages/MySchedulePage';
import DisciplinePage from '../features/discipline/pages/DisciplinePage';
import ClubsPage from '../features/clubs/pages/ClubsPage';
import EventsPage from '../features/events/pages/EventsPage';
import AppointmentsPage from '../features/appointments/pages/AppointmentsPage';
import NotificationLogPage from '../features/notifications/pages/NotificationLogPage';
import AnnouncementsPage from '../features/notifications/pages/AnnouncementsPage';
import EnrollmentFormsPage from '../features/enrollment-forms/pages/EnrollmentFormsPage';
import FormBuilderPage from '../features/enrollment-forms/pages/FormBuilderPage';
import EnrollmentSubmissionsPage from '../features/enrollment-forms/pages/EnrollmentSubmissionsPage';
import PortalEnrollmentPage from '../features/enrollment-forms/pages/PortalEnrollmentPage';
import GuardianPortalPreviewPage from '../features/enrollment-forms/pages/GuardianPortalPreviewPage';
import NotificationCenterPage from '../features/notifications/pages/NotificationCenterPage';
import RecognitionsPage from '../features/recognitions/pages/RecognitionsPage';
import PortalViewGate from '../components/layout/PortalViewGate';
import AuditPage from '../features/audit/pages/AuditPage';
import SupportPage from '../features/support/pages/SupportPage';
import GradeSummaryPage from '../features/grading/pages/GradeSummaryPage';
import CarryoversPage from '../features/carryovers/pages/CarryoversPage';
import CarryoverSimulatorPage from '../features/carryovers/pages/CarryoverSimulatorPage';
import { isFeatureOn } from '../lib/features';
import CertificateEditorPage from '../features/certificates/pages/CertificateEditorPage';
import PortalEventsPage from '../features/portal/pages/PortalEventsPage';
import SectionDetailPage from '../features/academics/pages/SectionDetailPage';
import SubjectsPage from '../features/academics/subjects/SubjectsPage';
import EvaluationPlansPage from '../features/evaluation-plans/pages/EvaluationPlansPage';
import EvaluationPlanDetailPage from '../features/evaluation-plans/pages/EvaluationPlanDetailPage';
import ProgrammaticContentPage from '../features/programmatic-content/pages/ProgrammaticContentPage';
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
        {/* Recuperación de contraseña: mismo diseño del login, otra tarjeta. */}
        <Route path="/forgot-password" element={<LoginPage mode="forgot" />} />
        <Route path="/reset-password" element={<LoginPage mode="reset" />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route index element={<HomeRoute />} />
            {/* Centro de notificaciones: cada usuario ve las suyas (el backend filtra por su público). */}
            <Route path="notifications" element={<NotificationCenterPage />} />

            {/* El Coordinador entra solo a la pestaña de períodos: la página filtra las demás. */}
            <Route element={<PermissionRoute module="tenant_settings" orCoordinator />}>
              <Route path="tenant/settings" element={<TenantSettingsPage />} />
            </Route>
            {/* Dirección anterior de los períodos de evaluación. */}
            <Route path="evaluation-periods" element={<Navigate to="/tenant/settings?tab=periodos" replace />} />

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
              {/* Estructura académica en dos páginas: la base del colegio y la operación diaria. */}
              <Route path="configuracion-inicial" element={<InitialSetupPage />} />
              <Route path="secciones-academicas" element={<AcademicSectionsPage />} />
              {/* Antes "Grados y secciones" con pestañas: los enlaces viejos llegan a la página que corresponde. */}
              <Route path="academics" element={<LegacyAcademicsRedirect />} />
              <Route path="academics/sections/:id" element={<SectionDetailPage />} />
              <Route path="academics/subjects" element={<SubjectsPage />} />
            </Route>

            {/* Convivencia: sanciones disciplinarias. */}
            {/* Clubes: administración gestiona; docentes consultan (el coordinador inscribe en su club). */}
            <Route element={<PermissionRoute module="clubs" />}>
              <Route path="clubs" element={<ClubsPage />} />
            </Route>
            <Route element={<PermissionRoute module="recognitions" />}>
              <Route path="recognitions" element={<RecognitionsPage />} />
            </Route>
            <Route element={<PermissionRoute module="events" />}>
              <Route path="events" element={<EventsPage />} />
            </Route>
            <Route element={<PermissionRoute module="tenant_settings" blockTeacher />}>
              <Route path="notifications/log" element={<NotificationLogPage />} />
            </Route>
            {/* Comunicados: su propio permiso (módulo «Comunicados»), no el de Configuración. */}
            <Route element={<PermissionRoute module="announcements" blockTeacher />}>
              <Route path="notifications/announcements" element={<AnnouncementsPage />} />
            </Route>
            {/* Planillas de inscripción: diseño, bandeja y aprobación — Administrador o Admisiones (el backend exige requireAdmissions). */}
            <Route element={<PermissionRoute admissionsOnly />}>
              <Route path="enrollment-submissions" element={<EnrollmentSubmissionsPage />} />
              <Route path="enrollment-forms" element={<EnrollmentFormsPage />} />
              <Route path="enrollment-forms/:id" element={<FormBuilderPage />} />
              {/* «Ver como representante»: el portal de Inscripción de un representante del alumno, en simulación. */}
              <Route path="students/:id/portal-preview" element={<GuardianPortalPreviewPage />} />
            </Route>
            <Route element={<PermissionRoute adminOnly />}>
              <Route path="audit" element={<AuditPage />} />
              <Route path="certificates" element={<CertificateEditorPage />} />
              <Route path="support" element={<SupportPage />} />
            </Route>
            <Route element={<PermissionRoute module="appointments" />}>
              <Route path="appointments" element={<AppointmentsPage />} />
            </Route>
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
              <Route path="programmatic-content" element={<ProgrammaticContentPage />} />
            </Route>

            <Route element={<PermissionRoute module="grading" />}>
              <Route path="grading/plans/:id" element={<GradebookPage />} />
            </Route>
            {/* Materias pendientes: dirección, coordinación y el profesor asignado (el backend filtra). */}
            <Route element={<PermissionRoute carryoverUsers />}>
              {/* Apagado temporalmente (lib/features.js): la dirección lleva al inicio. */}
              <Route path="carryovers" element={isFeatureOn('carryovers') ? <CarryoversPage /> : <Navigate to="/" replace />} />
              <Route path="carryovers/simulator" element={isFeatureOn('carryovers') ? <CarryoverSimulatorPage /> : <Navigate to="/" replace />} />
            </Route>
            {/* Resumen de calificaciones: también el Coordinador (su nivel), para ajustar definitivas. */}
            <Route element={<PermissionRoute module="grading" blockTeacher orCoordinator />}>
              <Route path="grading/summary" element={<GradeSummaryPage />} />
            </Route>

            <Route element={<PermissionRoute module="payments" blockTeacher />}>
              <Route path="payments" element={<PaymentsPage />} />
              <Route path="payments/currencies" element={<CurrenciesPage />} />
            </Route>

            {/* Vista de padres: cualquier usuario autenticado con hijos asociados, sin permiso administrativo */}
            <Route element={<PermissionRoute guardianOnly blockTeacher />}>
              <Route path="payments/mine" element={<PortalViewGate view="payments"><MyPaymentsPage /></PortalViewGate>} />
            </Route>
            {/* Portal de padres: detalle y calificaciones de un representado (el backend valida el vínculo) */}
            <Route path="portal/students/:studentId" element={<PortalStudentPage />} />
            {/* Cartelera de eventos para las familias (el backend filtra por sus hijos) */}
            <Route element={<PermissionRoute guardianOnly />}>
              <Route path="portal/events" element={<PortalViewGate view="events"><PortalEventsPage /></PortalViewGate>} />
              {/* Planillas de inscripción publicadas por el colegio (el backend valida el representante). */}
              <Route path="portal/enrollment" element={<PortalEnrollmentPage />} />
            </Route>

            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
      {/* Logo de MoDo Educa al arrancar; se desvanece al validar la sesión y cargar la marca del colegio. */}
      <SplashScreen />
    </ThemeProvider>
  );
}

export default App;
