import React from 'react';
import { Bell, Eye, EyeOff, User as UserIcon } from 'lucide-react';
import { Logo } from '../ui/Logo';
import { IconButton } from '../ui/IconButton';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUiStore } from '../../stores/useUiStore';
import './TopBar.css';

interface TopBarProps {
  title?: string;
  unreadCount?: number;
  onNotificationClick?: () => void;
  onProfileClick?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  title,
  unreadCount = 0,
  onNotificationClick,
  onProfileClick,
}) => {
  const { user } = useAuthStore();
  const balancesHidden = useUiStore((state) => state.balancesHidden);
  const toggleBalances = useUiStore((state) => state.toggleBalances);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <Logo tile className="topbar-logo" />
        <span className="topbar-title">{title || 'MONEVA'}</span>
      </div>
      <div className="topbar-right">
        <IconButton
          icon={balancesHidden ? <EyeOff size={18} /> : <Eye size={18} />}
          ariaLabel={balancesHidden ? 'Show balances' : 'Hide balances'}
          variant="ghost"
          size="md"
          onClick={toggleBalances}
        />
        <div className="notif-btn-wrapper" data-tour="notifications">
          <IconButton
            icon={<Bell size={18} />}
            ariaLabel="Notifications"
            variant="ghost"
            size="md"
            onClick={onNotificationClick}
          />
          {unreadCount > 0 && <span className="topbar-unread-badge">{unreadCount}</span>}
        </div>
        <button type="button" className="topbar-user-btn" onClick={onProfileClick} aria-label="Profile" data-tour="profile">
          {user?.avatar_data_url ? (
            <img src={user.avatar_data_url} alt="" className="topbar-avatar-img" />
          ) : user?.display_name ? (
            <span className="user-avatar">{user.display_name.charAt(0).toUpperCase()}</span>
          ) : (
            <UserIcon size={16} />
          )}
        </button>
      </div>
    </header>
  );
};
