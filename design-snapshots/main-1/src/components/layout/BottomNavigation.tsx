import React, { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Home, History, Target, Sparkles } from 'lucide-react';
import { QuickActionButton } from './QuickActionButton';
import { LiquidGlassNav, type LiquidNavItem } from './LiquidGlassNav';

interface BottomNavigationProps {
  onQuickAddClick: () => void;
}

const ROUTES = [
  { to: '/', exact: true },
  { to: '/activity', exact: false },
  { to: '/plan', exact: false },
  { to: '/assistant', exact: false },
];

/** The quick-add button sits between Activity and Plan. */
const FAB_AFTER = 1;

/**
 * MONEVA's tab bar: the routing half of it.
 *
 * The bar itself, and the liquid marker that flows between tabs, live in
 * LiquidGlassNav - which knows nothing about routes. This maps the four
 * destinations onto it and turns a tap into navigation.
 */
export const BottomNavigation: React.FC<BottomNavigationProps> = ({ onQuickAddClick }) => {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const items: LiquidNavItem[] = useMemo(
    () => [
      { key: 'home', label: 'Home', icon: <Home size={20} /> },
      { key: 'activity', label: 'Activity', icon: <History size={20} /> },
      { key: 'plan', label: 'Plan', icon: <Target size={20} /> },
      { key: 'assistant', label: 'Assistant', icon: <Sparkles size={20} /> },
    ],
    [],
  );

  // Accounts, Analytics and Profile have no tab of their own. -1 tells the bar
  // to fade the marker out rather than leave it pointing at the wrong thing.
  const activeIndex = ROUTES.findIndex((r) =>
    r.exact ? pathname === r.to : pathname.startsWith(r.to),
  );

  return (
    <LiquidGlassNav
      items={items}
      activeIndex={activeIndex}
      onChange={(index) => navigate(ROUTES[index].to)}
      centerAfter={FAB_AFTER}
      centerSlot={<QuickActionButton onClick={onQuickAddClick} />}
      ariaLabel="Sections"
    />
  );
};
