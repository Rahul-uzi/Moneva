import React from 'react';
import { CreditCard, Landmark } from 'lucide-react';
import { Card } from '../ui/Card';
import type { Account } from '../../types/api';
import { Money } from '../ui/Money';
import { BrandMark } from '../ui/BrandMark';
import { brandNameIn } from '../../utils/brandMark';
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
        {/* An account whose name contains a bank - "HDFC Savings" as much as
            "HDFC Bank" - gets that bank's mark. Anything else keeps the
            generic icon: an invented tile on "Cash" would look like a brand
            that is not there, and the icon says asset-or-debt at a glance,
            which initials cannot. 36px matches .account-icon beside it. */}
        {brandNameIn(account.name) ? (
          <BrandMark name={account.name} size={36} className="account-brand" />
        ) : (
          <div className={`account-icon ${isLiability ? 'icon-liability' : 'icon-asset'}`}>
            {isLiability ? <CreditCard size={20} /> : <Landmark size={20} />}
          </div>
        )}
        {/* "OWED" rather than "LIABILITY": it says what the figure means. */}
        <span className={`account-type-badge${isLiability ? ' badge-owed' : ''}`}>
          {isLiability ? 'OWED' : 'ASSET'}
        </span>
      </div>
      <div className="account-details">
        <span className="account-name">{account.name}</span>
        {/* A debt carries its sign. Shown bare, a credit-card balance read as
            money held, while net worth was subtracting the very same figure. */}
        <span className={`number-lg ${isLiability ? 'text-coral' : 'text-main'}`}>
          {isLiability && '- '}
          <Money amount={balance} currency={account.currency} />
        </span>
      </div>
    </Card>
  );
};
