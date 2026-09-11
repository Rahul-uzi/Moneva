// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { AppErrorBoundary, RouteErrorBoundary } from './ErrorBoundary';
import { loadCrashes, clearCrashes } from '../../services/crashReporter';

/**
 * What a white screen actually costs.
 *
 * Before this boundary existed, one throw during render unmounted the whole
 * tree - and it stayed unmounted. Not for that screen: for the app. No tab
 * bar, no back, no way to reach any other page, because there was nothing left
 * rendering the navigation. The only exit was Android's force-stop, which
 * nobody thinks to use, so the observed behaviour was "the app is dead until I
 * reinstall it".
 *
 * The tests below are about the two ways a boundary quietly fails to fix that:
 * catching the error but taking the rest of the app down with it, and catching
 * it once and then never letting go.
 */

/** Throws only on the route it is told to, so navigation can be tested. */
const Boom: React.FC<{ on: string; error?: Error }> = ({ on, error }) => {
  const { pathname } = useLocation();
  if (pathname === on) throw error ?? new Error('render exploded');
  return <p>screen is fine</p>;
};

/**
 * The same shape App.tsx uses: one boundary component type reused across
 * routes. That reuse is the whole reason the reset matters - see the
 * "does not latch" test.
 */
const AppLike: React.FC<{ start: string; error?: Error }> = ({ start, error }) => (
  <MemoryRouter initialEntries={[start]}>
    <nav>
      <Link to="/a">go a</Link>
      <Link to="/b">go b</Link>
    </nav>
    <Routes>
      <Route path="/a" element={<RouteErrorBoundary><Boom on="/a" error={error} /></RouteErrorBoundary>} />
      <Route path="/b" element={<RouteErrorBoundary><Boom on="/a" error={error} /></RouteErrorBoundary>} />
    </Routes>
  </MemoryRouter>
);

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  clearCrashes();
  // React logs every caught error. That is correct behaviour and unreadable
  // test output; the assertions below check what the USER sees.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
  cleanup();
  clearCrashes();
});

describe('a screen that throws while rendering', () => {
  it('shows something instead of nothing', () => {
    render(<AppLike start="/a" />);
    expect(screen.getByText(/this screen ran into a problem/i)).toBeTruthy();
  });

  it('leaves the rest of the app usable', () => {
    // The point of a per-screen boundary. If the navigation goes down with the
    // screen, the boundary has only made the white page prettier.
    render(<AppLike start="/a" />);
    expect(screen.getByText('go b')).toBeTruthy();
  });

  it('says the saved data is unaffected, because it is', () => {
    render(<AppLike start="/a" />);
    expect(screen.getByText(/nothing you have saved is affected/i)).toBeTruthy();
  });

  it('offers a way out that is not force-stopping the app', () => {
    // By role, not by text: the body copy talks about trying again too, and a
    // test that cannot tell the button from the sentence describing it would
    // pass on a fallback with no buttons at all.
    render(<AppLike start="/a" />);
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /go home/i })).toBeTruthy();
  });
});

describe('the boundary does not latch', () => {
  it('clears when you navigate to a screen that works', () => {
    /**
     * The failure this exists to prevent.
     *
     * React Router renders each route's element into the same tree position,
     * and App.tsx uses the SAME boundary component type for every route - so
     * navigating reconciles the existing boundary instead of mounting a fresh
     * one. The class instance survives, and with it `state.error`. Without the
     * reset, walking away from a broken screen and opening a working one shows
     * the old error, and every screen thereafter looks broken too.
     */
    render(<AppLike start="/a" />);
    expect(screen.getByText(/this screen ran into a problem/i)).toBeTruthy();

    fireEvent.click(screen.getByText('go b'));

    expect(screen.queryByText(/this screen ran into a problem/i)).toBeNull();
    expect(screen.getByText('screen is fine')).toBeTruthy();
  });

  it('trips again if you go back to the screen that is still broken', () => {
    // The reset must not be a one-way door: a screen that is genuinely broken
    // has to keep saying so, or the user gets a blank page instead.
    render(<AppLike start="/a" />);
    fireEvent.click(screen.getByText('go b'));
    fireEvent.click(screen.getByText('go a'));
    expect(screen.getByText(/this screen ran into a problem/i)).toBeTruthy();
  });
});

describe('an app updated underneath a running session', () => {
  /**
   * MONEVA is installed from a website, not a store, so an update can land
   * while the app is open and the chunk a screen wants stops existing. That
   * throws exactly like a bug, and telling someone "this screen has a problem"
   * sends them hunting for a fault that is not there.
   */
  const chunkError = new Error('Failed to fetch dynamically imported module: /assets/Plan-x1.js');

  it('says it was updated, not that the screen is broken', () => {
    render(<AppLike start="/a" error={chunkError} />);
    expect(screen.getByText(/moneva was updated/i)).toBeTruthy();
    expect(screen.queryByText(/ran into a problem/i)).toBeNull();
  });

  it('is not filed as a crash', () => {
    // Recording these would bury the real crashes under update noise - and on
    // a website-distributed build, this record is the only crash report there is.
    render(<AppLike start="/a" error={chunkError} />);
    expect(loadCrashes()).toHaveLength(0);
  });
});

describe('what gets written down', () => {
  it('records a real crash, with where it happened', () => {
    render(<AppLike start="/a" />);
    const [crash] = loadCrashes();
    expect(crash).toBeTruthy();
    expect(crash.message).toContain('render exploded');
    expect(crash.where).toBe('/a');
  });
});

describe('the last resort', () => {
  it('catches a fault with no screen to blame', () => {
    const Explode: React.FC = () => {
      throw new Error('the shell itself');
    };
    render(<AppErrorBoundary><Explode /></AppErrorBoundary>);
    expect(screen.getByText(/moneva ran into a problem/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /restart/i })).toBeTruthy();
  });
});
