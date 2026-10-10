// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { NumberPad, PadAmount } from './NumberPad';

afterEach(cleanup);

const Harness = ({ withInput = false }: { withInput?: boolean }) => {
  const [v, setV] = useState('');
  return (
    <>
      {withInput && <input aria-label="Name" />}
      <PadAmount value={v} label="Amount" />
      <NumberPad value={v} onChange={setV} />
    </>
  );
};

describe('the number pad', () => {
  it('types the figure and announces it', () => {
    render(<Harness />);
    for (const k of ['4', '0', '0', '0']) fireEvent.click(screen.getByRole('button', { name: k }));
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Amount: ₹4,000');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Amount: ₹400');
  });

  it('takes digits from a physical keyboard', () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: '7' });
    fireEvent.keyDown(window, { key: '5' });
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Amount: ₹75');
  });

  // Typing a name next to the pad must not also type into the amount.
  it('leaves keys alone while the user is typing in a field', () => {
    render(<Harness withInput />);
    const name = screen.getByLabelText('Name');
    name.focus();
    fireEvent.keyDown(name, { key: '7' });
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Amount: ₹0');
  });

  it('never summons the phone keyboard - there is no input to focus', () => {
    const onChange = vi.fn();
    const { container } = render(<NumberPad value="" onChange={onChange} />);
    expect(container.querySelector('input, textarea')).toBeNull();
  });
});
