import React from 'react';
import { CreditCard, Landmark } from 'lucide-react';
import { Card } from '../ui/Card';
import type { Account } from '../../types/api';
import { formatMonetaryValue } from '../../utils/money';
import './AccountCard.css';

interface AccountCardProps {
  account: Account;
  onClick?: () => void;
}

export const AccountCard: React.FC<AccountCardProps> = ({ account, onClick }) => {
  const isLiability = account.account_type === 'liability';
  const balance = account.balance_paise ?? account.opening_balance_minor;

  return (
    <Card variant="surface" interactive onClick={onClick} className="account-card">
      <div className="account-header">
        <div className={`account-icon ${isLiability ? 'icon-liability' : 'icon-asset'}`}>
          {isLiability ? <CreditCard size={20} /> : <Landmark size={20} />}
        </div>
        <span className="account-type-badge">{account.account_type.toUpperCase()}</span>
      </div>
      <div className="account-details">
        <span className="account-name">{account.name}</span>
        <span className={`number-lg ${isLiability ? 'text-coral' : 'text-main'}`}>
          {formatMonetaryValue(balance, account.currency)}
        </span>
      </div>
    </Card>
  );
};
