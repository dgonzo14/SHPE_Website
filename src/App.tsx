import { lazy, Suspense, useState } from "react";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";

import { ScrollToTop } from "./components/ScrollToTop";
import { ErrorBoundary } from "./components/shared/ErrorBoundary";
import { FullPageLoader } from "./components/shared/states";
import { ToastProvider } from "./components/ui/ToastProvider";
import { AuthProvider } from "./auth/AuthProvider";
import { RedirectIfAuthenticated, RequireAuth } from "./auth/RequireAuth";
import { RequireRole } from "./auth/RequireRole";
import { createAppQueryClient } from "./lib/queryClient";
import { PublicLayout } from "./layouts/PublicLayout";

/*
 * Route-level code splitting throughout.
 *
 * The portal and admin surfaces are the biggest part of the app and a
 * prospective member reading the homepage should never download them. Supabase
 * and React Query are split into their own vendor chunks (see vite.config.ts)
 * for the same reason.
 */

// Public
const Home = lazy(() => import("./pages/Home").then((m) => ({ default: m.Home })));
const Members = lazy(() => import("./pages/Members").then((m) => ({ default: m.Members })));
const Sponsorship = lazy(() =>
  import("./pages/Sponsorship").then((m) => ({ default: m.Sponsorship })),
);
const GetPluggedIn = lazy(() =>
  import("./pages/GetPluggedIn").then((m) => ({ default: m.GetPluggedIn })),
);
const Leadership = lazy(() =>
  import("./pages/Leadership").then((m) => ({ default: m.Leadership })),
);
const NotFound = lazy(() => import("./pages/NotFound").then((m) => ({ default: m.NotFound })));

// Auth
const AuthLayout = lazy(() => import("./layouts/AuthLayout").then((m) => ({ default: m.AuthLayout })));
const Login = lazy(() => import("./pages/auth/Login").then((m) => ({ default: m.Login })));
const Register = lazy(() => import("./pages/auth/Register").then((m) => ({ default: m.Register })));
const ForgotPassword = lazy(() =>
  import("./pages/auth/ForgotPassword").then((m) => ({ default: m.ForgotPassword })),
);
const ResetPassword = lazy(() =>
  import("./pages/auth/ResetPassword").then((m) => ({ default: m.ResetPassword })),
);

// Member portal
const PortalLayout = lazy(() =>
  import("./layouts/PortalLayout").then((m) => ({ default: m.PortalLayout })),
);
const Dashboard = lazy(() =>
  import("./pages/portal/Dashboard").then((m) => ({ default: m.Dashboard })),
);
const PortalEvents = lazy(() =>
  import("./pages/portal/Events").then((m) => ({ default: m.Events })),
);
const PortalEventDetail = lazy(() =>
  import("./pages/portal/EventDetail").then((m) => ({ default: m.EventDetail })),
);
const CheckIn = lazy(() => import("./pages/portal/CheckIn").then((m) => ({ default: m.CheckIn })));
const Points = lazy(() => import("./pages/portal/Points").then((m) => ({ default: m.Points })));
const History = lazy(() => import("./pages/portal/History").then((m) => ({ default: m.History })));
const PortalAnnouncements = lazy(() =>
  import("./pages/portal/Announcements").then((m) => ({ default: m.Announcements })),
);
const PortalResources = lazy(() =>
  import("./pages/portal/Resources").then((m) => ({ default: m.Resources })),
);
const Membership = lazy(() =>
  import("./pages/portal/Membership").then((m) => ({ default: m.Membership })),
);
const Profile = lazy(() => import("./pages/portal/Profile").then((m) => ({ default: m.Profile })));
const Settings = lazy(() =>
  import("./pages/portal/Settings").then((m) => ({ default: m.Settings })),
);

// Admin
const AdminLayout = lazy(() =>
  import("./layouts/AdminLayout").then((m) => ({ default: m.AdminLayout })),
);
const AdminDashboard = lazy(() =>
  import("./pages/admin/AdminDashboard").then((m) => ({ default: m.AdminDashboard })),
);
const AdminEvents = lazy(() =>
  import("./pages/admin/AdminEvents").then((m) => ({ default: m.AdminEvents })),
);
const AdminEventForm = lazy(() =>
  import("./pages/admin/AdminEventForm").then((m) => ({ default: m.AdminEventForm })),
);
const AdminAttendance = lazy(() =>
  import("./pages/admin/AdminAttendance").then((m) => ({ default: m.AdminAttendance })),
);
const AdminEventAttendance = lazy(() =>
  import("./pages/admin/AdminEventAttendance").then((m) => ({ default: m.AdminEventAttendance })),
);
const AdminMembers = lazy(() =>
  import("./pages/admin/AdminMembers").then((m) => ({ default: m.AdminMembers })),
);
const AdminMemberDetail = lazy(() =>
  import("./pages/admin/AdminMemberDetail").then((m) => ({ default: m.AdminMemberDetail })),
);
const AdminPoints = lazy(() =>
  import("./pages/admin/AdminPoints").then((m) => ({ default: m.AdminPoints })),
);
const AdminAnnouncements = lazy(() =>
  import("./pages/admin/AdminAnnouncements").then((m) => ({ default: m.AdminAnnouncements })),
);
const AdminResources = lazy(() =>
  import("./pages/admin/AdminResources").then((m) => ({ default: m.AdminResources })),
);
const AdminAnalytics = lazy(() =>
  import("./pages/admin/AdminAnalytics").then((m) => ({ default: m.AdminAnalytics })),
);
const AdminAuditLog = lazy(() =>
  import("./pages/admin/AdminAuditLog").then((m) => ({ default: m.AdminAuditLog })),
);

/**
 * Vite sets BASE_URL to "/" in dev and to `base` from vite.config in
 * production. React Router wants "" for a root deployment, not "/".
 */
const routerBasename = import.meta.env.BASE_URL.replace(/\/$/, "") || undefined;

export default function App() {
  // One client for the app's lifetime. Created in state rather than at module
  // scope so it is not shared across renders in tests.
  const [queryClient] = useState(createAppQueryClient);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <Router basename={routerBasename}>
            {/* Inside Router so it can read location */}
            <ScrollToTop />
            <AuthProvider>
              <Suspense fallback={<FullPageLoader />}>
                <Routes>
                  {/* ── Public site ─────────────────────────────────── */}
                  <Route element={<PublicLayout />}>
                    <Route path="/" element={<Home />} />
                    <Route path="/members" element={<Members />} />
                    <Route path="/sponsorship" element={<Sponsorship />} />
                    <Route path="/get-plugged-in" element={<GetPluggedIn />} />
                    <Route path="/leadership" element={<Leadership />} />
                  </Route>

                  {/* ── Authentication ──────────────────────────────── */}
                  <Route element={<AuthLayout />}>
                    {/* A signed-in member has no business on sign-in or
                        registration, so those redirect to the portal. Password
                        reset does not: that flow *arrives* with a session. */}
                    <Route element={<RedirectIfAuthenticated />}>
                      <Route path="/login" element={<Login />} />
                      <Route path="/register" element={<Register />} />
                      <Route path="/forgot-password" element={<ForgotPassword />} />
                    </Route>
                    <Route path="/reset-password" element={<ResetPassword />} />
                  </Route>

                  {/* ── Member portal ───────────────────────────────── */}
                  <Route element={<RequireAuth />}>
                    <Route path="/portal" element={<PortalLayout />}>
                      <Route index element={<Dashboard />} />
                      <Route path="events" element={<PortalEvents />} />
                      <Route path="events/:eventId" element={<PortalEventDetail />} />
                      <Route path="check-in" element={<CheckIn />} />
                      <Route path="points" element={<Points />} />
                      <Route path="history" element={<History />} />
                      <Route path="announcements" element={<PortalAnnouncements />} />
                      <Route path="resources" element={<PortalResources />} />
                      <Route path="membership" element={<Membership />} />
                      <Route path="profile" element={<Profile />} />
                      <Route path="settings" element={<Settings />} />
                    </Route>

                    {/* ── Admin ─────────────────────────────────────── */}
                    <Route element={<RequireRole allow={["officer", "admin"]} />}>
                      <Route path="/admin" element={<AdminLayout />}>
                        <Route index element={<AdminDashboard />} />
                        <Route path="events" element={<AdminEvents />} />
                        <Route path="events/new" element={<AdminEventForm />} />
                        <Route path="events/:eventId" element={<AdminEventForm />} />
                        <Route path="attendance" element={<AdminAttendance />} />
                        <Route path="attendance/:eventId" element={<AdminEventAttendance />} />
                        <Route path="members" element={<AdminMembers />} />
                        <Route path="members/:memberId" element={<AdminMemberDetail />} />
                        <Route path="points" element={<AdminPoints />} />
                        <Route path="announcements" element={<AdminAnnouncements />} />
                        <Route path="resources" element={<AdminResources />} />
                        <Route path="analytics" element={<AdminAnalytics />} />
                        <Route path="audit-log" element={<AdminAuditLog />} />
                      </Route>
                    </Route>
                  </Route>

                  {/* A real 404, not a redirect that hides broken links. */}
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </AuthProvider>
          </Router>
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
