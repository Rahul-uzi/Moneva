// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EmailPanel } from './EmailPanel';

/**
 * Confirming the sign-in email, and moving the account to a new one.
 */

const post = vi.fn();
vi.mock('../../services/apiClient', () => ({
  apiClient: { post: (...a: unknown[]) => post(...a) },
  describeApiError: (err: { response?: { data?: { detail?: string } } }, fallback: string) =>
    err?.response?.data?.detail ?? fallback,
}));

const SENT = { message: 'sent', delivery_configured: true, retry_after_seconds: 60 };
const fail = (status: number, detail: string) => Object.assign(new Error(detail), { response: { status, data: { detail } } });

let onUpdated: ReturnType<typeof vi.fn<() => Promise<void>>>;
let onTitle: ReturnType<typeof vi.fn<(title: string) => void>>;
beforeEach(() => {
  onUpdated = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  onTitle = vi.fn<(title: string) => void>();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

const show = (verified = false) =>
  render(
    <EmailPanel email="person@example.com" verified={verified} onUpdated={onUpdated} onTitle={onTitle} onDone={() => {}} />,
  );

const typeCode = (code: string) =>
  fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: code } });

describe('verifying the current email', () => {
  it('offers to send a code only while unverified', () => {
    show(true);
    expect(screen.queryByRole('button', { name: /Send a code/ })).toBeNull();
    expect(screen.getByText(/Verified\. Password reset codes/)).toBeTruthy();
  });

  it('sends a code, then verifies with it and re-reads the account', async () => {
    post.mockResolvedValueOnce({ data: SENT }).mockResolvedValueOnce({ data: {} });
    show();
    fireEvent.click(screen.getByRole('button', { name: /Send a code/ }));
    expect(await screen.findByText(/We sent a 6-digit code to/)).toBeTruthy();
    // Shown masked, never in full.
    expect(screen.getByText(/pe•+@example\.com/)).toBeTruthy();
    expect(post).toHaveBeenCalledWith('/auth/send-verification');

    typeCode('123456');
    await waitFor(() => expect(post).toHaveBeenCalledWith('/auth/verify-email', { code: '123456' }));
    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
    expect(await screen.findByText('Email verified')).toBeTruthy();
  });

  it('does not submit until all six digits are in', async () => {
    post.mockResolvedValueOnce({ data: SENT });
    show();
    fireEvent.click(screen.getByRole('button', { name: /Send a code/ }));
    await screen.findByLabelText('6-digit code');
    typeCode('12345');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('says why a wrong code failed and lets them try again', async () => {
    post.mockResolvedValueOnce({ data: SENT }).mockRejectedValueOnce(fail(400, 'That code is not right.'));
    show();
    fireEvent.click(screen.getByRole('button', { name: /Send a code/ }));
    await screen.findByLabelText('6-digit code');
    typeCode('000000');
    expect(await screen.findByText('That code is not right.')).toBeTruthy();
    expect((screen.getByLabelText('6-digit code') as HTMLInputElement).disabled).toBe(false);
    expect(onUpdated).not.toHaveBeenCalled();
  });

  it('locks the boxes once the server says too many tries', async () => {
    post.mockResolvedValueOnce({ data: SENT }).mockRejectedValueOnce(fail(429, 'Too many wrong codes. Ask for a new one.'));
    show();
    fireEvent.click(screen.getByRole('button', { name: /Send a code/ }));
    await screen.findByLabelText('6-digit code');
    typeCode('000000');
    expect(await screen.findByText(/Too many wrong codes/)).toBeTruthy();
    expect((screen.getByLabelText('6-digit code') as HTMLInputElement).disabled).toBe(true);
  });

  it('keeps "send again" off until the countdown ends', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    post.mockResolvedValueOnce({ data: { ...SENT, retry_after_seconds: 3 } });
    show();
    fireEvent.click(screen.getByRole('button', { name: /Send a code/ }));
    const again = await screen.findByRole('button', { name: /Send again in 0:03/ });
    expect((again as HTMLButtonElement).disabled).toBe(true);
    // One tick per second, each scheduled after the previous render.
    for (let i = 0; i < 4; i++) {
      await act(async () => { vi.advanceTimersByTime(1000); });
    }
    expect((screen.getByRole('button', { name: 'Send a new code' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('changing the email', () => {
  const openChange = () => {
    show(true);
    fireEvent.click(screen.getByRole('button', { name: 'Change email' }));
  };

  it('asks for the password and sends the code to the NEW address', async () => {
    post.mockResolvedValueOnce({ data: { ...SENT, pending_email: 'fresh@example.com' } });
    openChange();
    expect(onTitle).toHaveBeenLastCalledWith('Change email');
    fireEvent.change(screen.getByLabelText('New email'), { target: { value: ' Fresh@Example.com ' } });
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'secret-pass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/auth/change-email/start', {
      new_email: 'fresh@example.com', password: 'secret-pass',
    }));
    expect(await screen.findByText(/fr•+@example\.com/)).toBeTruthy();
  });

  it('confirms the change with the code and says where they now sign in', async () => {
    post
      .mockResolvedValueOnce({ data: { ...SENT, pending_email: 'fresh@example.com' } })
      .mockResolvedValueOnce({ data: {} });
    openChange();
    fireEvent.change(screen.getByLabelText('New email'), { target: { value: 'fresh@example.com' } });
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'secret-pass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    await screen.findByLabelText('6-digit code');

    typeCode('654321');
    await waitFor(() => expect(post).toHaveBeenCalledWith('/auth/change-email/confirm', { code: '654321' }));
    expect(await screen.findByText('Email changed')).toBeTruthy();
    expect(screen.getByText(/You now sign in with fresh@example\.com/)).toBeTruthy();
    expect(onUpdated).toHaveBeenCalled();
  });

  it('catches a typo before asking the server', () => {
    openChange();
    fireEvent.change(screen.getByLabelText('New email'), { target: { value: 'fresh@example' } });
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'secret-pass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    expect(screen.getByRole('alert').textContent).toMatch(/does not look like an email/);
    expect(post).not.toHaveBeenCalled();
  });

  it('refuses the address it already has', () => {
    openChange();
    fireEvent.change(screen.getByLabelText('New email'), { target: { value: 'PERSON@example.com' } });
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'secret-pass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    expect(screen.getByRole('alert').textContent).toMatch(/already your email/);
    expect(post).not.toHaveBeenCalled();
  });

  it('will not send without the password', () => {
    openChange();
    fireEvent.change(screen.getByLabelText('New email'), { target: { value: 'fresh@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Enter your password/);
    expect(post).not.toHaveBeenCalled();
  });

  it("shows the server's reason when the address belongs to someone else", async () => {
    post.mockRejectedValueOnce(fail(409, 'That email already belongs to another MONEVA account.'));
    openChange();
    fireEvent.change(screen.getByLabelText('New email'), { target: { value: 'taken@example.com' } });
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'secret-pass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByText(/already belongs to another MONEVA account/)).toBeTruthy();
    expect(screen.queryByLabelText('6-digit code')).toBeNull();
  });
});
