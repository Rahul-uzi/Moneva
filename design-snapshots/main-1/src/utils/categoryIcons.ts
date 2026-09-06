/**
 * Maps the icon name stored on a category to its Lucide component.
 *
 * Icons are imported by name rather than pulled from a namespace import so the
 * bundler can tree-shake everything we do not list here — a namespace import of
 * lucide-react would drag in the entire icon set.
 */
import {
  Briefcase,
  Bus,
  Clapperboard,
  Fuel,
  GraduationCap,
  HeartPulse,
  Home,
  PiggyBank,
  ShoppingBag,
  ShoppingCart,
  Tag,
  TrendingUp,
  UtensilsCrossed,
  Wallet,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  Briefcase,
  Bus,
  Clapperboard,
  Fuel,
  GraduationCap,
  HeartPulse,
  Home,
  PiggyBank,
  ShoppingBag,
  ShoppingCart,
  Tag,
  TrendingUp,
  UtensilsCrossed,
  Wallet,
  Zap,
};

/** Categories the user creates have no icon, so everything falls back to Tag. */
export const categoryIcon = (name?: string | null): LucideIcon =>
  (name ? ICONS[name] : undefined) ?? Tag;
