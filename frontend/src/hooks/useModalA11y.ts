import { useEffect, useRef } from 'react';

/**
 * Dialog behaviour a keyboard or screen-reader visitor needs.
 *
 * A `role="dialog"` element is only a dialog if it also behaves like one:
 * Escape closes it, focus moves into it, Tab cannot walk out of it into the
 * page behind, focus returns to whatever opened it, and the page underneath
 * stops scrolling. Without these, a visitor tabbing through the booth site on
 * a phone keyboard ends up interacting with a page they cannot see.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableItems(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement
  );
}

/**
 * Returns a ref to attach to the dialog panel. The panel must carry
 * `tabIndex={-1}` so it can hold focus when it contains no focusable child.
 *
 * Mark the element that should receive focus on open with `data-autofocus`;
 * otherwise the first focusable child is used, then the panel itself.
 */
export function useModalA11y<T extends HTMLElement = HTMLDivElement>(
  isOpen: boolean,
  onClose: () => void
) {
  const panelRef = useRef<T>(null);

  // Parents pass an inline arrow, so onClose changes identity every render.
  // Reading it through a ref keeps the effect keyed on `isOpen` alone —
  // otherwise focus would be restored and re-stolen on every keystroke.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // ── Body scroll lock. Compensate for the scrollbar so the page behind
    //    does not visibly shift when it disappears.
    const body = document.body;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;

    // ── Initial focus.
    const preferred = panel?.querySelector<HTMLElement>('[data-autofocus]');
    (preferred ?? focusableItems(panel)[0] ?? panel)?.focus();

    // ── Escape to close, Tab trapped inside the panel.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;

      const items = focusableItems(panel);
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      // -1 covers both "focus is outside the panel" and "focus is on the panel
      // itself", which holds it when the dialog opens. Both must be pulled back
      // to an end of the ring rather than left to the browser's tab order.
      const index = items.indexOf(document.activeElement as HTMLElement);

      if (event.shiftKey) {
        if (index <= 0) {
          event.preventDefault();
          last.focus();
        }
      } else if (index === -1 || index === items.length - 1) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
      // Return the visitor to the control they opened the dialog from.
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, [isOpen]);

  return panelRef;
}
