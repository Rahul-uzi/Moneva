import React, { useState, useEffect, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Send, Sparkles, AlertCircle, ShieldCheck, Plus, History } from 'lucide-react';
import { Logo } from '../components/ui/Logo';
import { ActionProposalCard, type ProposedAction } from '../components/financial/ActionProposalCard';
import { QuickAddModal } from '../components/financial/QuickAddModal';
import { apiClient } from '../services/apiClient';
import { withProposalCancelled } from '../utils/proposals';
import { useUiStore } from '../stores/useUiStore';
import {
  hydrateChatHistory,
  listConversations,
  getConversation,
  saveConversation,
  deleteConversation,
  newConversationId,
} from '../services/chatHistoryService';
import type { Conversation } from '../services/chatHistoryService';
import type { Account, Transaction } from '../types/api';
import './AssistantPage.css';

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  proposal?: ProposedAction;
}

interface OutletContextType {
  refreshTrigger?: number;
}

interface AIResponseData {
  response_type: 'ANSWER' | 'ACTION_PROPOSAL' | 'CLARIFICATION_REQUIRED' | 'ERROR' | 'OFFLINE';
  message: string;
  proposal?: {
    type: 'add_expense' | 'add_income' | 'transfer' | 'bill_payment' | 'goal_contribution' | 'create_budget' | 'create_goal' | 'create_bill';
    amount_minor: number;
    description: string;
    account_id?: string;
    account_name?: string;
    to_account_id?: string;
    to_account_name?: string;
    category_id?: string;
    category_name?: string;
    savings_goal_id?: string;
    savings_goal_name?: string;
    bill_id?: string;
    bill_name?: string;
  };
  clarification_prompt?: string;
}

/** Chips ask the assistant these questions instead of routing to another screen. */
/** Chip-sized rupees: lakh/crore shorthand, since the full figure made the
 *  net-worth chip wide enough to hide every other chip off-screen. */
const compactRupees = (minor: number): string => {
  const rupees = Math.abs(minor) / 100;
  const sign = minor < 0 ? '-' : '';
  if (rupees >= 10_000_000) return `${sign}₹${(rupees / 10_000_000).toFixed(2)}Cr`;
  if (rupees >= 100_000) return `${sign}₹${(rupees / 100_000).toFixed(2)}L`;
  if (rupees >= 1_000) return `${sign}₹${(rupees / 1_000).toFixed(1)}k`;
  return `${sign}₹${rupees.toFixed(0)}`;
};

type Suggestion = { label: string; prompt: string };

/**
 * Chips are built from the user's own data rather than hard-coded, so the app
 * never offers "View Budgets" to someone who has none - which used to answer
 * with an apology - and the net-worth chip can show the figure up front.
 */
const buildSuggestions = (ctx: {
  netWorthMinor: number | null;
  billCount: number;
  budgetCount: number;
  goalCount: number;
  hasSpending: boolean;
}): Suggestion[] => {
  const chips: Suggestion[] = [];

  chips.push({
    label: ctx.netWorthMinor === null
      ? 'My net worth'
      : `Net worth ${compactRupees(ctx.netWorthMinor)}`,
    prompt: 'What is my total net worth right now?',
  });

  if (ctx.hasSpending) {
    chips.push({ label: 'Where did it go', prompt: 'What did I spend the most on this month?' });
    chips.push({ label: 'Spent this week', prompt: 'How much did I spend this week?' });
  }
  if (ctx.budgetCount > 0) {
    chips.push({
      label: `Budgets (${ctx.budgetCount})`,
      prompt: 'How am I doing against my budgets this month?',
    });
  }
  if (ctx.billCount > 0) {
    chips.push({
      label: `Bills due (${ctx.billCount})`,
      prompt: 'Which bills are due soon and how much are they?',
    });
  }
  if (ctx.goalCount > 0) {
    chips.push({
      label: `Goals (${ctx.goalCount})`,
      prompt: 'What is the progress on my savings goals?',
    });
  }

  chips.push({ label: 'Salary left', prompt: 'How much of my income this month is left after expenses?' });
  chips.push({ label: 'Check accounts', prompt: 'What are my account balances?' });
  chips.push({ label: 'Savings rate', prompt: 'What is my savings rate this month?' });

  return chips;
};
export const AssistantPage: React.FC = () => {
  const { refreshTrigger } = useOutletContext<OutletContextType>() || {};
  const { isOnline, addToast } = useUiStore();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState<string>('');
  const [isThinking, setIsThinking] = useState<boolean>(false);

  const [accounts, setAccounts] = useState<Account[]>([]);
  // Drives the suggestion chips. They used to be a fixed list, so the app
  // offered "View Budgets" to someone with no budgets and the answer was an
  // apology.
  const [chipContext, setChipContext] = useState<{
    netWorthMinor: number | null;
    billCount: number;
    budgetCount: number;
    goalCount: number;
    hasSpending: boolean;
  }>({ netWorthMinor: null, billCount: 0, budgetCount: 0, goalCount: 0, hasSpending: false });
  const [isQuickAddOpen, setIsQuickAddOpen] = useState<boolean>(false);

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Conversation history lives on the device; see chatHistoryService.
  const [conversationId, setConversationId] = useState<string>(newConversationId);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);

  useEffect(() => {
    void hydrateChatHistory();
  }, []);

  // Persist after every exchange so nothing is lost on navigation or restart.
  // The list itself is only re-read when the panel opens, so this effect does
  // not set state on every message.
  useEffect(() => {
    if (!messages.length) return;
    saveConversation(
      conversationId,
      messages.map((m) => ({ id: m.id, role: m.sender, text: m.text, timestamp: m.timestamp })),
    );
  }, [messages, conversationId]);

  const toggleHistory = () => {
    setIsHistoryOpen((open) => {
      if (!open) setConversations(listConversations());
      return !open;
    });
  };

  const handleNewChat = () => {
    setConversationId(newConversationId());
    setMessages([]);
    setInputText('');
    setIsHistoryOpen(false);
  };

  const handleOpenConversation = (id: string) => {
    const convo = getConversation(id);
    if (!convo) return;
    setConversationId(convo.id);
    setMessages(
      convo.messages.map((m) => ({ id: m.id, sender: m.role, text: m.text, timestamp: m.timestamp })),
    );
    setIsHistoryOpen(false);
  };

  const handleDeleteConversation = (id: string) => {
    deleteConversation(id);
    setConversations(listConversations());
    if (id === conversationId) handleNewChat();
  };

  useEffect(() => {
    let active = true;
    const loadContext = async () => {
      try {
        const [accRes, summaryRes, billsRes, budgetsRes, goalsRes] = await Promise.all([
          apiClient.get<Account[]>('/accounts'),
          apiClient.get<{ net_worth_minor: number; expense_minor: number }>('/finance/summary'),
          apiClient.get<unknown[]>('/bills'),
          apiClient.get<unknown[]>('/budgets'),
          apiClient.get<unknown[]>('/goals'),
        ]);
        if (!active) return;
        setAccounts(accRes.data);
        setChipContext({
          netWorthMinor: summaryRes.data?.net_worth_minor ?? null,
          billCount: Array.isArray(billsRes.data) ? billsRes.data.length : 0,
          budgetCount: Array.isArray(budgetsRes.data) ? budgetsRes.data.length : 0,
          goalCount: Array.isArray(goalsRes.data) ? goalsRes.data.length : 0,
          hasSpending: (summaryRes.data?.expense_minor ?? 0) > 0,
        });
      } catch {
        // Context is optional - the assistant still answers without it.
      }
    };
    void loadContext();

    return () => {
      active = false;
    };
  }, [refreshTrigger]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputText).trim();
    if (!text) return;

    if (!textToSend) setInputText('');

    const userMsg: Message = {
      id: crypto.randomUUID(),
      sender: 'user',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsThinking(true);

    try {
      const res = await apiClient.post<AIResponseData>('/ai/query', { prompt: text });
      setIsThinking(false);

      const data = res.data;
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      if (data.response_type === 'ACTION_PROPOSAL' && data.proposal) {
        const propData = data.proposal;
        const proposal: ProposedAction = {
          type: propData.type,
          amountPaise: propData.amount_minor,
          description: propData.description,
          accountName: propData.account_name,
          accountId: propData.account_id,
          toAccountName: propData.to_account_name,
          toAccountId: propData.to_account_id,
          categoryName: propData.category_name,
          categoryId: propData.category_id,
          billName: propData.bill_name,
          billId: propData.bill_id,
          savingsGoalName: propData.savings_goal_name,
          savingsGoalId: propData.savings_goal_id,
        };

        const proposalMsg: Message = {
          id: crypto.randomUUID(),
          sender: 'assistant',
          text: data.message,
          timestamp: timeStr,
          proposal,
        };
        setMessages((prev) => [...prev, proposalMsg]);
      } else if (data.response_type === 'CLARIFICATION_REQUIRED') {
        const clarMsg: Message = {
          id: crypto.randomUUID(),
          sender: 'assistant',
          text: data.clarification_prompt || data.message,
          timestamp: timeStr,
        };
        setMessages((prev) => [...prev, clarMsg]);
      } else {
        const answerMsg: Message = {
          id: crypto.randomUUID(),
          sender: 'assistant',
          text: data.message,
          timestamp: timeStr,
        };
        setMessages((prev) => [...prev, answerMsg]);
      }
    } catch {
      setIsThinking(false);
      const errorMsg: Message = {
        id: crypto.randomUUID(),
        sender: 'assistant',
        text: 'MONEVA Assistant is temporarily unavailable. Please check your network connection.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMsg]);
    }
  };

  const handleCancelProposal = (messageId: string) => {
    // Drop the proposal so the card unmounts. A toast alone left Confirm live,
    // meaning a cancelled action could still be executed with one more tap.
    setMessages((prev) => withProposalCancelled(prev, messageId));
    addToast('Proposed action cancelled.', 'info');
  };

  const handleConfirmProposal = async (proposal: ProposedAction) => {
    const clientMutationId = crypto.randomUUID();

    if (proposal.type === 'bill_payment' && proposal.billId) {
      if (!proposal.accountId && accounts.length > 0) {
        proposal.accountId = accounts[0].id;
      }
      if (!proposal.accountId) {
        addToast('Please select a valid account for bill payment.', 'error');
        return;
      }
      await apiClient.post(`/bills/${proposal.billId}/pay`, {
        account_id: proposal.accountId,
        client_mutation_id: clientMutationId,
        device_id: 'web-client',
        payment_date: new Date().toISOString(),
      });
      addToast('Bill payment executed successfully!', 'success');
    } else {
      const defaultAcc = accounts.length > 0 ? accounts[0] : undefined;
      const targetAccId = proposal.accountId || (defaultAcc ? defaultAcc.id : undefined);

      if (!targetAccId) {
        addToast('No valid account available for this transaction.', 'error');
        return;
      }

      let txType = 'expense';
      if (proposal.type === 'add_income') txType = 'income';
      if (proposal.type === 'transfer' || proposal.type === 'goal_contribution') txType = 'transfer';

      const payload = {
        client_mutation_id: clientMutationId,
        account_id: targetAccId,
        to_account_id: proposal.toAccountId || null,
        category_id: proposal.categoryId || null,
        savings_goal_id: proposal.savingsGoalId || null,
        transaction_type: txType,
        amount_minor: proposal.amountPaise,
        currency: 'INR',
        description: proposal.description,
        transaction_date: new Date().toISOString(),
        device_id: 'web-client',
      };

      await apiClient.post<Transaction>('/transactions', payload);
      addToast('Transaction executed successfully!', 'success');
    }

    const confirmMsg: Message = {
      id: crypto.randomUUID(),
      sender: 'assistant',
      text: `✓ Action "${proposal.description}" of ₹${(proposal.amountPaise / 100).toFixed(2)} has been recorded into your live ledger.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages((prev) => [...prev, confirmMsg]);
  };

  return (
    <div className="assistant-container">
      {/* Brand Header */}
      <div className="assistant-header-card">
        <div className="assistant-brand-badge">
          <Logo className="assistant-logo-mark" />
        </div>
        <div className="assistant-header-text">
          <h1 className="heading-md text-main">MONEVA Assistant</h1>
          <span className="text-body text-xs text-muted">Intelligent Financial Advisor</span>
        </div>
        <div className="assistant-header-actions">
          <button
            type="button"
            className="assistant-header-btn"
            onClick={toggleHistory}
            aria-label="Chat history"
          >
            <History size={18} />
          </button>
          <button
            type="button"
            className="assistant-header-btn"
            onClick={handleNewChat}
            aria-label="New chat"
          >
            <Plus size={18} />
          </button>
        </div>
      </div>

      {isHistoryOpen && (
        <div className="chat-history-panel">
          <div className="chat-history-head">
            <span className="text-label">Previous chats</span>
            <button type="button" className="chat-history-new" onClick={handleNewChat}>
              <Plus size={14} /> New chat
            </button>
          </div>
          {conversations.length === 0 ? (
            <p className="text-body">No saved chats yet.</p>
          ) : (
            <ul className="chat-history-list">
              {conversations.map((c) => (
                <li key={c.id} className={c.id === conversationId ? 'is-current' : undefined}>
                  <button type="button" className="chat-history-item" onClick={() => handleOpenConversation(c.id)}>
                    <span className="chat-history-title">{c.title}</span>
                    <span className="chat-history-date">
                      {new Date(c.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="chat-history-delete"
                    onClick={() => handleDeleteConversation(c.id)}
                    aria-label={`Delete chat: ${c.title}`}
                  >
                    &times;
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!isOnline && (
        <div className="assistant-offline-notice">
          <AlertCircle size={16} />
          <span>Assistant features require an active network connection.</span>
        </div>
      )}

      {/* Suggested prompts - these ASK the assistant rather than navigating away,
          so the answer arrives in the conversation. */}
      <div className="suggested-actions-scroll">
        <button
          type="button"
          className="action-chip chip-primary"
          onClick={() => setIsQuickAddOpen(true)}
        >
          <Sparkles size={14} /> Add an expense
        </button>
        {buildSuggestions(chipContext).map((sp, i) => (
          <button
            key={sp.label}
            type="button"
            className="action-chip"
            style={{ animationDelay: `${0.04 * (i + 1)}s` }}
            disabled={isThinking}
            onClick={() => void handleSendMessage(sp.prompt)}
          >
            <Sparkles size={14} /> {sp.label}
          </button>
        ))}
      </div>

      {/* Messages / Conversation Stream */}
      <div className="messages-stream">
        {messages.length === 0 ? (
          <div className="assistant-empty-state">
            <div className="empty-icon-ring">
              <ShieldCheck size={28} />
            </div>
            <h3 className="heading-sm">No conversation history yet</h3>
            <p className="text-body text-center text-muted text-xs">
              Ask MONEVA to analyze your finances, plan budgets, or track expense obligations.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`message-wrapper ${msg.sender === 'user' ? 'user-msg' : 'assistant-msg'} ${msg.proposal ? 'has-proposal' : ''}`}
            >
              {msg.sender === 'assistant' && (
                <Logo className="msg-avatar-logo" label={null} />
              )}
              <div className="message-bubble">
                <p className="msg-text">{msg.text}</p>

                {msg.proposal && (
                  <ActionProposalCard
                    proposal={msg.proposal}
                    onConfirm={handleConfirmProposal}
                    onCancel={() => handleCancelProposal(msg.id)}
                  />
                )}

                <span className="msg-time">{msg.timestamp}</span>
              </div>
            </div>
          ))
        )}

        {/* Thinking / Processing State Indicator */}
        {isThinking && (
          <div className="message-wrapper assistant-msg">
            <Logo className="msg-avatar-logo thinking-pulse" label={null} />
            <div className="message-bubble thinking-bubble">
              {/* Three bouncing dots read as "working" at a glance; the old
                  static sentence looked like a message that had already
                  arrived. */}
              <span className="typing-dots" aria-label="MONEVA is thinking">
                <span />
                <span />
                <span />
              </span>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input Controls Bar */}
      <div className="assistant-input-bar" data-tour="assistant-input">
        <input
          type="text"
          placeholder="Ask MONEVA about budgets, bills, or expenses..."
          className="chat-input"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleSendMessage();
          }}
          disabled={!isOnline}
        />

        <button
          type="button"
          className="send-btn"
          onClick={() => void handleSendMessage()}
          disabled={!isOnline || !inputText.trim()}
          aria-label="Send message"
        >
          <Send size={18} />
        </button>
      </div>

      {/* Quick Add Transaction Modal */}
      <QuickAddModal
        isOpen={isQuickAddOpen}
        onClose={() => setIsQuickAddOpen(false)}
        onSuccess={() => {
          addToast('Transaction recorded successfully!', 'success');
        }}
      />
    </div>
  );
};
