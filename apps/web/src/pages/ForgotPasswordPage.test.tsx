// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ForgotPasswordPage } from './ForgotPasswordPage';

/**
 * Not sending four emails in four seconds.
 *
 * The server is what actually enforces this now, and it has its own tests.
 * This is about the screen, because the screen is what caused the taps: it
 * showed no countdown, so a person whose email had not arrived had no way of
 * knowing that pressing again would do nothing - and it offered no way to ask
 * for another code without going back a step, which reads like starting over.
 *
 * So both halves are tested: that the button stops accepting taps while the
 * server is ignoring them, and that there is now a resend that does not throw
 * away the step the person is on.
 */

const post = vi.fn();

vi.mock('../services/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/apiClient')>();
  return {
    ...actual,
    apiClient: { ...actual.apiClient, post: (...args: unknown[]) => post(...args) },
  };
});

vi.mock('../stores/useUiStore', () => ({
  useUiStore: () => ({ addToast: vi.fn() }),
}));

const REPLY = {
  data: {
    message: 'If that email has an account, a reset code is on its way.',
    delivery_configured: true,
    retry_after_seconds: 60,
  },
};

const draw = () => render(
  <MemoryRouter><ForgotPasswordPage /></MemoryRouter>,
);

const askForACode = async () => {
  fireEvent.change(screen.getByPlaceholderText('you@example.com'),
    { target: { value: 'someone@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: /send reset code/i }));
  await waitFor(() => expect(post).toHaveBeenCalled());
};

beforeEach(() => {
  post.mockReset();
  post.mockResolvedValue(REPLY);
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('asking for a reset code', () => {
  it('sends one request for one tap', async () => {
    draw();
    await askForACode();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('will not send again while the server is still ignoring it', async () => {
    /*
     * The button becoming a countdown is the whole fix on this side. Without
     * it the screen looked idle, which is indistinguishable from "it did not
     * work", and the reasonable response to that is to press it again.
     */
    draw();
    await askForACode();
    const resend = await screen.findByRole('button', { name: /send another code in/i });
    expect((resend as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(resend);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('counts the wait down rather than just refusing', async () => {
    draw();
    await askForACode();
    await screen.findByRole('button', { name: /send another code in 60s/i });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    await screen.findByRole('button', { name: /send another code in 57s/i });
  });

  it('lets another code be asked for once the wait is over', async () => {
    // The cooldown has to expire. A resend that never becomes available again
    // strands anyone whose first email genuinely went astray.
    draw();
    await askForACode();
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    const resend = await screen.findByRole('button', { name: /^send another code$/i });
    expect((resend as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(resend);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  });

  it('ignores Enter in the email field while the wait is running', async () => {
    /*
     * A disabled button cannot be clicked, but it does not reliably stop a
     * form from submitting when Enter is pressed in a text field - browsers
     * differ on implicit submission past a disabled default button. So the
     * handler carries the same guard as the button, and this is the only test
     * that reaches it: clicking cannot, because the click never arrives.
     *
     * Found by mutation - removing the guard left every other test passing.
     */
    draw();
    await askForACode();
    // Back to step one with the wait still running, which is the one way to
    // have that form on screen and a live cooldown at the same time.
    fireEvent.click(screen.getByRole('button', { name: /use a different email/i }));
    const form = screen.getByPlaceholderText('you@example.com').closest('form');
    expect(form).toBeTruthy();
    fireEvent.submit(form as HTMLFormElement);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  });

  it('is right again after the screen has been asleep', async () => {
    /*
     * A locked phone stops firing timers. A counter that subtracted one per
     * tick would freeze wherever it got to and carry on from there, so two
     * minutes later it would still be showing a wait that had long since
     * ended - and refusing a tap the server would now accept.
     *
     * The clock is moved forward here WITHOUT running the intervening ticks,
     * which is exactly what a sleeping screen does.
     */
    draw();
    await askForACode();
    await screen.findByRole('button', { name: /send another code in 60s/i });

    vi.setSystemTime(Date.now() + 120_000);
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    const resend = await screen.findByRole('button', { name: /^send another code$/i });
    expect((resend as HTMLButtonElement).disabled).toBe(false);
  });

  it('offers a resend without throwing away the code step', async () => {
    /*
     * The missing affordance. "Use a different email" was the only way back,
     * and it drops the person to step one - so they retyped the same address
     * and sent again, which is exactly the behaviour being stopped.
     */
    draw();
    await askForACode();
    await screen.findByRole('button', { name: /send another code in/i });
    // Still on the code step: the field for the code is on screen.
    expect(screen.getByPlaceholderText(/\d{6}|code/i)).toBeTruthy();
  });

  it('does not promise a new email it may not have sent', async () => {
    /*
     * Inside the cooldown the server sends nothing and keeps the existing
     * code alive. Telling the person a fresh code is coming would make them
     * discard the mail that actually works and wait for one that is not
     * coming.
     */
    draw();
    await askForACode();
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    fireEvent.click(await screen.findByRole('button', { name: /^send another code$/i }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(screen.getByText(/already sent still works/i)).toBeTruthy();
  });
});
