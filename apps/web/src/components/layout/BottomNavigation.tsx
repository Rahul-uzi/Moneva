import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, History, Target, Sparkles } from 'lucide-react';
import { QuickActionButton } from './QuickActionButton';
import './BottomNavigation.css';

interface BottomNavigationProps {
  onQuickAddClick: () => void;
}

export const BottomNavigation: React.FC<BottomNavigationProps> = ({ onQuickAddClick }) => {
  return (
    <nav className="bottom-nav">
      <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? 'nav-active' : ''}`} end>
        <Home size={20} />
        <span>Home</span>
      </NavLink>

      <NavLink to="/activity" className={({ isActive }) => `nav-item ${isActive ? 'nav-active' : ''}`}>
        <History size={20} />
        <span>Activity</span>
      </NavLink>

      <div className="nav-quick-wrapper">
        <QuickActionButton onClick={onQuickAddClick} />
      </div>

      <NavLink to="/plan" className={({ isActive }) => `nav-item ${isActive ? 'nav-active' : ''}`}>
        <Target size={20} />
        <span>Plan</span>
      </NavLink>

      <NavLink to="/assistant" className={({ isActive }) => `nav-item ${isActive ? 'nav-active' : ''}`}>
        <Sparkles size={20} />
        <span>Assistant</span>
      </NavLink>
    </nav>
  );
};
