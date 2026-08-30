import { flushSync } from 'react-dom';
import type { NavigateFunction, NavigateOptions, To } from 'react-router-dom';

/**
 * Executes a client-side navigation using the native View Transitions API
 * when supported, with immediate fallback for unsupported environments or
 * when prefers-reduced-motion is active.
 *
 * Designed to work with BrowserRouter without requiring router migration.
 */
export function transitionNavigate(
  navigate: NavigateFunction,
  to: To | number,
  options?: NavigateOptions
): void {
  const prefersReduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  if (
    prefersReduced ||
    typeof document === 'undefined' ||
    !('startViewTransition' in document) ||
    typeof (document as unknown as { startViewTransition: unknown }).startViewTransition !== 'function'
  ) {
    if (typeof to === 'number') {
      navigate(to);
    } else {
      navigate(to, options);
    }
    return;
  }

  try {
    (
      document as unknown as {
        startViewTransition: (callback: () => void) => { finished: Promise<void> };
      }
    ).startViewTransition(() => {
      flushSync(() => {
        if (typeof to === 'number') {
          navigate(to);
        } else {
          navigate(to, options);
        }
      });
    });
  } catch {
    // Failure in View Transition setup must never block navigation
    if (typeof to === 'number') {
      navigate(to);
    } else {
      navigate(to, options);
    }
  }
}
