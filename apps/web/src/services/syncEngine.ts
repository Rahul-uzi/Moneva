import { apiClient } from './apiClient';
import {
  getPendingOperations,
  removeOperation,
  updateOperationStatus,
  type PendingOperation,
} from './offlineStore';

export type SyncState = 'ONLINE' | 'OFFLINE' | 'SYNCING' | 'SYNCED' | 'SYNC_ERROR';

type SyncListener = (state: SyncState, pendingCount: number, errorMsg?: string) => void;

class SyncEngine {
  private state: SyncState = typeof navigator !== 'undefined' && navigator.onLine ? 'SYNCED' : 'OFFLINE';
  private pendingCount = 0;
  private isSyncingLock = false;
  private listeners: Set<SyncListener> = new Set();
  private currentUserId: string | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleNetworkChange(true));
      window.addEventListener('offline', () => this.handleNetworkChange(false));
    }
  }

  public setUserId(userId: string | null) {
    this.currentUserId = userId;
    if (userId) {
      void this.refreshPendingCount();
    } else {
      this.pendingCount = 0;
      this.notifyListeners();
    }
  }

  public subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    listener(this.state, this.pendingCount);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(errorMsg?: string) {
    this.listeners.forEach((listener) => listener(this.state, this.pendingCount, errorMsg));
  }

  private handleNetworkChange(isOnline: boolean) {
    if (!isOnline) {
      this.state = 'OFFLINE';
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.notifyListeners();
    } else {
      this.state = 'ONLINE';
      this.notifyListeners();
      if (this.currentUserId) {
        void this.triggerSync();
      }
    }
  }

  public async refreshPendingCount(): Promise<number> {
    if (!this.currentUserId) return 0;
    try {
      const ops = await getPendingOperations(this.currentUserId);
      this.pendingCount = ops.length;
      this.notifyListeners();
      return this.pendingCount;
    } catch {
      return 0;
    }
  }

  public async triggerSync(): Promise<void> {
    if (this.isSyncingLock || !navigator.onLine || !this.currentUserId) return;

    this.isSyncingLock = true;
    this.state = 'SYNCING';
    this.notifyListeners();

    let hasError = false;

    try {
      const ops = await getPendingOperations(this.currentUserId);
      this.pendingCount = ops.length;

      if (ops.length === 0) {
        this.state = 'SYNCED';
        this.isSyncingLock = false;
        this.notifyListeners();
        return;
      }

      for (const op of ops) {
        if (!navigator.onLine) {
          this.state = 'OFFLINE';
          break;
        }

        const success = await this.processOperation(op);
        if (!success) {
          hasError = true;
          break;
        }
      }

      await this.refreshPendingCount();
      if (!hasError && this.pendingCount === 0) {
        this.state = 'SYNCED';
      }
    } catch (err: unknown) {
      this.state = 'SYNC_ERROR';
      const msg = (err as Error).message || 'Synchronization failed.';
      this.notifyListeners(msg);
    } finally {
      this.isSyncingLock = false;
      this.notifyListeners();
    }
  }

  private async processOperation(op: PendingOperation): Promise<boolean> {
    await updateOperationStatus(op.id, 'syncing');

    try {
      if (op.method === 'POST') {
        await apiClient.post(op.endpoint, op.payload);
      } else if (op.method === 'PATCH') {
        await apiClient.patch(op.endpoint, op.payload);
      } else if (op.method === 'DELETE') {
        await apiClient.delete(op.endpoint);
      }

      // On successful sync, remove operation from local pending queue
      await removeOperation(op.id);
      return true;
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } }).response?.status;
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail || (err as Error).message;

      // 400 or 422: Non-retryable validation error -> Mark operation failed and do not retry forever
      if (status === 400 || status === 422) {
        await updateOperationStatus(op.id, 'failed', detail);
        return false;
      }

      // 401: Unauthorized -> Pause sync
      if (status === 401) {
        this.state = 'SYNC_ERROR';
        await updateOperationStatus(op.id, 'pending', 'Authentication required.');
        return false;
      }

      // 5xx or Network Error: Transient error -> Schedule backoff retry
      this.state = 'SYNC_ERROR';
      await updateOperationStatus(op.id, 'pending', detail);

      if (!this.retryTimer && navigator.onLine) {
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          if (this.currentUserId) void this.triggerSync();
        }, 10000);
      }

      return false;
    }
  }
}

export const syncEngine = new SyncEngine();
