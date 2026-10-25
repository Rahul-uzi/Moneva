import React from 'react';
import { RefreshCw } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { App } from '@capacitor/app';
import { SettingsRow } from '../profile/ProfileRows';
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
import { currentVersionName, type LatestVersion } from '../../services/updateCheck';
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

  const download = async (latest: LatestVersion) => {
    setState({ stage: 'downloading', latest, percent: 0 });
    const done = await downloadUpdate(latest, (percent) => {
      // Functional update: progress events arrive faster than React
      // re-renders, and reading `state` here would read a stale one.
      setState((s) => (s.stage === 'downloading' ? { ...s, percent } : s));
    });
    setState(done);
  };

  const check = async (): Promise<UpdateState> => {
    setState({ stage: 'checking' });
    const found = await lookForUpdate(running);
    setState(found);
    return found;
  };

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
        // Android's switch opens over the app; whether it was turned on is
        // read when the person comes back (see the effect below). Reading it
        // here, the moment the screen opened, always said "not yet" - and the
        // button stayed on "Allow updates" after they had allowed it.
        awaitingPermission.current = state.latest;
        await openInstallPermission();
        return;
      }

      case 'available':
        await download(state.latest);
        return;

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
      default:
        await check();
    }
  };

  /* Back from Android's "Install unknown apps" switch: if it was turned on,
     carry straight on with the download they asked for. */
  const awaitingPermission = React.useRef<LatestVersion | null>(null);
  React.useEffect(() => {
    if (!canSelfUpdate()) return;
    const sub = App.addListener('appStateChange', ({ isActive }) => {
      const latest = awaitingPermission.current;
      if (!isActive || !latest) return;
      void updaterStatus().then((status) => {
        const granted = !!status && !status.needsPermission;
        setPermissionKnown(granted);
        if (!granted) return;
        awaitingPermission.current = null;
        void download(latest);
      });
    });
    return () => { void sub.then((h) => h.remove()); };
  }, []);

  /* Sent here by the update banner or the "new version" notification
     (UPDATE_ROUTE): bring the row into view and start without another tap -
     check, and download if nothing stands in the way. The flag is cleared at
     once, so going back and forward does not start it again. */
  const rowRef = React.useRef<HTMLButtonElement>(null);
  const [params, setParams] = useSearchParams();
  const startNow = params.get('update') === '1';
  const started = React.useRef(false);
  React.useEffect(() => {
    // Re-armed once the flag is gone, so a later "Get it" starts it again.
    if (!startNow) { started.current = false; return; }
    if (started.current || !canSelfUpdate()) return;
    started.current = true;
    // Next tick: the row has laid out, and the effect itself sets no state.
    // Deliberately not cancelled when the flag is cleared just below - that
    // re-runs this effect, and cancelling here meant nothing ever started.
    setTimeout(() => {
      rowRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      void check().then((found) => {
        if (found.stage === 'available') void download(found.latest);
      });
    }, 0);
    setParams((p) => { p.delete('update'); return p; }, { replace: true });
    // Runs when the flag appears; `check`/`download` only close over setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startNow]);

  // The web app is served fresh on every load, so it is never out of date and
  // has nothing to install. A button offering to update it would be a lie.
  if (!canSelfUpdate()) {
    return (
      <SettingsRow
        icon={<RefreshCw />}
        title="Version"
        sub={`You are on version ${running}. The web app updates itself every time you open it.`}
      />
    );
  }

  const hint = updateButtonHint(state, running);
  const downloading = state.stage === 'downloading';
  const busy = updateButtonBusy(state);
  const primary = state.stage === 'ready' || state.stage === 'available';

  return (
    <SettingsRow
      icon={<RefreshCw />}
      title="Version"
      sub={(
        <>
          {hint}
          {permissionKnown === false && state.stage === 'idle' && (
            <span className="update-row-note">Android will ask for permission the first time.</span>
          )}
        </>
      )}
      action={(
        <button ref={rowRef} type="button" className={`pf-mini${primary ? ' is-primary' : ''}`} disabled={busy} onClick={press}>
          {busy && !downloading ? <span className="pf-spin" /> : null}
          {updateButtonLabel(state)}
        </button>
      )}
      /* A bar as well as the number on the button. On a slow connection the
         percentage can sit still for several seconds, and a bar that has
         visibly moved is the difference between "working" and "frozen". */
      footer={downloading ? (
        <span
          className="pf-bar"
          role="progressbar"
          aria-valuenow={state.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Downloading the update"
        >
          <i style={{ width: `${state.percent}%` }} />
        </span>
      ) : undefined}
    />
  );
};

export default UpdateRow;
