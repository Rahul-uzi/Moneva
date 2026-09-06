import React from 'react';
import { useApiWaking } from '../../hooks/useApiWaking';
import { useUiStore } from '../../stores/useUiStore';
import './Skeleton.css';

/**
 * Placeholders in the shape of the page that is coming.
 *
 * A spinner says "wait" and nothing else; every screen looked identical while
 * loading and the wait felt longer than it was. These stand in for the real
 * cards at the real sizes, so the layout is already settled when the data
 * lands and nothing jumps.
 *
 * Marked aria-busy and hidden from screen readers - there is nothing here to
 * read out, and announcing a dozen empty boxes helps nobody.
 */
export const Skeleton: React.FC<{
  width?: number | string;
  height?: number | string;
  radius?: number;
  className?: string;
}> = ({ width = '100%', height = 12, radius = 6, className = '' }) => (
  <span className={`sk ${className}`} style={{ width, height, borderRadius: radius }} />
);

/**
 * Explains an unusually long wait, and only then.
 *
 * The server sleeps when nobody has used the app for a while, and the first
 * request has to wait for it to start. Without this the screen just sits
 * there, so people assume it has hung. A phone with no signal gets the true
 * reason instead - blaming the server for the user's tunnel would be a lie
 * they can immediately catch.
 */
export const ServerWakingNotice: React.FC = () => {
  const waking = useApiWaking();
  const isOnline = useUiStore((s) => s.isOnline);
  if (!waking) return null;
  return (
    <div className="sk-waking" role="status">
      <span className="sk-waking-pulse" aria-hidden="true" />
      <span>
        {isOnline
          ? 'Starting the server. The first open after a quiet spell takes a few seconds.'
          : 'Waiting for a connection. This finishes loading as soon as you are back online.'}
      </span>
    </div>
  );
};

const Page: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="sk-page" aria-busy="true" aria-label={label}>
    <ServerWakingNotice />
    <div className="sk-body" aria-hidden="true">
      {children}
    </div>
  </div>
);

const TitleRow = () => (
  <div className="sk-title-row">
    <Skeleton width={112} height={15} />
    <Skeleton width={54} height={10} />
  </div>
);

const ListRow = ({ tall = false }: { tall?: boolean }) => (
  <div className={`sk-card sk-list-row ${tall ? 'is-tall' : ''}`}>
    <Skeleton width={34} height={34} radius={11} />
    <span className="sk-list-lines">
      <Skeleton width="58%" height={11} />
      <Skeleton width="34%" height={9} />
    </span>
    <Skeleton width={62} height={13} />
  </div>
);

/** Net worth, salary, the accounts strip, then bills. */
export const HomeSkeleton: React.FC = () => (
  <Page label="Loading your dashboard">
    <div className="sk-card sk-hero">
      <Skeleton width={104} height={9} />
      <Skeleton width="66%" height={30} radius={8} />
      <span className="sk-divider" />
      <div className="sk-split">
        <span className="sk-col">
          <Skeleton width={52} height={8} />
          <Skeleton width={84} height={15} />
        </span>
        <span className="sk-col">
          <Skeleton width={52} height={8} />
          <Skeleton width={84} height={15} />
        </span>
      </div>
    </div>

    <div className="sk-card sk-salary">
      <div className="sk-split">
        <Skeleton width={128} height={13} />
        <Skeleton width={58} height={18} radius={9} />
      </div>
      <Skeleton height={6} radius={3} />
      <div className="sk-split">
        <Skeleton width={78} height={10} />
        <Skeleton width={92} height={13} />
      </div>
    </div>

    <TitleRow />
    <div className="sk-account-row">
      <div className="sk-card sk-account">
        <Skeleton width={30} height={30} radius={999} />
        <Skeleton width="62%" height={11} />
        <Skeleton width="82%" height={17} />
      </div>
      <div className="sk-card sk-account">
        <Skeleton width={30} height={30} radius={999} />
        <Skeleton width="62%" height={11} />
        <Skeleton width="82%" height={17} />
      </div>
    </div>

    <TitleRow />
    <ListRow tall />
    <ListRow tall />
  </Page>
);

/** Heading and period chip, the four filter tabs, search, totals, then rows. */
export const ActivitySkeleton: React.FC = () => (
  <Page label="Loading your activity">
    <div className="sk-split">
      <Skeleton width={144} height={22} radius={7} />
      <Skeleton width={92} height={28} radius={999} />
    </div>

    <div className="sk-tabs">
      <Skeleton width={62} height={32} radius={999} />
      <Skeleton width={78} height={32} radius={999} />
      <Skeleton width={70} height={32} radius={999} />
      <Skeleton width={80} height={32} radius={999} />
    </div>

    <Skeleton height={38} radius={12} />

    <div className="sk-card sk-metrics">
      <span className="sk-col"><Skeleton width={62} height={8} /><Skeleton width={80} height={16} /></span>
      <span className="sk-col"><Skeleton width={62} height={8} /><Skeleton width={80} height={16} /></span>
      <span className="sk-col"><Skeleton width={62} height={8} /><Skeleton width={80} height={16} /></span>
    </div>

    <Skeleton width={104} height={10} />
    <ListRow />
    <ListRow />
    <Skeleton width={88} height={10} />
    <ListRow />
    <ListRow />
  </Page>
);

/** Heading with its three add buttons, the metrics band, then the plan cards. */
export const PlanSkeleton: React.FC = () => (
  <Page label="Loading your plan">
    <div className="sk-split">
      <Skeleton width={82} height={22} radius={7} />
      <span className="sk-tabs">
        <Skeleton width={70} height={28} radius={999} />
        <Skeleton width={62} height={28} radius={999} />
        <Skeleton width={58} height={28} radius={999} />
      </span>
    </div>

    <div className="sk-card sk-metrics">
      <span className="sk-col">
        <Skeleton width={58} height={9} />
        <Skeleton width={72} height={18} />
        <Skeleton width={46} height={8} />
        <Skeleton height={5} radius={3} />
      </span>
      <span className="sk-col">
        <Skeleton width={58} height={9} />
        <Skeleton width={72} height={18} />
        <Skeleton width={46} height={8} />
        <Skeleton height={5} radius={3} />
      </span>
      <span className="sk-col">
        <Skeleton width={58} height={9} />
        <Skeleton width={72} height={18} />
        <Skeleton width={46} height={8} />
        <Skeleton height={5} radius={3} />
      </span>
    </div>

    <TitleRow />
    <ListRow tall />
    <ListRow tall />
    <TitleRow />
    <ListRow tall />
  </Page>
);

/** Heading and Add button, the assets band, then a card per account. */
export const AccountsSkeleton: React.FC = () => (
  <Page label="Loading your accounts">
    <div className="sk-split">
      <span className="sk-col">
        <Skeleton width={140} height={22} radius={7} />
        <Skeleton width={98} height={10} />
      </span>
      <Skeleton width={108} height={34} radius={11} />
    </div>

    <div className="sk-card sk-metrics">
      <span className="sk-col"><Skeleton width={66} height={8} /><Skeleton width={78} height={16} /></span>
      <span className="sk-col"><Skeleton width={66} height={8} /><Skeleton width={78} height={16} /></span>
      <span className="sk-col"><Skeleton width={66} height={8} /><Skeleton width={78} height={16} /></span>
    </div>

    <ListRow tall />
    <ListRow tall />
    <ListRow tall />
  </Page>
);

/** Heading, the big chart, then the breakdown blocks. */
export const AnalyticsSkeleton: React.FC = () => (
  <Page label="Loading your analytics">
    <div className="sk-split">
      <Skeleton width={128} height={22} radius={7} />
      <Skeleton width={92} height={28} radius={999} />
    </div>

    <div className="sk-card sk-chart">
      <Skeleton width={116} height={12} />
      <span className="sk-bars">
        <Skeleton width={22} height="46%" radius={5} />
        <Skeleton width={22} height="72%" radius={5} />
        <Skeleton width={22} height="38%" radius={5} />
        <Skeleton width={22} height="88%" radius={5} />
        <Skeleton width={22} height="56%" radius={5} />
        <Skeleton width={22} height="66%" radius={5} />
      </span>
    </div>

    <TitleRow />
    <ListRow />
    <ListRow />
    <ListRow />
  </Page>
);
