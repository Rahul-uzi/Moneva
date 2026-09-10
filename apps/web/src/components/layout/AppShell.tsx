import React, { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { TopBar } from './TopBar';
import { BottomNavigation } from './BottomNavigation';
import { RouteTransition } from './RouteTransition';
import { QuickAddModal } from '../financial/QuickAddModal';
import { NotificationsModal } from '../notifications/NotificationsModal';
import { ToastContainer } from '../ui/Toast';
import { OfflineBanner, SavedDataBanner } from '../ui/States';
import { SyncStatusIndicator } from '../ui/SyncStatusIndicator';
import { useUiStore } from '../../stores/useUiStore';
import { apiClient, STALE_DATA_EVENT, FRESH_DATA_EVENT } from '../../services/apiClient';
import { runNotificationSync } from '../../services/notificationSync';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { isOnboardingPending, completeOnboarding, ONBOARDING_REQUESTED } from '../../services/onboardingService';
import { isTourPending, completeTour, markTourPending, TOUR_REQUESTED } from '../../services/tourService';
import { isSetupPending, completeSetup, markSetupPending, SETUP_REQUESTED } from '../../services/setupService';
import './AppShell.css';

// Only ever fetched for a brand-new account, so it stays out of every other launch.
const OnboardingTutorial = lazy(() => import('../onboarding/OnboardingTutorial'));
// Same reasoning: only a new account, or a deliberate replay, ever loads it.
const GuidedTour = lazy(() => import('../tour/GuidedTour'));
// Pulls in the account modal and the statement parser, so it is worth keeping
// out of every launch that is not a first run.
const FirstRunSetup = lazy(() => import('../onboarding/FirstRunSetup'));

interface AppShellProps {
  title?: string;
}

export const AppShell: React.FC<AppShellProps> = ({ title }) => {
  const navigate = useNavigate();
  const { isOnline } = useUiStore();
  const [isQuickAddOpen, setIsQuickAddOpen] = useState<boolean>(false);
  const [isNotifOpen, setIsNotifOpen] = useState<boolean>(false);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [showTutorial, setShowTutorial] = useState<boolean>(isOnboardingPending);
  /**
   * When a screen is rendering saved figures rather than live ones.
   *
   * Set from an event the api client raises when it falls back to disk, and
   * cleared by the first successful response - which on a cold start is the
   * moment the sleeping server finally answers. So the banner appears
   * immediately, alongside real figures, and removes itself without anyone
   * having to do anything.
   */
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [showSetup, setShowSetup] = useState<boolean>(isSetupPending);
  const [showTour, setShowTour] = useState<boolean>(isTourPending);

  const fetchUnreadCount = useCallback(async (isMounted: boolean) => {
    try {
      const res = await apiClient.get<{ unread_count: number }>('/notifications/unread-count');
      if (isMounted) {
        setUnreadCount(res.data.unread_count);
      }
    } catch {
      // Ignore count fetch errors
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const timer = setTimeout(() => {
      void fetchUnreadCount(isMounted);
    }, 0);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [fetchUnreadCount, refreshTrigger]);

  useEffect(() => {
    const onStale = (e: Event) => {
      const detail = (e as CustomEvent<{ savedAt: number }>).detail;
      if (detail?.savedAt) setSavedAt(detail.savedAt);
    };
    const onFresh = () => setSavedAt(null);
    window.addEventListener(STALE_DATA_EVENT, onStale);
    window.addEventListener(FRESH_DATA_EVENT, onFresh);
    return () => {
      window.removeEventListener(STALE_DATA_EVENT, onStale);
      window.removeEventListener(FRESH_DATA_EVENT, onFresh);
    };
  }, []);

  // Replaying the tutorial from Profile happens while this shell is mounted,
  // so listen for the request instead of only reading storage at mount.
  useEffect(() => {
    const onRequested = () => setShowTutorial(true);
    const onTourRequested = () => setShowTour(true);
    const onSetupRequested = () => setShowSetup(true);
    window.addEventListener(ONBOARDING_REQUESTED, onRequested);
    window.addEventListener(TOUR_REQUESTED, onTourRequested);
    window.addEventListener(SETUP_REQUESTED, onSetupRequested);
    return () => {
      window.removeEventListener(ONBOARDING_REQUESTED, onRequested);
      window.removeEventListener(TOUR_REQUESTED, onTourRequested);
      window.removeEventListener(SETUP_REQUESTED, onSetupRequested);
    };
  }, []);

  /**
   * Make reminders real. Once on launch and every time the app returns to the
   * foreground: post anything newly due to the tray and re-plan the device
   * alarms for what is coming. Before this, nothing ran unless the user opened
   * the bell modal, so no reminder ever arrived with the app closed.
   */
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    // Deferred, as elsewhere here, so the first paint is not held up.
    const timer = setTimeout(() => {
      void runNotificationSync();
    }, 1500);

    const resumeHandler = App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void runNotificationSync();
    });

    return () => {
      clearTimeout(timer);
      void resumeHandler.then((h) => h.remove());
    };
  }, []);

  // Hardware Back Button Handling for Android
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const backButtonHandler = App.addListener('backButton', (data) => {
      if (showTour) {
        completeTour();
        setShowTour(false);
        return;
      }
      if (showTutorial) {
        completeOnboarding();
        setShowTutorial(false);
        return;
      }
      if (showSetup) {
        completeSetup();
        setShowSetup(false);
        return;
      }
      if (isQuickAddOpen) {
        setIsQuickAddOpen(false);
        return;
      }
      if (isNotifOpen) {
        setIsNotifOpen(false);
        return;
      }
      if (data.canGoBack) {
        navigate(-1);
      } else {
        void App.exitApp();
      }
    });

    return () => {
      void backButtonHandler.then((h) => h.remove());
    };
  }, [isQuickAddOpen, isNotifOpen, showTutorial, showSetup, showTour, navigate]);

  const handleQuickAddSuccess = () => {
    setRefreshTrigger((prev) => prev + 1);
    void fetchUnreadCount(true);
    // A new bill or payment changes what is due; re-plan straight away.
    void runNotificationSync({ force: true });
  };

  return (
    <div className="app-viewport">
      {!isOnline && <OfflineBanner />}
      {/* Only when online: offline already has its own banner, and stacking
          two strips of explanation above the content says less than one. */}
      {isOnline && savedAt !== null && (
        <SavedDataBanner
          savedAt={savedAt}
          onRetry={() => setRefreshTrigger((prev) => prev + 1)}
        />
      )}
      <TopBar
        title={title}
        unreadCount={unreadCount}
        onNotificationClick={() => setIsNotifOpen(true)}
        onProfileClick={() => navigate('/profile')}
      />
      <SyncStatusIndicator />
      <main className="app-content">
        <RouteTransition>
          <Outlet context={{ refreshTrigger }} />
        </RouteTransition>
      </main>
      <BottomNavigation onQuickAddClick={() => setIsQuickAddOpen(true)} />
      <QuickAddModal
        isOpen={isQuickAddOpen}
        onClose={() => setIsQuickAddOpen(false)}
        onSuccess={handleQuickAddSuccess}
      />
      <NotificationsModal
        isOpen={isNotifOpen}
        onClose={() => setIsNotifOpen(false)}
        onNotificationsUpdated={() => void fetchUnreadCount(true)}
      />
      <ToastContainer />
      {showTutorial && (
        <Suspense fallback={null}>
          <OnboardingTutorial
            onFinish={() => {
              completeOnboarding();
              setShowTutorial(false);
              // The slideshow said what the app does. Before showing WHERE,
              // give it something to show: an account, and optionally a
              // statement. A guided tour of six empty screens teaches
              // nothing. Marked pending first so an interrupted setup
              // resumes on next launch.
              markSetupPending();
            }}
          />
        </Suspense>
      )}
      {showSetup && !showTutorial && (
        <Suspense fallback={null}>
          <FirstRunSetup
            onFinish={() => {
              completeSetup();
              setShowSetup(false);
              markTourPending();
            }}
          />
        </Suspense>
      )}
      {showTour && !showTutorial && !showSetup && (
        <Suspense fallback={null}>
          <GuidedTour
            onFinish={() => {
              completeTour();
              setShowTour(false);
              navigate('/');
            }}
          />
        </Suspense>
      )}
    </div>
  );
};
