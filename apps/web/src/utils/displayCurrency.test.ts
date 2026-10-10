// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { formatMonetaryCompact, formatMonetaryValue, getDisplayCurrency, setDisplayCurrency } from './money';
import { useAuthStore } from '../stores/useAuthStore';
import type { User } from '../types/api';

/**
 * Amounts that do not name a currency follow the signed-in person's. It was
 * 'INR' everywhere, so an account kept in dollars showed ₹ on ~50 figures.
 */

afterEach(() => { setDisplayCurrency('INR'); });

const user = (currency: string): User => ({
  id: 'u', email: 'person@example.com', display_name: 'Asha Rao', currency, timezone: 'UTC',
  is_active: true, avatar_data_url: null, totp_enabled: false, created_at: '', updated_at: '',
});

describe('the display currency', () => {
  it('formats in the person\'s currency when none is given', () => {
    setDisplayCurrency('USD');
    expect(formatMonetaryValue(123456789)).toBe('USD 1,234,567.89');
    expect(formatMonetaryCompact(400000)).toBe('USD 4,000');
  });

  it('keeps lakh grouping for rupees and thousands for everything else', () => {
    expect(formatMonetaryValue(123456789, 'INR')).toBe('₹12,34,567.89');
    expect(formatMonetaryValue(123456789, 'EUR')).toBe('EUR 1,234,567.89');
  });

  it('still honours a currency that is passed explicitly', () => {
    setDisplayCurrency('USD');
    expect(formatMonetaryValue(10000, 'INR')).toBe('₹100.00');
  });

  it('follows the signed-in person, including a currency switch and sign-out', () => {
    useAuthStore.setState({ user: user('GBP') });
    expect(getDisplayCurrency()).toBe('GBP');
    expect(formatMonetaryValue(5000)).toBe('GBP 50.00');
    useAuthStore.setState({ user: user('EUR') });
    expect(getDisplayCurrency()).toBe('EUR');
    useAuthStore.setState({ user: null });
    expect(getDisplayCurrency()).toBe('INR');
  });
});
