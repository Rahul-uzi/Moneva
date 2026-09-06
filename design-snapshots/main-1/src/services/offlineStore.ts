export interface PendingOperation {
  id: string; // operation_id
  user_id: string;
  device_id: string;
  client_mutation_id: string;
  entity_type: 'transaction' | 'account' | 'budget' | 'goal' | 'bill';
  op_type: 'CREATE' | 'UPDATE' | 'DELETE' | 'PAY';
  endpoint: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  payload: Record<string, unknown>;
  created_at: string;
  retry_count: number;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  last_error?: string;
}

const DB_NAME = 'moneva_offline_db';
const DB_VERSION = 1;
const STORE_QUEUE = 'sync_queue';
const STORE_CACHE = 'cached_entities';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this environment.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        const queueStore = db.createObjectStore(STORE_QUEUE, { keyPath: 'id' });
        queueStore.createIndex('user_id', 'user_id', { unique: false });
        queueStore.createIndex('status', 'status', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_CACHE)) {
        db.createObjectStore(STORE_CACHE, { keyPath: 'cache_key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Fallback memory queue for environments without IndexedDB
const memoryQueue: Map<string, PendingOperation> = new Map();
const memoryCache: Map<string, unknown> = new Map();

export async function enqueueOperation(op: PendingOperation): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_QUEUE, 'readwrite');
    tx.objectStore(STORE_QUEUE).put(op);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    memoryQueue.set(op.id, op);
  }
}

export async function getPendingOperations(userId: string): Promise<PendingOperation[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_QUEUE, 'readonly');
    const store = tx.objectStore(STORE_QUEUE);
    const index = store.index('user_id');
    const request = index.getAll(userId);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const ops = (request.result as PendingOperation[]) || [];
        // Sort by creation time
        ops.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        resolve(ops.filter((op) => op.status === 'pending' || op.status === 'syncing'));
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    const ops = Array.from(memoryQueue.values()).filter(
      (op) => op.user_id === userId && (op.status === 'pending' || op.status === 'syncing')
    );
    ops.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    return ops;
  }
}

export async function removeOperation(opId: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_QUEUE, 'readwrite');
    tx.objectStore(STORE_QUEUE).delete(opId);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    memoryQueue.delete(opId);
  }
}

export async function updateOperationStatus(
  opId: string,
  status: PendingOperation['status'],
  lastError?: string
): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_QUEUE, 'readwrite');
    const store = tx.objectStore(STORE_QUEUE);
    const getReq = store.get(opId);

    getReq.onsuccess = () => {
      const op = getReq.result as PendingOperation | undefined;
      if (op) {
        op.status = status;
        if (lastError !== undefined) op.last_error = lastError;
        if (status === 'failed') op.retry_count = (op.retry_count || 0) + 1;
        store.put(op);
      }
    };

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    const op = memoryQueue.get(opId);
    if (op) {
      op.status = status;
      if (lastError !== undefined) op.last_error = lastError;
      if (status === 'failed') op.retry_count = (op.retry_count || 0) + 1;
    }
  }
}

export async function cacheEntity<T>(userId: string, entityType: string, data: T): Promise<void> {
  const cacheKey = `${userId}_${entityType}`;
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_CACHE, 'readwrite');
    tx.objectStore(STORE_CACHE).put({ cache_key: cacheKey, data, updated_at: new Date().toISOString() });
  } catch {
    memoryCache.set(cacheKey, data);
  }
}

export async function getCachedEntity<T>(userId: string, entityType: string): Promise<T | null> {
  const cacheKey = `${userId}_${entityType}`;
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_CACHE, 'readonly');
    const req = tx.objectStore(STORE_CACHE).get(cacheKey);
    return new Promise((resolve) => {
      req.onsuccess = () => {
        if (req.result) resolve(req.result.data as T);
        else resolve(null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return (memoryCache.get(cacheKey) as T) || null;
  }
}

export async function clearUserOfflineData(userId: string): Promise<void> {
  try {
    const ops = await getPendingOperations(userId);
    for (const op of ops) {
      await removeOperation(op.id);
    }
  } catch {
    memoryQueue.clear();
    memoryCache.clear();
  }
}
