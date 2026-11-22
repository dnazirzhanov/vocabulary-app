import { memo, useEffect, useState } from 'react';
import { clock, elapsed, idle, start, stop, type Stopwatch } from '../lib/stopwatch.ts';
import { t } from '../i18n/index.ts';
import styles from './Reading.module.css';

/**
 * Time spent reading this article, counting up from 0:00 when it opens: a little urgency. It holds
 * still while the app is in the background and ends when the reader leaves. Its own component, so
 * the tick each second never re-renders the text.
 */
export const ReadingTimer = memo(function ReadingTimer() {
  const [watch, setWatch] = useState<Stopwatch>(() => start(idle, Date.now()));
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const visibility = () => setWatch((w) => (document.hidden ? stop(w, Date.now()) : start(w, Date.now())));
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);

  const shown = clock(elapsed(watch, now));
  return (
    <span className={styles.timer} role="timer" aria-label={`${t.readingTime}: ${shown}`}>
      <TimerIcon />
      {shown}
    </span>
  );
});

function TimerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      aria-hidden="true"
    >
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 9.5v4l2.5 2M9.5 3h5M12 3v3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
