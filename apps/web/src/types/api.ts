export interface User {
  id: string;
  email: string;
  display_name: string;
  currency: string;
  timezone: string;
  is_active: boolean;
  avatar_data_url: string | null;
  totp_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface Account {
  id: string;
  user_id: string;
  name: string;
  account_type: 'asset' | 'liability';
  currency: string;
  opening_balance_minor: number;
  balance_paise?: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  user_id?: string | null;
  name: string;
  type: 'income' | 'expense';
  icon?: string | null;
  color?: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  account_id: string;
  to_account_id?: string | null;
  category_id?: string | null;
  savings_goal_id?: string | null;
  transaction_type: 'income' | 'expense' | 'transfer';
  amount_minor: number;
  currency: string;
  description?: string | null;
  transaction_date: string;
  client_mutation_id: string;
  device_id: string;
  sync_status: string;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface RecurringIncome {
  id: string;
  user_id: string;
  source: string;
  amount_minor: number;
  frequency: string;
  next_occurrence: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Bill {
  id: string;
  user_id: string;
  name: string;
  amount_minor: number;
  currency: string;
  due_date: string;
  recurrence?: string | null;
  category_id?: string | null;
  status: 'upcoming' | 'due' | 'overdue' | 'paid' | 'cancelled';
  reminder_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface Budget {
  id: string;
  user_id: string;
  category_id: string;
  limit_amount_minor: number;
  spent_amount_minor?: number;
  remaining_amount_minor?: number;
  period: string;
  start_date: string;
  end_date: string;
  created_at: string;
  updated_at: string;
}

export interface SavingsGoal {
  id: string;
  user_id: string;
  name: string;
  target_amount_minor: number;
  current_saved_minor?: number;
  progress_percentage?: number;
  target_date?: string | null;
  status: 'active' | 'completed' | 'paused';
  created_at: string;
  updated_at: string;
}

export interface NotificationItem {
  id: string;
  user_id: string;
  title: string;
  message: string;
  notification_type: string;
  is_read: boolean;
  created_at: string;
}

export type NotificationRecord = NotificationItem;

export interface UserPreferences {
  notif_bills: boolean;
  notif_budgets: boolean;
  notif_goals: boolean;
  notif_salary: boolean;
}

export interface FinancialSummary {
  net_worth_minor: number;
  income_minor: number;
  expense_minor: number;
  net_cash_flow_minor: number;
  currency: string;
}

export interface AccountBalance {
  account_id: string;
  account_name: string;
  account_type: string;
  balance_minor: number;
  currency: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

/** POST /auth/login returns this instead of tokens when the account has TOTP on. */
export interface TwoFactorChallenge {
  requires_2fa: true;
  challenge_token: string;
}

export type LoginResult = AuthTokens | TwoFactorChallenge;

export const isTwoFactorChallenge = (r: LoginResult): r is TwoFactorChallenge =>
  (r as TwoFactorChallenge).requires_2fa === true;

export interface TotpSetup {
  secret: string;
  otpauth_uri: string;
  qr_svg: string;
}

export interface TotpEnableResult {
  totp_enabled: boolean;
  recovery_codes: string[];
}


/** GET /api/income/salary-usage - this month's income against this month's spending. */
export interface SalaryUsage {
  period_start: string;
  period_end: string;
  salary_received_minor: number;
  other_income_minor: number;
  total_income_minor: number;
  spent_minor: number;
  remaining_minor: number;
  used_percent: number;
  has_salary_configured: boolean;
  currency: string;
}
