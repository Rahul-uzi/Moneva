import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useScrollLock } from '../ui/useScrollLock';
import './ProfileSheet.css';

interface ProfileSheetProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * The one sheet every Profile setting opens into.
 *
 * A bottom sheet on a phone and a centred dialog from tablet width up. It
 * stays mounted for the length of its closing animation, so it slides away
 * instead of vanishing.
 *
 * Android's Back closes it. The shell answers Back by going back in history,
 * so the sheet adds a history entry of its own when it opens: Back then lands
 * on Profile with the sheet closed, rather than leaving Profile altogether.
 */
export const ProfileSheet: React.FC<ProfileSheetProps> = ({ isOpen, title, onClose, children }) => {
  useScrollLock(isOpen);

  // Adjusted during render rather than in an effect: the closing state is a
  // direct consequence of `isOpen` turning false.
  const [wasOpen, setWasOpen] = useState(isOpen);
  const [closing, setClosing] = useState(false);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    setClosing(!isOpen);
  }
  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(() => setClosing(false), 280);
    return () => clearTimeout(t);
  }, [closing]);

  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    window.history.pushState({ profileSheet: true }, '');
    let closedByBack = false;
    const onPop = () => {
      // Still on a sheet entry (a reopened sheet pushed another): not ours to close.
      if ((window.history.state as { profileSheet?: boolean } | null)?.profileSheet) return;
      closedByBack = true;
      onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey);
      if (!closedByBack && (window.history.state as { profileSheet?: boolean } | null)?.profileSheet) {
        window.history.back();
      }
    };
  }, [isOpen]);

  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(() => {
      const first = panelRef.current?.querySelector<HTMLElement>('[data-autofocus]');
      (first ?? panelRef.current)?.focus({ preventScroll: true });
    }, 320);
    return () => clearTimeout(t);
  }, [isOpen]);

  if (!isOpen && !closing) return null;

  return (
    <div className={`pf-sheet-layer${closing ? ' is-closing' : ''}`}>
      <div className="pf-sheet-shade" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className="pf-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="pf-sheet-grab" aria-hidden="true" />
        <div className="pf-sheet-head">
          <h2 className="pf-sheet-title">{title}</h2>
          <button type="button" className="pf-sheet-x" onClick={onClose} aria-label="Close">
            <X size={16} strokeWidth={2.4} />
          </button>
        </div>
        <div className="pf-sheet-body">{children}</div>
      </div>
    </div>
  );
};
