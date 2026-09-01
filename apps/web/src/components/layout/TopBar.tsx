import React from 'react';
import { Bell, User as UserIcon } from 'lucide-react';
import logoMark from '../../assets/logo/MONEVA_Logo_Mark_FullColor.png';
import { IconButton } from '../ui/IconButton';
import { useAuthStore } from '../../stores/useAuthStore';
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

  return (
    <header className="topbar">
      <div className="topbar-left">
        <img src={logoMark} alt="MONEVA" className="topbar-logo" />
        <span className="topbar-title">{title || 'MONEVA'}</span>
      </div>
      <div className="topbar-right">
        <div className="notif-btn-wrapper">
          <IconButton
            icon={<Bell size={18} />}
            ariaLabel="Notifications"
            variant="ghost"
            size="md"
            onClick={onNotificationClick}
          />
          {unreadCount > 0 && <span className="topbar-unread-badge">{unreadCount}</span>}
        </div>
        <button type="button" className="topbar-user-btn" onClick={onProfileClick} aria-label="Profile">
          {user?.display_name ? (
            <span className="user-avatar">{user.display_name.charAt(0).toUpperCase()}</span>
          ) : (
            <UserIcon size={16} />
          )}
        </button>
      </div>
    </header>
  );
};
