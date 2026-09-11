/**
 * The floor under the app.
 *
 * Network failures were always handled - every screen has an ErrorState with a
 * retry. What had no handler at all was a throw during RENDER: one null where
 * an object was expected, one figure that arrived as a string, and React
 * unmounts the whole tree. The screen goes white, and it stays white through
 * every tap and every navigation, because there is no tree left to render the
 * navigation. The only way out is to force-stop the app from Android settings,
 * which nobody knows to do.
 *
 * Two levels, because they need to fail differently:
 *
 *   - A SCREEN boundary wraps each route. Analytics breaking should cost you
 *     Analytics, not the app - the tab bar stays, and you can walk away.
 *   - The APP boundary is the last resort, for a fault in the shell itself.
 *     There is nowhere to walk to from there, so it offers a restart.
 *
 * The screen boundary resets when the route changes. Without that it latches:
 * you leave the broken screen, come back, and it is still showing the error
 * from before - which looks exactly like a screen that is permanently broken
 * rather than one that failed once.
 */

import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { RefreshCw, Home, Copy } from 'lucide-react';
import { Button } from '../ui/Button';
import { Illustration } from '../ui/Illustration';
import { report, loadCrashes, describeCrash } from '../../services/crashReporter';
import '../ui/States.css';

/**
 * A failed lazy() chunk is not a bug in the screen.
 *
 * It means the file the screen lives in could not be loaded - which on a
 * website-distributed build usually means the app was updated underneath a
 * running session, and the chunk it is asking for no longer exists. Telling
 * someone "this screen has a problem" sends them hunting for a fault that is
 * not there; the honest instruction is to reload.
 */
const isChunkLoadFailure = (error: unknown): boolean => {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  return (
    /dynamically imported module/i.test(msg) ||
    /loading chunk/i.test(msg) ||
    /module script failed/i.test(msg) ||
    /importing a module/i.test(msg)
  );
};

interface Props {
  children: React.ReactNode;
  /** 'screen' keeps the shell around it; 'app' is the last resort. */
  level: 'screen' | 'app';
  /** Where this boundary sits, for the crash record. */
  where: string;
  /** Change this to clear a tripped boundary - the route path, normally. */
  resetKey?: string;
  /** Rendered instead of the default fallback, if a caller wants its own. */
  onGoHome?: () => void;
}

interface State {
  error: Error | null;
  isChunkError: boolean;
}

class Boundary extends React.Component<Props, State> {
  state: State = { error: null, isChunkError: false };

  static getDerivedStateFromError(error: Error): State {
    return { error, isChunkError: isChunkLoadFailure(error) };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // A chunk failure is an update artefact rather than a defect, and
    // recording it as a crash would bury the real ones.
    if (!isChunkLoadFailure(error)) {
      report(error, this.props.where, info.componentStack ?? undefined);
    }
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null, isChunkError: false });
    }
  }

  private retry = () => this.setState({ error: null, isChunkError: false });

  private reload = () => window.location.reload();

  private copyDetails = () => {
    const latest = loadCrashes()[0];
    if (!latest) return;
    void navigator.clipboard?.writeText(describeCrash(latest)).catch(() => {
      /* Clipboard is unavailable in some WebViews. Nothing to recover. */
    });
  };

  render() {
    const { error, isChunkError } = this.state;
    if (!error) return this.props.children;

    const isApp = this.props.level === 'app';
    // The app boundary has no shell around it, so it has to fill the screen.
    const shell = `state-container error-state${isApp ? ' state-fullscreen' : ''}`;

    if (isChunkError) {
      return (
        <div className={shell} role="alert">
          <Illustration name="error" />
          <h3 className="heading-sm">MONEVA was updated</h3>
          <p className="text-body">
            A newer version is installed. Reload to pick it up - nothing you have
            saved is affected.
          </p>
          <Button variant="primary" size="sm" onClick={this.reload}>
            <RefreshCw size={14} /> Reload
          </Button>
        </div>
      );
    }

    return (
      <div className={shell} role="alert">
        <Illustration name="error" />
        <h3 className="heading-sm">
          {isApp ? 'MONEVA ran into a problem' : 'This screen ran into a problem'}
        </h3>
        <p className="text-body">
          {isApp
            ? 'Something went wrong outside any one screen. Your data is safe on the server - restarting is enough.'
            : 'The rest of the app is fine, and nothing you have saved is affected. Try this screen again, or go somewhere else.'}
        </p>
        <div className="state-actions">
          {isApp ? (
            <Button variant="primary" size="sm" onClick={this.reload}>
              <RefreshCw size={14} /> Restart
            </Button>
          ) : (
            <>
              <Button variant="primary" size="sm" onClick={this.retry}>
                <RefreshCw size={14} /> Try again
              </Button>
              {this.props.onGoHome && (
                <Button variant="secondary" size="sm" onClick={this.props.onGoHome}>
                  <Home size={14} /> Go home
                </Button>
              )}
            </>
          )}
          <Button variant="ghost" size="sm" onClick={this.copyDetails}>
            <Copy size={14} /> Copy details
          </Button>
        </div>
      </div>
    );
  }
}

/** The last resort. Wraps the router, so it has no route to reset on. */
export const AppErrorBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Boundary level="app" where="app">
    {children}
  </Boundary>
);

/**
 * One screen's boundary. Resets when the route changes, so a screen that
 * failed once is not treated as broken forever.
 */
export const RouteErrorBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <Boundary
      level="screen"
      where={location.pathname}
      resetKey={location.pathname}
      onGoHome={() => navigate('/')}
    >
      {children}
    </Boundary>
  );
};

export { Boundary as ErrorBoundary };
