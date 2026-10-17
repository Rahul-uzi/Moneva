import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Home, History, Target, Sparkles } from 'lucide-react';
import { QuickActionButton } from './QuickActionButton';
import './BottomNavigation.css';

interface BottomNavigationProps {
  onQuickAddClick: () => void;
}

/* The quick-add button sits in the middle: the first two tabs on its left,
   the last two on its right. */
const TABS = [
  { to: '/', exact: true, label: 'Home', Icon: Home },
  { to: '/activity', exact: false, label: 'Activity', Icon: History },
  { to: '/plan', exact: false, label: 'Plan', Icon: Target },
  { to: '/assistant', exact: false, label: 'Ask', Icon: Sparkles },
] as const;

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

  const tab = (index: number) => {
    const { to, label, Icon } = TABS[index];
    const isActive = index === activeIndex;
    return (
      <button
        key={to}
        type="button"
        className={`dock-tab${isActive ? ' is-active' : ''}`}
        aria-current={isActive ? 'page' : undefined}
        aria-label={label}
        onClick={() => navigate(to)}
      >
        <Icon size={20} aria-hidden="true" />
        {/* Always rendered so the label is available to a screen reader
            on every tab, not only the open one. */}
        <span className="dock-label"><span>{label}</span></span>
      </button>
    );
  };

  /* Two halves of equal width with the button between them, so the button
     stays in the middle of the bar whichever tab is open. Spread as five
     items, the open tab's label pushed it about 20px off centre. */
  return (
    <nav className="dock" aria-label="Sections">
      <div className="dock-side dock-side--start">{[0, 1].map(tab)}</div>
      <QuickActionButton onClick={onQuickAddClick} />
      <div className="dock-side dock-side--end">{[2, 3].map(tab)}</div>
    </nav>
  );
};
