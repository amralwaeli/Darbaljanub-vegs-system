import type { ReactNode } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";
import { AuthProvider, useAuth } from "./features/auth/AuthProvider";
import LoginPage from "./features/auth/LoginPage";
import AcceptInvitePage from "./features/auth/AcceptInvitePage";
import { Layout } from "./components/Layout";
import { Button, Spinner } from "./components/ui";
import PicRequestPage from "./features/requests/PicRequestPage";
import PicPricingPage from "./features/requests/PicPricingPage";
import ManagerDashboard from "./features/purchasing/ManagerDashboard";
import VendorOrdersPage from "./features/purchasing/VendorOrdersPage";
import CostEntryPage from "./features/purchasing/CostEntryPage";
import DriverHomePage from "./features/deliveries/DriverHomePage";
import DeliveryDetailPage from "./features/deliveries/DeliveryDetailPage";
import DeliveriesOverviewPage from "./features/deliveries/DeliveriesOverviewPage";
import AdminPage from "./features/admin/AdminPage";
import { t } from "./i18n/strings";
import type { UserRole } from "./lib/database.types";

function FullSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner className="h-8 w-8 text-brand-600" />
    </div>
  );
}

function DisabledScreen() {
  const { signOut } = useAuth();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="text-4xl">🔒</span>
      <p className="max-w-sm text-gray-600">{t.accountDisabled}</p>
      <Button variant="secondary" onClick={() => void signOut()}>
        {t.logout}
      </Button>
    </div>
  );
}

/** Route guard: session + active profile + (optionally) role membership. */
function Protected({
  roles,
  children,
}: {
  roles?: UserRole[];
  children: ReactNode;
}) {
  const { session, profile, loading } = useAuth();
  if (loading) return <FullSpinner />;
  if (!session) return <Navigate to="/login" replace />;
  if (!profile) return <FullSpinner />;
  if (!profile.is_active) return <DisabledScreen />;
  if (roles && !roles.includes(profile.role)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

/** Each role lands on its own home screen. */
function RoleHome() {
  const { profile } = useAuth();
  switch (profile?.role) {
    case "pic":
      return <PicRequestPage />;
    case "driver":
      return <DriverHomePage />;
    default:
      return <ManagerDashboard />;
  }
}

function LoginRoute() {
  const { session, loading } = useAuth();
  if (loading) return <FullSpinner />;
  if (session) return <Navigate to="/" replace />;
  return <LoginPage />;
}

// GitHub Pages project sites serve under /<repo-name>/ — the router must
// treat that prefix as its root. BASE_URL comes from vite.config.ts `base`.
const BASENAME = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename={BASENAME}>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route path="/accept-invite" element={<AcceptInvitePage />} />

          <Route
            element={
              <Protected>
                <Layout />
              </Protected>
            }
          >
            <Route path="/" element={<RoleHome />} />
            <Route
              path="/prices"
              element={
                <Protected roles={["pic", "superadmin"]}>
                  <PicPricingPage />
                </Protected>
              }
            />
            <Route
              path="/vendor-orders"
              element={
                <Protected roles={["manager", "superadmin"]}>
                  <VendorOrdersPage />
                </Protected>
              }
            />
            <Route
              path="/purchase"
              element={
                <Protected roles={["manager", "superadmin"]}>
                  <CostEntryPage />
                </Protected>
              }
            />
            <Route
              path="/deliveries"
              element={
                <Protected roles={["manager", "superadmin"]}>
                  <DeliveriesOverviewPage />
                </Protected>
              }
            />
            <Route
              path="/delivery/:deliveryId"
              element={
                <Protected roles={["driver", "manager", "superadmin"]}>
                  <DeliveryDetailPage />
                </Protected>
              }
            />
            <Route
              path="/admin"
              element={
                <Protected roles={["manager", "superadmin"]}>
                  <AdminPage />
                </Protected>
              }
            />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
