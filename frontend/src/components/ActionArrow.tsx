import React from 'react';

/**
 * The one arrow in the product.
 *
 * The variant is chosen by what the control actually does, never by how its
 * label reads. Before this existed the rule was inverted in five of six
 * places: two in-product modals ("Ask a question", "Request a Demo") carried
 * the leaves-the-site arrow, while two `mailto:` links — which genuinely do
 * leave — carried the stays-here arrow. A visitor learns that distinction in
 * about three seconds and then trusts it, so getting it backwards is worse
 * than having no arrows at all.
 *
 *   internal — an in-product route, modal or action
 *   external — a website, LinkedIn, or a mailto: that hands off to a mail client
 *
 * Decorative only: `aria-hidden` plus `focusable="false"` keeps it out of the
 * accessibility tree and out of the tab order in IE-era engines, and the
 * accessible name keeps coming from the control's own text. The arrow is
 * never the only signal that a link is external — the labels say "caspel.com",
 * "LinkedIn" and the address itself.
 */

export type ArrowDirection = 'internal' | 'external';

interface ActionArrowProps {
  direction: ArrowDirection;
  /** `sm` for inline text runs, `md` for buttons and rows. */
  size?: 'sm' | 'md';
  className?: string;
}

export const ActionArrow: React.FC<ActionArrowProps> = ({
  direction,
  size = 'md',
  className,
}) => (
  <svg
    className={`action-arrow action-arrow--${size}${className ? ` ${className}` : ''}`}
    viewBox="0 0 16 16"
    aria-hidden="true"
    focusable="false"
    role="presentation"
  >
    {direction === 'external' ? (
      // Up and to the right: the page you are on is being left behind.
      <>
        <path d="M5.5 10.5 10.5 5.5" />
        <path d="M6.25 5.5h4.25v4.25" />
      </>
    ) : (
      // Straight ahead: you stay inside the experience.
      <>
        <path d="M3 8h9.5" />
        <path d="M8.75 4.25 12.5 8l-3.75 3.75" />
      </>
    )}
  </svg>
);
