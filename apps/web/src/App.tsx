import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './pages/ProtectedRoute';
import { AppShell } from './components/layout/AppShell';
import { BiometricGate } from './components/layout/BiometricGate';
import { RouteFallback } from './components/layout/RouteFallback';

// Every screen is fetched on demand. Chunks are local files inside the APK, so
// the fetch is effectively instant, and a returning signed-in user never pays
// for the auth screens' form/validation libraries at all.
const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('./pages/RegisterPage').then((m) => ({ default: m.RegisterPage })));
const HomePage = lazy(() => import('./pages/HomePage').then((m) => ({ default: m.HomePage })));
const ActivityPage = lazy(() => import('./pages/ActivityPage').then((m) => ({ default: m.ActivityPage })));
const AccountsPage = lazy(() => import('./pages/AccountsPage').then((m) => ({ default: m.AccountsPage })));
const PlanPage = lazy(() => import('./pages/PlanPage').then((m) => ({ default: m.PlanPage })));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })));
const AssistantPage = lazy(() => import('./pages/AssistantPage').then((m) => ({ default: m.AssistantPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage })));

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <BiometricGate>
        <Routes>
          {/* Public Unauthenticated Auth Routes */}
          <Route path="/login" element={<Suspense fallback={<RouteFallback />}><LoginPage /></Suspense>} />
          <Route path="/register" element={<Suspense fallback={<RouteFallback />}><RegisterPage /></Suspense>} />

          {/* Protected Authenticated Routes */}
          <Route element={<ProtectedRoute />}>
            <Route element={<AppShell />}>
              <Route path="/" element={<Suspense fallback={<RouteFallback />}><HomePage /></Suspense>} />
              <Route path="/activity" element={<Suspense fallback={<RouteFallback />}><ActivityPage /></Suspense>} />
              <Route path="/accounts" element={<Suspense fallback={<RouteFallback />}><AccountsPage /></Suspense>} />
              <Route path="/plan" element={<Suspense fallback={<RouteFallback />}><PlanPage /></Suspense>} />
              <Route path="/analytics" element={<Suspense fallback={<RouteFallback />}><AnalyticsPage /></Suspense>} />
              <Route path="/assistant" element={<Suspense fallback={<RouteFallback />}><AssistantPage /></Suspense>} />
              <Route path="/profile" element={<Suspense fallback={<RouteFallback />}><ProfilePage /></Suspense>} />
            </Route>
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BiometricGate>
    </BrowserRouter>
  );
};

export default App;
