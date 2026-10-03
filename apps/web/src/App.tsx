import type { ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Permission } from '@nsut/shared';
import { useAuth } from './lib/auth';
import { AppLayout } from './components/Layout';
import { EmptyState, Skeleton } from './components/ui';
import { ForgotPasswordPage, LoginPage, ResetPasswordPage } from './pages/AuthPages';
import { DashboardPage } from './pages/DashboardPage';
import { CalendarPage, CorrectionsPage, LivePresencePage, MonthlyPage, TodayAttendancePage } from './pages/AttendancePages';
import { MyAttendancePage } from './pages/MyAttendancePage';
import { ActivitiesPage, PeopleListPage, PersonFormPage, PersonProfilePage } from './pages/PeoplePages';
import { LeavePage } from './pages/LeavePage';
import { ReportPage, ReportsIndexPage } from './pages/ReportsPage';
import { AuditPage, ProfilePage, RolesPage, RulesPage, SettingsPage, UsersPage } from './pages/AdminPages';

function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading)
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-label="Loading">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  if (!me) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <>{children}</>;
}

function Guard({ perm, children }: { perm: Permission | Permission[]; children: ReactNode }) {
  const { can } = useAuth();
  const perms = Array.isArray(perm) ? perm : [perm];
  if (!perms.some(can)) return <Forbidden />;
  return <>{children}</>;
}

function Home() {
  const { can } = useAuth();
  if (can('dashboard.view')) return <DashboardPage />;
  return <Navigate to="/me" replace />;
}

function Forbidden() {
  return (
    <div className="panel">
      <EmptyState title="You do not have permission to view this page." body="If you believe this is a mistake, contact the system administrator." action={<Link to="/">Go to home</Link>} />
    </div>
  );
}

function NotFound() {
  return (
    <div className="panel">
      <EmptyState title="Page not found" body="The page you requested does not exist." action={<Link to="/">Go to home</Link>} />
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<Home />} />
          <Route path="me" element={<Guard perm="attendance.self"><MyAttendancePage /></Guard>} />
          <Route path="attendance/today" element={<Guard perm="attendance.read"><TodayAttendancePage /></Guard>} />
          <Route path="attendance/live" element={<Guard perm="attendance.read"><LivePresencePage /></Guard>} />
          <Route path="attendance/calendar" element={<Guard perm="attendance.read"><CalendarPage /></Guard>} />
          <Route path="attendance/monthly" element={<Guard perm="attendance.read"><MonthlyPage /></Guard>} />
          <Route path="attendance/corrections" element={<Guard perm="attendance.read"><CorrectionsPage /></Guard>} />
          <Route path="people/faculty" element={<Guard perm="people.read"><PeopleListPage key="gf" type="GUEST_FACULTY" /></Guard>} />
          <Route path="people/coaches" element={<Guard perm="people.read"><PeopleListPage key="sc" type="SPORTS_COACH" /></Guard>} />
          <Route path="people/new" element={<Guard perm="people.write"><PersonFormPage /></Guard>} />
          <Route path="people/:id/edit" element={<Guard perm="people.write"><PersonFormPage /></Guard>} />
          <Route path="people/:id" element={<Guard perm="people.read"><PersonProfilePage /></Guard>} />
          <Route path="activities" element={<Guard perm="people.read"><ActivitiesPage /></Guard>} />
          <Route path="leave" element={<Guard perm={['leave.self', 'leave.review']}><LeavePage /></Guard>} />
          <Route path="reports" element={<Guard perm="reports.generate"><ReportsIndexPage /></Guard>} />
          <Route path="reports/:type" element={<Guard perm="reports.generate"><ReportPage /></Guard>} />
          <Route path="admin/users" element={<Guard perm="users.manage"><UsersPage /></Guard>} />
          <Route path="admin/roles" element={<Guard perm="users.manage"><RolesPage /></Guard>} />
          <Route path="admin/rules" element={<Guard perm={['rules.manage', 'dashboard.view']}><RulesPage /></Guard>} />
          <Route path="admin/settings" element={<Guard perm="settings.manage"><SettingsPage /></Guard>} />
          <Route path="audit" element={<Guard perm="audit.read"><AuditPage /></Guard>} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
