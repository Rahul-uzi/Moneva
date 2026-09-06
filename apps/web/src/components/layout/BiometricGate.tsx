import React from 'react';
import { Fingerprint } from 'lucide-react';
import { Button } from '../ui/Button';
import { Illustration } from '../ui/Illustration';
import { isBiometricLockEnabled, promptBiometric } from '../../services/biometricService';
import { useAuthStore } from '../../stores/useAuthStore';
import './BiometricGate.css';

type GateState = 'checking' | 'locked' | 'unlocked';

/**
 * Blocks the authenticated app behind a biometric prompt when the user has
 * turned the app lock on. Unauthenticated users are never gated - the login
 * screen is its own barrier.
 */
export const BiometricGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuthStore();
  const [state, setState] = React.useState<GateState>('checking');

  const attemptUnlock = React.useCallback(async () => {
    const ok = await promptBiometric('Unlock MONEVA');
    setState(ok ? 'unlocked' : 'locked');
  }, []);

  React.useEffect(() => {
    let active = true;
    void (async () => {
      if (!isAuthenticated) {
        if (active) setState('unlocked');
        return;
      }
      const enabled = await isBiometricLockEnabled();
      if (!active) return;
      if (!enabled) {
        setState('unlocked');
        return;
      }
      const ok = await promptBiometric('Unlock MONEVA');
      if (active) setState(ok ? 'unlocked' : 'locked');
    })();
    return () => {
      active = false;
    };
  }, [isAuthenticated]);

  if (state === 'unlocked') return <>{children}</>;

  return (
    <div className="biometric-gate">
      <div className="biometric-gate-inner">
        <Illustration name="secure" size={196} />
        <h1 className="heading-lg">MONEVA is locked</h1>
        <p className="text-body">
          {state === 'checking'
            ? 'Checking your app lock…'
            : 'Verify your identity to continue.'}
        </p>
        {state === 'locked' && (
          <Button variant="primary" fullWidth onClick={() => void attemptUnlock()}>
            <Fingerprint size={16} />
            Unlock
          </Button>
        )}
      </div>
    </div>
  );
};
