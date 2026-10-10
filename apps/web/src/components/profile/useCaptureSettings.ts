import { useEffect, useState } from 'react';
import { nativeNotificationService, type PermissionStatus } from '../../services/notificationService';
import { runNotificationSync } from '../../services/notificationSync';
import { loadAutoAddSettings, saveAutoAddSettings, forgetAllTrust } from '../../services/autoAddStore';
import {
  getCaptureStatus,
  isCaptureSupported,
  reconnectListener,
  requestBatteryExemption,
  type CaptureStatus,
} from '../../services/notificationCapture';
import { captureHealth } from '../../utils/captureHealth';
import { useUiStore } from '../../stores/useUiStore';

const EMPTY: CaptureStatus = {
  granted: false, capturing: false, lastKeptAt: 0, keptCount: 0, enabledAt: 0,
  connected: false, connectedAt: 0, batteryExempt: false, manufacturer: '',
};

/**
 * Everything "Catching payments" knows, shared by the row on the Profile list
 * (which only shows a summary) and the sheet behind it (which shows it all).
 *
 * `paused` stops the re-read while the payment inbox is open on top: the user
 * may grant or revoke access in there, and the answer is read when it closes.
 */
export const useCaptureSettings = (paused: boolean) => {
  const { addToast } = useUiStore();
  const [capture, setCaptureState] = useState<CaptureStatus>(EMPTY);
  // The moment the status was read: health is judged against it, not against
  // whenever React happens to render.
  const [readAt, setReadAt] = useState(() => Date.now());
  const setCapture = (next: CaptureStatus) => { setCaptureState(next); setReadAt(Date.now()); };
  const [devicePerm, setDevicePerm] = useState<PermissionStatus>('prompt');
  const [isEnablingPerm, setIsEnablingPerm] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  // Read once from this device rather than from the server: see autoAddStore
  // for why trust that fails towards "ask" has to be local.
  const [autoAdd, setAutoAdd] = useState(() => loadAutoAddSettings());

  useEffect(() => {
    if (paused) return;
    void getCaptureStatus().then(setCapture);
  }, [paused]);

  useEffect(() => {
    // The battery-exemption dialog and the notification-access screen are
    // other Activities, so "did they allow it" only exists once we are back.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void getCaptureStatus().then(setCapture);
        void nativeNotificationService.checkPermission().then(setDevicePerm);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { void nativeNotificationService.checkPermission().then(setDevicePerm); }, 0);
    return () => clearTimeout(t);
  }, []);

  // Derived on render: this is a reading of the clock as much as of the
  // switch, and a stored copy would quietly go stale.
  const health = captureHealth({
    supported: isCaptureSupported(),
    granted: capture.granted,
    capturing: capture.capturing,
    lastKeptAt: capture.lastKeptAt,
    keptCount: capture.keptCount,
    enabledAt: capture.enabledAt,
    connected: capture.connected,
    connectedAt: capture.connectedAt,
    batteryExempt: capture.batteryExempt,
    manufacturer: capture.manufacturer,
    now: readAt,
  });

  const enableNotifications = async () => {
    setIsEnablingPerm(true);
    try {
      const status = await nativeNotificationService.requestPermission();
      setDevicePerm(status);
      if (status === 'granted') {
        await runNotificationSync({ force: true });
        addToast('Reminders are on. You will be told before bills are due.', 'success');
      } else {
        addToast('Notifications are blocked for MONEVA in Android settings.', 'warning');
      }
    } finally {
      setIsEnablingPerm(false);
    }
  };

  const reconnect = async () => {
    setIsReconnecting(true);
    try {
      await reconnectListener();
      // Binding is asynchronous on Android's side; give it a beat first.
      await new Promise((r) => setTimeout(r, 1500));
      setCapture(await getCaptureStatus());
    } finally {
      setIsReconnecting(false);
    }
  };

  const setAutoAddEnabled = (enabled: boolean) => {
    const next = { ...autoAdd, enabled };
    setAutoAdd(next);
    saveAutoAddSettings(next);
    /* Turning it off forgets what was learned. Switching this off after it got
       something wrong means "stop, and do not resume where you left off". */
    if (!enabled) forgetAllTrust();
  };

  return {
    supported: isCaptureSupported(),
    capture,
    health,
    devicePerm,
    isEnablingPerm,
    isReconnecting,
    autoAdd,
    enableNotifications,
    reconnect,
    requestBatteryExemption,
    setAutoAddEnabled,
  };
};

export type CaptureSettings = ReturnType<typeof useCaptureSettings>;
