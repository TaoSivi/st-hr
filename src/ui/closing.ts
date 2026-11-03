import { useCallback, useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from './press';

/** How long a closing animation is given before the thing is really removed (nothing waits for people who asked for reduced motion). */
export const closeDelayMs = (ms: number, reduced: boolean) => (reduced ? 0 : ms);

/**
 * For sheets and full-screen views: `close()` plays the closing animation (add the `closing` class while it runs),
 * then calls `onClose`. Calling it twice, or unmounting in between, never closes twice.
 */
export function useClosing(onClose: () => void, ms = 260) {
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const latest = useRef(onClose);
  latest.current = onClose;
  useEffect(() => () => clearTimeout(timer.current), []);
  const close = useCallback(() => {
    if (timer.current) return;
    setClosing(true);
    timer.current = setTimeout(() => latest.current(), closeDelayMs(ms, prefersReducedMotion()));
  }, [ms]);
  return { closing, close };
}
