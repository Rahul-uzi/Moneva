import React from 'react';
import { BatteryWarning, BellRing, MessageSquareText, Zap } from 'lucide-react';
import { SmsCaptureSection } from '../settings/SmsCaptureSection';
import { SettingsRow, SwitchRow } from './ProfileRows';
import type { CaptureSettings } from './useCaptureSettings';

interface CatchingPanelProps {
  settings: CaptureSettings;
  onOpenInbox: () => void;
  onReadPrivacy: () => void;
}

/** Everything about MONEVA noticing payments by itself, in one sheet. */
export const CatchingPanel: React.FC<CatchingPanelProps> = ({ settings, onOpenInbox, onReadPrivacy }) => {
  const { supported, capture, health, devicePerm, autoAdd } = settings;
  const capturing = capture.granted && capture.capturing;
  const stopped = health.state === 'disconnected';
  const statusTone = !supported || !capturing ? 'is-off' : health.tone === 'ok' ? '' : 'is-warn';

  const autoSub = !autoAdd.enabled
    ? 'Off. Everything waits for you to tap.'
    : health.tone !== 'ok'
      ? 'On, but nothing is reaching MONEVA, so nothing is being added.'
      : `On, up to ₹${(autoAdd.ceilingMinor / 100).toLocaleString('en-IN')} from payment apps. Texts, transfers and bigger amounts still ask.`;

  return (
    <div className="pf-catching">
      {supported && (
        <div className={`pf-status ${statusTone}`}>
          <span className="pf-status-mark">{stopped ? <Zap size={20} /> : <MessageSquareText size={20} />}</span>
          <span className="pf-row-text">
            <span className="pf-status-title">{health.headline}</span>
            {/* The subtitle is the health verdict, not a restatement of the
                switch: a listener Android has killed still reports
                "capturing", so "On" would be a lie in exactly the case the
                user most needs to be told about. */}
            <span className="pf-status-sub">{health.detail}</span>
          </span>
        </div>
      )}

      <div className="pf-list">
        {supported ? (
          <SettingsRow
            icon={<MessageSquareText />}
            title="Payment alerts"
            sub="Reads the notifications your bank and UPI apps show"
            action={stopped ? (
              <button type="button" className="pf-mini is-primary" disabled={settings.isReconnecting} onClick={() => void settings.reconnect()}>
                {settings.isReconnecting ? <span className="pf-spin" /> : null}
                {settings.isReconnecting ? 'Reconnecting' : 'Reconnect'}
              </button>
            ) : (
              <button type="button" className={`pf-mini${capturing ? '' : ' is-primary'}`} onClick={onOpenInbox}>
                {capturing ? 'Manage' : 'Set up'}
              </button>
            )}
          />
        ) : (
          <SettingsRow
            icon={<MessageSquareText />}
            title="Payment alerts"
            sub="Reading payment alerts needs the Android app."
          />
        )}

        {/* What stops the listener dying in the first place. Shown only while
            capture is wanted and permitted, and directly under it, so "it
            stopped" and "here is what stops that" sit together. */}
        {supported && capturing && health.needsBatteryExemption && (
          <SettingsRow
            tone="warn"
            icon={<BatteryWarning />}
            title="Keep it running in the background"
            sub={capture.manufacturer === 'samsung'
              ? 'Samsung puts apps to sleep after a few days unopened, and a sleeping app notices nothing. Allow this, then add MONEVA to Never sleeping apps under Battery.'
              : 'Android can stop MONEVA to save battery, and a stopped app notices nothing. Allowing this keeps the listener alive.'}
            action={(
              <button type="button" className="pf-mini is-primary" onClick={() => void settings.requestBatteryExemption()}>
                Allow
              </button>
            )}
          />
        )}

        {/* The other half of capture: banks that text and show nothing. */}
        <SmsCaptureSection onCaptured={onOpenInbox} onReadPrivacy={onReadPrivacy} />

        {/* Only offered while capture actually works; a switch with no effect
            would let somebody believe payments were handled when none were seen. */}
        {supported && capturing && (
          <SwitchRow
            title="Add payments without asking"
            sub={autoSub}
            checked={autoAdd.enabled}
            onChange={settings.setAutoAddEnabled}
          />
        )}
      </div>

      <div className="pf-list">
        <SettingsRow
          icon={<BellRing />}
          title="Notifications on this phone"
          sub={devicePerm === 'granted'
            ? 'On, even when the app is closed.'
            : devicePerm === 'denied'
              ? 'Blocked in Android settings.'
              : 'Off. Nothing will remind you.'}
          action={devicePerm === 'granted' ? undefined : (
            <button type="button" className="pf-mini is-primary" disabled={settings.isEnablingPerm} onClick={() => void settings.enableNotifications()}>
              {settings.isEnablingPerm ? <span className="pf-spin" /> : null}
              Turn on
            </button>
          )}
        />
      </div>

      <button type="button" className="pf-link" onClick={onReadPrivacy}>
        What happens to your messages
      </button>
    </div>
  );
};
