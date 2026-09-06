/**
 * Removing a cancelled proposal from the conversation.
 *
 * Cancelling used to raise a toast and nothing more, so the card stayed mounted
 * with "Confirm & Execute" still live - an action the user had just cancelled
 * could be executed with one more tap. Pure so it can be tested without a DOM.
 */
export interface CancellableMessage {
  id: string;
  text: string;
  proposal?: unknown;
}

export const CANCELLED_TEXT = 'Cancelled — nothing was recorded.';

export const withProposalCancelled = <T extends CancellableMessage>(
  messages: T[],
  messageId: string,
): T[] =>
  messages.map((m) =>
    m.id === messageId ? { ...m, proposal: undefined, text: CANCELLED_TEXT } : m,
  );
