import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { ChatSource } from '../types';
import { renderPresentationThumbnail } from '../services/slideThumbnail';

/**
 * One grounded citation: a readable reference, a deep link to the exact cited
 * page, and a thumbnail of that page rendered from the same verified stream
 * the viewer uses.
 *
 * Everything here is built from server-owned fields. The route is assembled
 * from the registry slug and page the API returned, never from a URL the model
 * wrote -- a model-authored link is the one thing a grounded citation must not
 * contain. The server also guarantees the slug is registered and the page is
 * inside the real document, so a link from here cannot point at a missing
 * document or past the end of one.
 *
 * The canvas is decorative. The accessible name comes from the visible
 * document title and page number, so a screen reader announces
 * "CASPEL Corporate Presentation, page 7" rather than "image".
 */

interface SourceCitationProps {
  source: ChatSource;
  /** Deep link built by the caller, which owns base-path awareness. */
  href: string;
  index: number;
}

/** Rendered at a modest size: this is a hint at the slide, not the slide. */
const THUMB_WIDTH = 220;
const MAX_DPR = 2;

export const SourceCitation: React.FC<SourceCitationProps> = ({ source, href, index }) => {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLLIElement>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');

  const label = t('ai.citationLabel', {
    document: source.document,
    page: source.page,
    defaultValue: `${source.document}, page ${source.page}`,
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !source.slug) return undefined;

    // Nothing is fetched until the citation is actually near the viewport. An
    // answer can carry several sources, and each one otherwise starts its own
    // range request for a 24 MiB document the visitor may never look at.
    const controller = new AbortController();
    let cancelled = false;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        setState('loading');

        renderPresentationThumbnail({
          slug: source.slug as string,
          page: source.page,
          canvas: canvasRef.current,
          width: THUMB_WIDTH,
          maxDpr: MAX_DPR,
          signal: controller.signal,
        })
          .then(() => {
            if (!cancelled) setState('ready');
          })
          .catch(() => {
            if (!cancelled) setState('failed');
          });
      },
      { rootMargin: '200px' }
    );

    observer.observe(host);
    return () => {
      cancelled = true;
      observer.disconnect();
      controller.abort();
    };
  }, [source.slug, source.page]);

  return (
    <li ref={hostRef} className="chat__source" data-state={state}>
      <Link
        className="chat__source-link"
        to={href}
        data-testid={`citation-link-${index}`}
        aria-label={label}
      >
        {/* lang="en" because the document title is the approved filename's
            title and is not translated, even when the answer is not English. */}
        <cite className="chat__source-doc" lang="en">
          {source.document}
        </cite>
        <span className="chat__source-page">
          {t('ai.pageLabel', { page: source.page, defaultValue: `page ${source.page}` })}
        </span>
      </Link>

      {source.slug && (
        <Link
          className="chat__source-figure"
          to={href}
          tabIndex={-1}
          aria-hidden="true"
          data-testid={`citation-thumb-${index}`}
        >
          <canvas ref={canvasRef} className="chat__source-canvas" />
          {state !== 'ready' && (
            <span className="chat__source-thumbstate" data-testid={`citation-thumbstate-${index}`}>
              {state === 'failed'
                ? t('ai.slidePreviewUnavailable', { defaultValue: 'Preview unavailable' })
                : null}
            </span>
          )}
        </Link>
      )}
    </li>
  );
};
