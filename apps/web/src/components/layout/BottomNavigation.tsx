import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Home, History, Target, Sparkles } from 'lucide-react';
import { QuickActionButton } from './QuickActionButton';
import './BottomNavigation.css';

interface BottomNavigationProps {
  onQuickAddClick: () => void;
}

const TABS = [
  { to: '/', exact: true, label: 'Home', Icon: Home },
  { to: '/activity', exact: false, label: 'Activity', Icon: History },
  { to: '/plan', exact: false, label: 'Plan', Icon: Target },
  { to: '/assistant', exact: false, label: 'Ask', Icon: Sparkles },
] as const;

/** The quick-add button sits between Activity and Plan. */
const FAB_AFTER = 1;

/**
 * MONEVA's tab bar.
 *
 * Only the open tab is named: it fills with voltage and its label unrolls to
 * its own width, while the rest stay as icons. That is the entire navigation
 * animation - one width transition, no canvas and no per-frame work, which is
 * what replaced the liquid marker.
 *
 * Accounts, Analytics and Profile have no tab of their own, so on those routes
 * nothing is marked current rather than something being marked wrongly.
 */
export const BottomNavigation: React.FC<BottomNavigationProps> = ({ onQuickAddClick }) => {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const activeIndex = TABS.findIndex((t) =>
    t.exact ? pathname === t.to : pathname.startsWith(t.to),
  );

  return (
    <nav className="dock" aria-label="Sections">
      {TABS.map((tab, index) => {
        const isActive = index === activeIndex;
        return (
          <React.Fragment key={tab.to}>
            <button
              type="button"
              className={`dock-tab${isActive ? ' is-active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
              aria-label={tab.label}
              onClick={() => navigate(tab.to)}
            >
              <tab.Icon size={20} aria-hidden="true" />
              {/* Always rendered so the label is available to a screen reader
                  on every tab, not only the open one. */}
              <span className="dock-label">{tab.label}</span>
            </button>
            {index === FAB_AFTER && <QuickActionButton onClick={onQuickAddClick} />}
          </React.Fragment>
        );
      })}
    </nav>
  );
};
