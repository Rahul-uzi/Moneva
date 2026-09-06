import { describe, it, expect } from 'vitest';
import { withProposalCancelled, CANCELLED_TEXT } from './proposals';

describe('withProposalCancelled', () => {
  const messages = [
    { id: 'a', text: 'hello', proposal: undefined },
    { id: 'b', text: 'Please review and confirm', proposal: { amount_minor: 64000 } },
    { id: 'c', text: 'later', proposal: { amount_minor: 100 } },
  ];

  it('removes the proposal so the card can no longer be confirmed', () => {
    const out = withProposalCancelled(messages, 'b');
    expect(out[1].proposal).toBeUndefined();
  });

  it('says plainly that nothing was recorded', () => {
    const out = withProposalCancelled(messages, 'b');
    expect(out[1].text).toBe(CANCELLED_TEXT);
    expect(out[1].text).toMatch(/nothing was recorded/i);
  });

  it('leaves every other message untouched', () => {
    const out = withProposalCancelled(messages, 'b');
    expect(out[0]).toEqual(messages[0]);
    expect(out[2]).toEqual(messages[2]);
    expect(out[2].proposal).toBeDefined();
  });

  it('does not mutate the input', () => {
    const snapshot = JSON.parse(JSON.stringify(messages));
    withProposalCancelled(messages, 'b');
    expect(messages).toEqual(snapshot);
  });

  it('is a no-op for an unknown id', () => {
    expect(withProposalCancelled(messages, 'missing')).toEqual(messages);
  });
});
