import { create } from 'zustand';
import { readBalancesHidden, writeBalancesHidden } from '../services/balancePrivacy';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
}

interface UiState {
  isOnline: boolean;
  /** Masks every displayed holding. Remembered on this device. */
  balancesHidden: boolean;
  toggleBalances: () => void;
  toasts: ToastMessage[];
  addToast: (message: string, type?: ToastMessage['type']) => void;
  removeToast: (id: string) => void;
  setOnlineStatus: (status: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  isOnline: navigator.onLine,
  balancesHidden: readBalancesHidden(),
  toasts: [],

  toggleBalances: () =>
    set((state) => {
      const balancesHidden = !state.balancesHidden;
      writeBalancesHidden(balancesHidden);
      return { balancesHidden };
    }),

  addToast: (message, type = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    set((state) => ({
      toasts: [...state.toasts, { id, type, message }],
    }));

    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }));
    }, 4000);
  },

  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },

  setOnlineStatus: (status) => set({ isOnline: status }),
}));
