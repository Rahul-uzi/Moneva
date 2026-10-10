// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AssistantPage } from './AssistantPage';
import type { Account } from '../types/api';

/**
 * The assistant conversation.
 *
 * The AI endpoint is the mocked API client, so each test decides what the
 * model "said" and checks what the person sees: their question, the answer,
 * the fallback when the request fails, and a proposal card that does - or
 * deliberately does not - write to the ledger.
 */

const get = vi.fn();
const post = vi.fn();
vi.mock('../services/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/apiClient')>()),
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const addToast = vi.fn();
let isOnline = true;
vi.mock('../stores/useUiStore', () => ({
  useUiStore: () => ({ addToast, isOnline }),
}));

// History lives on the device; keep it in memory and out of these tests.
vi.mock('../services/chatHistoryService', () => ({
  hydrateChatHistory: () => Promise.resolve(),
  listConversations: () => [],
  getConversation: () => null,
  saveConversation: vi.fn(),
  deleteConversation: vi.fn(),
  newConversationId: () => 'conversation-example',
}));

// The quick-add sheet is its own screen with its own data; not under test here.
vi.mock('../components/financial/QuickAddModal', () => ({ QuickAddModal: () => null }));

const ACCOUNTS: Account[] = [
  { id: 'acc-1', name: 'Everyday Savings' } as Account,
];

const answer = (message: string) => ({ data: { response_type: 'ANSWER', message } });

const PROPOSAL_REPLY = {
  data: {
    response_type: 'ACTION_PROPOSAL',
    message: 'Shall I record this expense?',
    proposal: {
      type: 'add_expense',
      amount_minor: 45000,
      description: 'Dinner with friends',
      account_id: 'acc-1',
      account_name: 'Everyday Savings',
      category_id: 'cat-food',
      category_name: 'Food & Dining',
    },
  },
};

const draw = () => render(
  <MemoryRouter><AssistantPage /></MemoryRouter>,
);

const input = () => screen.getByPlaceholderText(/ask moneva about budgets/i) as HTMLInputElement;
const sendButton = () => screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement;

const ask = (text: string) => {
  fireEvent.change(input(), { target: { value: text } });
  fireEvent.click(sendButton());
};

const aiCalls = () => post.mock.calls.filter((c) => c[0] === '/ai/query');

beforeAll(() => {
  // jsdom does not lay anything out, so it has no scrollIntoView; the page
  // scrolls to the newest message after every change.
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  isOnline = true;
  addToast.mockReset();
  get.mockReset();
  post.mockReset();
  get.mockImplementation((url: string) => {
    if (url === '/accounts') return Promise.resolve({ data: ACCOUNTS });
    if (url === '/finance/summary') return Promise.resolve({ data: { net_worth_minor: 12_500_000, expense_minor: 0 } });
    if (url === '/budgets') return Promise.resolve({ data: [{}, {}] });
    return Promise.resolve({ data: [] });
  });
  post.mockResolvedValue(answer('You have three accounts.'));
});

afterEach(() => {
  cleanup();
});

describe('asking a question', () => {
  it('shows the question and the reply from the assistant', async () => {
    post.mockResolvedValueOnce(answer('Your net worth is ₹1.25L.'));
    draw();
    ask('What is my net worth?');

    expect(await screen.findByText('Your net worth is ₹1.25L.')).toBeTruthy();
    expect(screen.getByText('What is my net worth?')).toBeTruthy();
    expect(aiCalls()[0][1]).toEqual({ prompt: 'What is my net worth?', history: [] });
    // The box is emptied so the next question starts clean.
    expect(input().value).toBe('');
  });

  it('sends with the Enter key as well as the button', async () => {
    draw();
    fireEvent.change(input(), { target: { value: 'What are my account balances?' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(await screen.findByText('You have three accounts.')).toBeTruthy();
    expect(aiCalls()).toHaveLength(1);
  });

  it('sends the conversation so far with a follow-up question', async () => {
    // Without it, "and last month?" reaches the model with nothing to refer to.
    post.mockResolvedValueOnce(answer('You spent ₹8,000 this month.'));
    draw();
    ask('How much did I spend this month?');
    await screen.findByText('You spent ₹8,000 this month.');

    post.mockResolvedValueOnce(answer('Last month it was ₹6,500.'));
    ask('And last month?');
    await screen.findByText('Last month it was ₹6,500.');

    expect(aiCalls()[1][1]).toEqual({
      prompt: 'And last month?',
      history: [
        { role: 'user', content: 'How much did I spend this month?' },
        { role: 'assistant', content: 'You spent ₹8,000 this month.' },
      ],
    });
  });

  it('shows the follow-up question the assistant needs answered', async () => {
    post.mockResolvedValueOnce({
      data: {
        response_type: 'CLARIFICATION_REQUIRED',
        message: 'I need more detail.',
        clarification_prompt: 'Which account did you pay from?',
      },
    });
    draw();
    ask('I paid the electricity bill');
    expect(await screen.findByText('Which account did you pay from?')).toBeTruthy();
  });

  it('says the assistant is unavailable when the request fails', async () => {
    post.mockRejectedValueOnce(new Error('Network Error'));
    draw();
    ask('What is my savings rate?');
    expect(await screen.findByText(/assistant is temporarily unavailable/i)).toBeTruthy();
    // The question is not lost: it stays on screen above the apology.
    expect(screen.getByText('What is my savings rate?')).toBeTruthy();
  });

  it('does not send an empty or blank message', () => {
    draw();
    expect(sendButton().disabled).toBe(true);
    fireEvent.change(input(), { target: { value: '    ' } });
    expect(sendButton().disabled).toBe(true);
    // Enter bypasses the disabled button, so the handler's own guard is what stops it.
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(aiCalls()).toHaveLength(0);
    expect(screen.getByText('No conversation history yet')).toBeTruthy();
  });

  it('asks a suggestion chip\'s question in the conversation', async () => {
    // The chips are built from the person's data: two budgets, so a budgets chip.
    draw();
    fireEvent.click(await screen.findByRole('button', { name: /budgets \(2\)/i }));
    await waitFor(() => expect(aiCalls()).toHaveLength(1));
    expect(aiCalls()[0][1]).toMatchObject({ prompt: 'How am I doing against my budgets this month?' });
    expect(await screen.findByText('How am I doing against my budgets this month?')).toBeTruthy();
  });

  it('cannot be used offline', () => {
    isOnline = false;
    draw();
    expect(screen.getByText('Assistant features require an active network connection.')).toBeTruthy();
    expect(input().disabled).toBe(true);
  });
});

describe('a proposed action', () => {
  const showProposal = async () => {
    post.mockImplementation((url: string) => {
      if (url === '/ai/query') return Promise.resolve(PROPOSAL_REPLY);
      return Promise.resolve({ data: {} });
    });
    draw();
    ask('I spent 450 on dinner with friends');
    await screen.findByText('Shall I record this expense?');
  };

  it('shows a card with what would be recorded', async () => {
    await showProposal();
    expect(screen.getByText('Proposed Action')).toBeTruthy();
    expect(screen.getByText('Add Expense')).toBeTruthy();
    expect(screen.getByText('Dinner with friends')).toBeTruthy();
    expect(screen.getByText(/450\.00/)).toBeTruthy();
    expect(screen.getByText('Everyday Savings')).toBeTruthy();
    expect(screen.getByText('Food & Dining')).toBeTruthy();
    expect(screen.getByRole('button', { name: /confirm & execute/i })).toBeTruthy();
  });

  it('records the expense only when it is confirmed', async () => {
    await showProposal();
    expect(post.mock.calls.some((c) => c[0] === '/transactions')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /confirm & execute/i }));

    expect(await screen.findByText(/has been recorded into your live ledger/i)).toBeTruthy();
    const tx = post.mock.calls.find((c) => c[0] === '/transactions');
    expect(tx?.[1]).toMatchObject({
      account_id: 'acc-1',
      category_id: 'cat-food',
      transaction_type: 'expense',
      amount_minor: 45000,
      description: 'Dinner with friends',
    });
  });

  // The bug: the card stayed after a successful confirm, and a second tap
  // recorded the same expense again under a new id the server could not match.
  it('removes the card once confirmed, so the expense is recorded only once', async () => {
    await showProposal();
    fireEvent.click(screen.getByRole('button', { name: /confirm & execute/i }));

    await screen.findByText(/has been recorded into your live ledger/i);
    expect(screen.queryByRole('button', { name: /confirm & execute/i })).toBeNull();
    expect(post.mock.calls.filter((c) => c[0] === '/transactions')).toHaveLength(1);
    // Grouped like the card, not a bare "450.00".
    expect(screen.getByText(/of ₹450\.00 has been recorded/)).toBeTruthy();
  });

  it('keeps the card when recording fails, so it can be tried again', async () => {
    await showProposal();
    post.mockImplementation((url: string) => (url === '/transactions'
      ? Promise.reject({ response: { data: { detail: 'Account is archived.' } } })
      : Promise.resolve(PROPOSAL_REPLY)));
    fireEvent.click(screen.getByRole('button', { name: /confirm & execute/i }));
    await screen.findByText('Account is archived.');
    expect(screen.getByRole('button', { name: /confirm & execute/i })).toBeTruthy();
  });

  it('removes the card when cancelled, so it cannot be confirmed afterwards', async () => {
    await showProposal();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(await screen.findByText('Cancelled — nothing was recorded.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /confirm & execute/i })).toBeNull();
    expect(post.mock.calls.some((c) => c[0] === '/transactions')).toBe(false);
  });

  it('says so on the card when recording fails', async () => {
    await showProposal();
    post.mockImplementation((url: string) => (url === '/transactions'
      ? Promise.reject({ response: { data: { detail: 'Account is archived.' } } })
      : Promise.resolve(PROPOSAL_REPLY)));
    fireEvent.click(screen.getByRole('button', { name: /confirm & execute/i }));

    expect(await screen.findByText('Account is archived.')).toBeTruthy();
    expect(screen.queryByText(/has been recorded into your live ledger/i)).toBeNull();
  });
});
