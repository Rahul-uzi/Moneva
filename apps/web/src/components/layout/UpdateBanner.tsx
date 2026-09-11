/**
 * "There is a newer MONEVA."
 *
 * A bar, not a dialog. An update is news, not an interruption - blocking the
 * screen to announce one on an app somebody opened to check a balance is how
 * an update prompt becomes the thing people learn to dismiss without reading.
 * The exception is a release marked mandatory, which is the one case where
 * carrying on with the old build is the worse outcome.
 *
 * It cannot install anything. Android does not let a web view install an APK,
 * and should not: the link opens the download, and the person installs it
 * themselves, deliberately.
 */

import React from 'react';
import { ArrowUpCircle, X } from 'lucide-react';
import type { UpdateNews } from '../../services/updateCheck';
import './UpdateBanner.css';

interface Props {
  news: UpdateNews;
  onDismiss: () => void;
}

export const UpdateBanner: React.FC<Props> = ({ news, onDismiss }) => {
  const { latest } = news;

  return (
    <div
      className={`update-banner${latest.mandatory ? ' is-required' : ''}`}
      role="status"
    >
      <ArrowUpCircle size={16} className="update-banner-icon" />

      <div className="update-banner-copy">
        <strong>
          {latest.mandatory ? 'Update required' : `MONEVA ${latest.version_name} is out`}
        </strong>
        {/* What changed, when there is something to say. A prompt that only
            says "an update is available" gives nobody a reason to take it. */}
        {latest.notes && <span>{latest.notes}</span>}
      </div>

      {/* No link when the server has no URL for the file. Offering a button
          that goes nowhere is worse than not mentioning the update: it makes
          the app look broken rather than merely out of date. */}
      {latest.download_url && (
        <a
          className="update-banner-action"
          href={latest.download_url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Get it
        </a>
      )}

      {/* A required update has no dismiss. Everything else does - somebody on
          a train has not decided never to update, and it asks again in a few
          days rather than on every launch. */}
      {!latest.mandatory && (
        <button
          type="button"
          className="update-banner-close"
          aria-label="Not now"
          onClick={onDismiss}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
};

export default UpdateBanner;
