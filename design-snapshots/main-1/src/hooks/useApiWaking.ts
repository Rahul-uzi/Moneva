import { useSyncExternalStore } from 'react';
import { API_AWAKE_EVENT, API_WAKING_EVENT, isApiWaking } from '../services/apiClient';

const subscribe = (onChange: () => void) => {
  window.addEventListener(API_WAKING_EVENT, onChange);
  window.addEventListener(API_AWAKE_EVENT, onChange);
  return () => {
    window.removeEventListener(API_WAKING_EVENT, onChange);
    window.removeEventListener(API_AWAKE_EVENT, onChange);
  };
};

/**
 * True while a request is waiting on a server that has not answered yet.
 *
 * Read straight from the api client rather than mirrored into state, so a
 * component that mounts midway through a wait still renders the right thing.
 */
export const useApiWaking = (): boolean =>
  useSyncExternalStore(subscribe, isApiWaking, () => false);
