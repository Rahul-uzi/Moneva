import React, { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { TopBar } from './TopBar';
import { BottomNavigation } from './BottomNavigation';
import { QuickAddModal } from '../financial/QuickAddModal';
import { NotificationsModal } from '../notifications/NotificationsModal';
import { ToastContainer } from '../ui/Toast';
import { OfflineBanner } from '../ui/States';
import { SyncStatusIndicator } from '../ui/SyncStatusIndicator';
import { useUiStore } from '../../stores/useUiStore';
import { apiClient } from '../../services/apiClient';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { isOnboardingPending, completeOnboarding, ONBOARDING_REQUESTED } from '../../services/onboardingService';
import './AppShell.css';

// Only ever fetched for a brand-new account, so it stays out of every other launch.
const OnboardingTutorial = lazy(() => import('../onboarding/OnboardingTutorial'));

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

  // Replaying the tutorial from Profile happens while this shell is mounted,
  // so listen for the request instead of only reading storage at mount.
  useEffect(() => {
    const onRequested = () => setShowTutorial(true);
    window.addEventListener(ONBOARDING_REQUESTED, onRequested);
    return () => window.removeEventListener(ONBOARDING_REQUESTED, onRequested);
  }, []);

  // Hardware Back Button Handling for Android
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const backButtonHandler = App.addListener('backButton', (data) => {
      if (showTutorial) {
        completeOnboarding();
        setShowTutorial(false);
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
  }, [isQuickAddOpen, isNotifOpen, showTutorial, navigate]);

  const handleQuickAddSuccess = () => {
    setRefreshTrigger((prev) => prev + 1);
    void fetchUnreadCount(true);
  };

  return (
    <div className="app-viewport">
      {!isOnline && <OfflineBanner />}
      <TopBar
        title={title}
        unreadCount={unreadCount}
        onNotificationClick={() => setIsNotifOpen(true)}
        onProfileClick={() => navigate('/profile')}
      />
      <SyncStatusIndicator />
      <main className="app-content">
        <Outlet context={{ refreshTrigger }} />
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
            }}
          />
        </Suspense>
      )}
    </div>
  );
};
