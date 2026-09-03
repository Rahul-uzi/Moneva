import React, { useState, useEffect, useCallback } from 'react';
import {
  Bell,
  CheckCheck,
  X,
  Calendar,
  AlertTriangle,
  Target,
  DollarSign,
  Info,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { useScrollLock } from '../ui/useScrollLock';
import { LoadingState, EmptyState } from '../ui/States';
import { apiClient } from '../../services/apiClient';
import { useUiStore } from '../../stores/useUiStore';
import { nativeNotificationService } from '../../services/notificationService';
import type { NotificationItem, UserPreferences } from '../../types/api';
import './NotificationsModal.css';

import { parseApiDate } from '../../utils/datetime';
interface NotificationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNotificationsUpdated?: () => void;
}

export const NotificationsModal: React.FC<NotificationsModalProps> = ({
  isOpen,
  onClose,
  onNotificationsUpdated,
}) => {
  const { addToast } = useUiStore();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isMarkingAll, setIsMarkingAll] = useState<boolean>(false);

  const fetchNotifications = useCallback(async (isMounted: boolean) => {
    try {
      // Trigger backend reminder generation first
      try {
        await apiClient.post('/notifications/generate');
      } catch {
        // Ignore silent generation errors
      }

      const [notifRes, prefRes] = await Promise.all([
        apiClient.get<NotificationItem[]>('/notifications'),
        apiClient.get<UserPreferences>('/notifications/preferences').catch(() => ({ data: undefined })),
      ]);

      if (isMounted) {
        setNotifications(notifRes.data);

        // Deliver native notifications for unread items
        const unreadItems = notifRes.data.filter((n) => !n.is_read);
        const prefs = prefRes.data;
        for (const item of unreadItems) {
          void nativeNotificationService.deliverNativeNotification(item, prefs);
        }
      }
    } catch {
      if (isMounted) {
        addToast('Failed to load notifications.', 'error');
      }
    } finally {
      if (isMounted) {
        setIsLoading(false);
      }
    }
  }, [addToast]);

  useEffect(() => {
    if (isOpen) {
      let isMounted = true;
      const timer = setTimeout(() => {
        void fetchNotifications(isMounted);
      }, 0);

      return () => {
        isMounted = false;
        clearTimeout(timer);
      };
    }
  }, [isOpen, fetchNotifications]);

  const handleMarkRead = async (id: string) => {
    try {
      await apiClient.patch(`/notifications/${id}/read`);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
      if (onNotificationsUpdated) onNotificationsUpdated();
    } catch {
      addToast('Failed to mark notification as read.', 'error');
    }
  };

  const handleMarkAllRead = async () => {
    setIsMarkingAll(true);
    try {
      await apiClient.post('/notifications/read-all');
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      addToast('All notifications marked as read.', 'info');
      if (onNotificationsUpdated) onNotificationsUpdated();
    } catch {
      addToast('Failed to mark all as read.', 'error');
    } finally {
      setIsMarkingAll(false);
    }
  };

  useScrollLock(isOpen);

  if (!isOpen) return null;

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'bill_reminder':
      case 'bill_overdue':
        return <Calendar size={18} className="text-orange" />;
      case 'budget_warning':
      case 'budget_exceeded':
        return <AlertTriangle size={18} className="text-coral" />;
      case 'goal_milestone':
        return <Target size={18} className="text-teal" />;
      case 'salary_reminder':
        return <DollarSign size={18} className="text-teal" />;
      default:
        return <Info size={18} className="text-blue" />;
    }
  };

  return (
    <div className="modal-overlay modal-fullscreen" onClick={onClose}>
      <div className="modal-container notifications-modal" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="modal-header">
          <div className="modal-title-group">
            <Bell size={20} className="text-blue" />
            <h2 className="heading-md">Notification Center</h2>
            {unreadCount > 0 && <span className="notif-badge-pill">{unreadCount} unread</span>}
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        {/* Action Controls */}
        {notifications.length > 0 && unreadCount > 0 && (
          <div className="notif-actions-bar">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleMarkAllRead}
              isLoading={isMarkingAll}
            >
              <CheckCheck size={14} /> Mark All as Read
            </Button>
          </div>
        )}

        {/* Modal Body */}
        <div className="modal-body notif-modal-body">
          {isLoading ? (
            <LoadingState message="Fetching notifications..." />
          ) : notifications.length === 0 ? (
            <EmptyState
              title="No Notifications Yet"
              description="You are all caught up! New reminders for bills, budget alerts, and savings milestones will appear here."
            />
          ) : (
            <div className="notifications-list">
              {notifications.map((n) => (
                <div
                  key={n.id}
                  className={`notif-item-card ${!n.is_read ? 'unread-card' : ''}`}
                >
                  <div className="notif-item-header">
                    <div className="notif-type-icon">{getNotificationIcon(n.notification_type)}</div>
                    <div className="notif-title-area">
                      <span className="notif-title">{n.title}</span>
                      <span className="notif-time">
                        {parseApiDate(n.created_at).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>

                  <p className="notif-message">{n.message}</p>

                  {!n.is_read && (
                    <div className="notif-item-actions">
                      <button
                        type="button"
                        className="mark-read-btn"
                        onClick={() => handleMarkRead(n.id)}
                      >
                        <CheckCircle2 size={12} /> Mark Read
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
