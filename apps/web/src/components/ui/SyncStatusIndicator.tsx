import React, { useEffect, useState } from 'react';
import { RefreshCw, WifiOff, AlertCircle, CheckCircle2 } from 'lucide-react';
import { syncEngine, type SyncState } from '../../services/syncEngine';
import { useAuthStore } from '../../stores/useAuthStore';
import './SyncStatusIndicator.css';

export const SyncStatusIndicator: React.FC = () => {
  const { user } = useAuthStore();
  const [syncState, setSyncState] = useState<SyncState>('SYNCED');
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (user?.id) {
      syncEngine.setUserId(user.id);
    } else {
      syncEngine.setUserId(null);
    }

    const unsubscribe = syncEngine.subscribe((state, count, err) => {
      setSyncState(state);
      setPendingCount(count);
      setErrorMsg(err);
    });

    return () => unsubscribe();
  }, [user]);

  if (syncState === 'SYNCED' && pendingCount === 0) return null;

  return (
    <div className={`sync-indicator-bar sync-state-${syncState.toLowerCase()}`}>
      <div className="sync-indicator-content">
        {syncState === 'SYNCING' && (
          <>
            <RefreshCw size={14} className="spin-icon text-blue" />
            <span>Syncing local changes ({pendingCount} remaining)...</span>
          </>
        )}
        {syncState === 'OFFLINE' && (
          <>
            <WifiOff size={14} className="text-orange" />
            <span>Offline — {pendingCount} changes saved locally pending sync</span>
          </>
        )}
        {syncState === 'SYNC_ERROR' && (
          <>
            <AlertCircle size={14} className="text-coral" />
            <span>Sync Error ({pendingCount} pending): {errorMsg || 'Server connection issue'}</span>
          </>
        )}
        {syncState === 'ONLINE' && pendingCount > 0 && (
          <>
            <CheckCircle2 size={14} className="text-teal" />
            <span>Connected — {pendingCount} operations queued</span>
          </>
        )}
      </div>
    </div>
  );
};
