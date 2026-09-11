import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './pages/ProtectedRoute';
import { AppShell } from './components/layout/AppShell';
import { BiometricGate } from './components/layout/BiometricGate';
import { RouteFallback } from './components/layout/RouteFallback';
import { AppErrorBoundary, RouteErrorBoundary } from './components/layout/ErrorBoundary';
import { useAuthStore } from './stores/useAuthStore';

// Every screen is fetched on demand. Chunks are local files inside the APK, so
// the fetch is effectively instant, and a returning signed-in user never pays
// for the auth screens' form/validation libraries at all.
const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('./pages/RegisterPage').then((m) => ({ default: m.RegisterPage })));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })));
const HomePage = lazy(() => import('./pages/HomePage').then((m) => ({ default: m.HomePage })));
const ActivityPage = lazy(() => import('./pages/ActivityPage').then((m) => ({ default: m.ActivityPage })));
const AccountsPage = lazy(() => import('./pages/AccountsPage').then((m) => ({ default: m.AccountsPage })));
const PlanPage = lazy(() => import('./pages/PlanPage').then((m) => ({ default: m.PlanPage })));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })));
const AssistantPage = lazy(() => import('./pages/AssistantPage').then((m) => ({ default: m.AssistantPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage })));

/**
 * One screen, with both of the things that can go wrong while it loads.
 *
 * The boundary sits OUTSIDE Suspense on purpose. A lazy chunk that fails to
 * load rejects rather than resolving, and that rejection surfaces as a throw
 * where the screen would have been - so a boundary nested inside Suspense
 * would be unmounted along with it and never see the error. Outside, it
 * catches both cases: the chunk that would not load, and the screen that threw
 * once it did.
 */
const Screen: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <RouteErrorBoundary>
    <Suspense fallback={<RouteFallback />}>{children}</Suspense>
  </RouteErrorBoundary>
);

export const App: React.FC = () => {
  const { isInitialized, restoreSession } = useAuthStore();

  /**
   * Restore the session once, for every route.
   *
   * This used to live only in ProtectedRoute, so a cold start that landed
   * straight on /login - which is exactly where a rejected session sends you -
   * never mounted it. The store stayed at its initial `isLoading: true`, and
   * the sign-in button, which is disabled while that flag is set, could never
   * be pressed again.
   */
  useEffect(() => {
    if (!isInitialized) void restoreSession();
  }, [isInitialized, restoreSession]);

  return (
    // Outside the router, so a fault in routing itself still lands somewhere
    // that can offer a restart rather than a white screen.
    <AppErrorBoundary>
      <BrowserRouter>
        <BiometricGate>
          <Routes>
            {/* Public Unauthenticated Auth Routes */}
            <Route path="/login" element={<Screen><LoginPage /></Screen>} />
            <Route path="/register" element={<Screen><RegisterPage /></Screen>} />
            <Route path="/forgot-password" element={<Screen><ForgotPasswordPage /></Screen>} />

            {/* Protected Authenticated Routes */}
            <Route element={<ProtectedRoute />}>
              <Route element={<AppShell />}>
                <Route path="/" element={<Screen><HomePage /></Screen>} />
                <Route path="/activity" element={<Screen><ActivityPage /></Screen>} />
                <Route path="/accounts" element={<Screen><AccountsPage /></Screen>} />
                <Route path="/plan" element={<Screen><PlanPage /></Screen>} />
                <Route path="/analytics" element={<Screen><AnalyticsPage /></Screen>} />
                <Route path="/assistant" element={<Screen><AssistantPage /></Screen>} />
                <Route path="/profile" element={<Screen><ProfilePage /></Screen>} />
              </Route>
            </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BiometricGate>
      </BrowserRouter>
    </AppErrorBoundary>
  );
};

export default App;
