import React from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { Button } from '../ui/Button';
import { Illustration } from '../ui/Illustration';
import type { IllustrationName } from '../ui/Illustration';
import './OnboardingTutorial.css';

interface Slide {
  art: IllustrationName;
  title: string;
  body: string;
  /**
   * The opening slide is the brand itself: the mark draws itself in and the
   * wordmark completes the lockup beneath it. A drawing of the mark under a
   * heading reading "Welcome to MONEVA" said the same thing twice.
   */
  brand?: boolean;
}

const SLIDES: Slide[] = [
  {
    art: 'welcome',
    title: 'MONEVA',
    brand: true,
    body: 'Your money in one clear picture. Here is a quick tour — it takes about twenty seconds.',
  },
  {
    art: 'add',
    title: 'Record it in seconds',
    body: 'Tap the + button on any screen to log an expense, income, or transfer. Every amount is stored to the exact paisa.',
  },
  {
    art: 'goal',
    title: 'Set budgets and goals',
    body: 'Open Plan to cap a category, build a savings goal, and watch progress fill as you go.',
  },
  {
    art: 'calendar',
    title: 'Never miss a bill',
    body: 'Add your recurring bills once. MONEVA reminds you before each due date and records the payment when you pay.',
  },
  {
    art: 'secure',
    title: 'Lock it down',
    body: 'Turn on the biometric app lock in Profile → Security, and MONEVA will ask for your fingerprint or face every time it opens.',
  },
];

interface Props {
  onFinish: () => void;
}

export const OnboardingTutorial: React.FC<Props> = ({ onFinish }) => {
  const [index, setIndex] = React.useState(0);
  // 1 when moving forward, -1 when moving back, so the slide animates the right way.
  const [direction, setDirection] = React.useState(1);
  const touchStartX = React.useRef<number | null>(null);

  const isLast = index === SLIDES.length - 1;

  const goTo = React.useCallback((next: number) => {
    if (next < 0 || next >= SLIDES.length) return;
    setDirection(next > index ? 1 : -1);
    setIndex(next);
  }, [index]);

  const handleNext = () => (isLast ? onFinish() : goTo(index + 1));

  // Swipe between slides, the way a phone user expects to move through a tour.
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) < 45) return;
    goTo(delta < 0 ? index + 1 : index - 1);
  };

  // Arrow keys for anyone running this in a browser.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goTo(index + 1);
      if (e.key === 'ArrowLeft') goTo(index - 1);
      if (e.key === 'Escape') onFinish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, goTo, onFinish]);

  const slide = SLIDES[index];

  return (
    <div
      className="onboarding-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="MONEVA tutorial"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="onboarding-card">
        <button type="button" className="onboarding-skip" onClick={onFinish}>
          Skip
        </button>

        {/* Keying on index remounts the slide so its animations replay each time. */}
        <div
          key={index}
          className={direction > 0 ? 'onboarding-slide slide-from-right' : 'onboarding-slide slide-from-left'}
        >
          <Illustration name={slide.art} size={230} />
          {/* Still a heading, so it is announced and outlined like one - the
              word is the wordmark, it is only set as one. */}
          <h2
            className={
              slide.brand
                ? 'onboarding-title onboarding-wordmark'
                : 'heading-lg onboarding-title'
            }
          >
            {slide.title}
          </h2>
          <p className="text-body onboarding-body">{slide.body}</p>
        </div>

        <div className="onboarding-dots" role="tablist" aria-label="Tutorial progress">
          {SLIDES.map((s, i) => (
            <button
              key={s.art}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Step ${i + 1}: ${s.title}`}
              className={i === index ? 'onboarding-dot is-active' : 'onboarding-dot'}
              onClick={() => goTo(i)}
            />
          ))}
        </div>

        <div className="onboarding-actions">
          <Button variant="primary" fullWidth onClick={handleNext}>
            {isLast ? (
              <>
                <Check size={16} />
                Start using MONEVA
              </>
            ) : (
              <>
                Next
                <ArrowRight size={16} />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default OnboardingTutorial;
