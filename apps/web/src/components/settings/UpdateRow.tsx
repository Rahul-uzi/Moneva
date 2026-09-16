import React from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { Button } from '../ui/Button';
import {
  canSelfUpdate,
  downloadUpdate,
  installUpdate,
  lookForUpdate,
  openInstallPermission,
  updateButtonBusy,
  updateButtonHint,
  updateButtonLabel,
  updaterStatus,
  type UpdateState,
} from '../../services/appUpdate';
import { currentVersionName } from '../../services/updateCheck';
import './UpdateRow.css';

/**
 * One button that carries a new build from the server onto the phone.
 *
 * It changes what it does as it goes - check, then download, then install -
 * rather than showing three buttons of which two are always wrong. At every
 * point there is exactly one sensible next action, so there is one button,
 * and it says which action that is.
 *
 * The only step it cannot take for the user is the install itself: Android
 * shows its own confirmation and there is no way around that for an app
 * outside the Play Store, nor should there be. The row says so before they
 * start rather than surprising them with a system dialog.
 */
export const UpdateRow: React.FC = () => {
  const running = currentVersionName();
  const [state, setState] = React.useState<UpdateState>({ stage: 'idle' });

  // Whether the phone would let us install, checked when the row appears so a
  // person who has already granted it never sees the permission step at all.
  const [permissionKnown, setPermissionKnown] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    let alive = true;
    updaterStatus().then((s) => {
      if (alive && s) setPermissionKnown(!s.needsPermission);
    });
    return () => { alive = false; };
  }, []);

  /*
   * The whole flow, as one handler.
   *
   * Which step runs is decided by the state the button is already in, so the
   * button and the action can never disagree about what pressing it does -
   * the failure that a separate `if (isDownloading)` somewhere else invites.
   */
  const press = async () => {
    if (updateButtonBusy(state)) return;

    switch (state.stage) {
      case 'blocked': {
        await openInstallPermission();
        // Re-read rather than assume. They may have come straight back
        // without granting anything, and claiming otherwise would send them
        // into a download that cannot be installed.
        const status = await updaterStatus();
        const granted = !!status && !status.needsPermission;
        setPermissionKnown(granted);
        setState(granted ? { stage: 'available', latest: state.latest } : state);
        return;
      }

      case 'available': {
        setState({ stage: 'downloading', latest: state.latest, percent: 0 });
        const done = await downloadUpdate(state.latest, (percent) => {
          // Functional update: progress events arrive faster than React
          // re-renders, and reading `state` here would read a stale one.
          setState((s) => (s.stage === 'downloading' ? { ...s, percent } : s));
        });
        setState(done);
        return;
      }

      case 'ready': {
        const failure = await installUpdate(state.path);
        // Null means the installer opened. Nothing more happens here - if
        // they accept, Android stops this process mid-sentence.
        if (failure) setState(failure);
        return;
      }

      case 'idle':
      case 'current':
      case 'failed':
      default: {
        setState({ stage: 'checking' });
        setState(await lookForUpdate(running));
      }
    }
  };

  // The web app is served fresh on every load, so it is never out of date and
  // has nothing to install. A button offering to update it would be a lie.
  if (!canSelfUpdate()) {
    return (
      <div className="security-feature-row">
        <div className="security-feature-copy">
          <span className="sec-label"><RefreshCw size={14} /> Version</span>
          <span className="text-body">
            You are on version {running}. The web app updates itself every time
            you open it.
          </span>
        </div>
      </div>
    );
  }

  const hint = updateButtonHint(state, running);
  const downloading = state.stage === 'downloading';

  return (
    <div className="security-feature-row">
      <div className="security-feature-copy">
        <span className="sec-label">
          <Download size={14} /> App updates
        </span>
        <span className="text-body">{hint}</span>

        {/* A bar as well as the number on the button. On a slow connection the
            percentage can sit still for several seconds, and a bar that has
            visibly moved since it started is the difference between "working"
            and "frozen". */}
        {downloading && (
          <span
            className="update-row-bar"
            role="progressbar"
            aria-valuenow={state.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Downloading the update"
          >
            <span className="update-row-bar-fill" style={{ width: `${state.percent}%` }} />
          </span>
        )}

        {permissionKnown === false && state.stage === 'idle' && (
          <span className="update-row-note">
            Android will ask for permission the first time.
          </span>
        )}
      </div>

      <Button
        variant={state.stage === 'ready' || state.stage === 'available' ? 'primary' : 'secondary'}
        size="sm"
        className="row-action-btn"
        isLoading={updateButtonBusy(state)}
        onClick={press}
      >
        {updateButtonLabel(state)}
      </Button>
    </div>
  );
};

export default UpdateRow;
