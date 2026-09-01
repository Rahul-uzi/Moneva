import { BiometricAuth, BiometryType } from '@aparajita/capacitor-biometric-auth';
import { Preferences } from '@capacitor/preferences';

const LOCK_KEY = 'moneva_biometric_lock';

export interface BiometricStatus {
  available: boolean;
  /** Human-readable sensor name, e.g. "Fingerprint" — null when unavailable. */
  label: string | null;
  reason: string | null;
}

const BIOMETRY_LABELS: Partial<Record<BiometryType, string>> = {
  [BiometryType.touchId]: 'Touch ID',
  [BiometryType.faceId]: 'Face ID',
  [BiometryType.fingerprintAuthentication]: 'Fingerprint',
  [BiometryType.faceAuthentication]: 'Face Unlock',
  [BiometryType.irisAuthentication]: 'Iris',
};

/** Reports whether this device can actually perform a biometric check right now. */
export const getBiometricStatus = async (): Promise<BiometricStatus> => {
  try {
    const info = await BiometricAuth.checkBiometry();
    if (!info.isAvailable) {
      return {
        available: false,
        label: null,
        reason: info.reason || 'No biometric sensor is enrolled on this device.',
      };
    }
    return {
      available: true,
      label: BIOMETRY_LABELS[info.biometryType] ?? 'Biometrics',
      reason: null,
    };
  } catch (err) {
    // Plugin missing (e.g. running in a desktop browser) — degrade quietly.
    return {
      available: false,
      label: null,
      reason: err instanceof Error ? err.message : 'Biometrics are unavailable here.',
    };
  }
};

export const isBiometricLockEnabled = async (): Promise<boolean> => {
  try {
    const { value } = await Preferences.get({ key: LOCK_KEY });
    return value === 'true';
  } catch {
    return false;
  }
};

export const setBiometricLockEnabled = async (enabled: boolean): Promise<void> => {
  await Preferences.set({ key: LOCK_KEY, value: enabled ? 'true' : 'false' });
};

/** Prompts for the user's fingerprint/face. Resolves true only on a successful match. */
export const promptBiometric = async (reason = 'Unlock MONEVA'): Promise<boolean> => {
  try {
    await BiometricAuth.authenticate({
      reason,
      cancelTitle: 'Cancel',
      allowDeviceCredential: true,
      androidTitle: 'MONEVA',
      androidSubtitle: reason,
    });
    return true;
  } catch {
    return false;
  }
};
