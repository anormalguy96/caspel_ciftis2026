import { useEffect, useRef, useState } from 'react';

function exitDuration(fallback: number) {
  if (typeof window === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--dur-exit')
    .trim();
  if (!raw) return fallback;
  const n = parseFloat(raw);
  if (Number.isNaN(n)) return fallback;
  return raw.endsWith('ms') ? n : n * 1000;
}

/**
 * Keeps a dialog mounted for the length of its exit animation.
 *
 * `'open'` is derived during render rather than set from an effect. When it was
 * effect-driven, the first render after isOpen flipped true still returned null,
 * so the panel was not in the DOM yet — and every other effect that needs the
 * panel (focus management, in particular) ran against a null ref and did
 * nothing. Returning 'open' synchronously means the panel exists by the time
 * sibling effects run.
 */
export function useExitTransition(isOpen: boolean, fallbackMs = 180) {
  const [isExiting, setIsExiting] = useState(false);
  const hasOpened = useRef(isOpen);

  useEffect(() => {
    if (isOpen) {
      hasOpened.current = true;
      setIsExiting(false);
      return;
    }

    // Never animate an exit for a dialog that was never open.
    if (!hasOpened.current) return;

    setIsExiting(true);
    const timer = window.setTimeout(() => {
      setIsExiting(false);
      hasOpened.current = false;
    }, exitDuration(fallbackMs));

    return () => window.clearTimeout(timer);
  }, [isOpen, fallbackMs]);

  if (isOpen) return 'open' as const;
  return isExiting ? ('closing' as const) : null;
}
