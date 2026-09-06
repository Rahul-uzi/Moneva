import { Preferences } from '@capacitor/preferences';

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

export interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
  messages: StoredMessage[];
}

const KEY = 'moneva_chat_history';
const MAX_CONVERSATIONS = 30;
const MAX_MESSAGES_PER_CONVERSATION = 200;

/**
 * Conversations live on the device only.
 *
 * They are financial questions and answers, so they stay local rather than
 * being posted to a server: nothing here needs to sync between devices, and
 * keeping it off the wire avoids storing a second copy of the user's numbers.
 * Mirrored into native storage so a WebView data wipe does not lose them.
 */
const read = (): Conversation[] => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const write = (conversations: Conversation[]): void => {
  const trimmed = conversations.slice(0, MAX_CONVERSATIONS);
  const payload = JSON.stringify(trimmed);
  try {
    localStorage.setItem(KEY, payload);
  } catch {
    // Quota exceeded - drop the oldest half rather than losing everything.
    try {
      localStorage.setItem(KEY, JSON.stringify(trimmed.slice(0, Math.ceil(trimmed.length / 2))));
    } catch {
      /* give up silently; history is a convenience, not a source of truth */
    }
  }
  void Preferences.set({ key: KEY, value: payload }).catch(() => {});
};

export const hydrateChatHistory = async (): Promise<void> => {
  try {
    if (!localStorage.getItem(KEY)) {
      const { value } = await Preferences.get({ key: KEY });
      if (value) localStorage.setItem(KEY, value);
    }
  } catch {
    /* native storage unavailable - localStorage alone is fine */
  }
};

export const listConversations = (): Conversation[] =>
  read().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export const getConversation = (id: string): Conversation | null =>
  read().find((c) => c.id === id) ?? null;

/** First user message becomes the title, so the list is scannable. */
const deriveTitle = (messages: StoredMessage[]): string => {
  const first = messages.find((m) => m.role === 'user');
  if (!first) return 'New chat';
  const t = first.text.trim().replace(/\s+/g, ' ');
  return t.length > 42 ? `${t.slice(0, 42)}…` : t;
};

export const saveConversation = (id: string, messages: StoredMessage[]): void => {
  if (!messages.length) return;
  const all = read().filter((c) => c.id !== id);
  all.unshift({
    id,
    title: deriveTitle(messages),
    updatedAt: new Date().toISOString(),
    messages: messages.slice(-MAX_MESSAGES_PER_CONVERSATION),
  });
  write(all);
};

export const deleteConversation = (id: string): void => {
  write(read().filter((c) => c.id !== id));
};

export const clearAllConversations = (): void => {
  write([]);
};

export const newConversationId = (): string =>
  `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
