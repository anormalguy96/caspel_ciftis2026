import React, { useState, useEffect, useRef, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Smartphone, X } from 'lucide-react';
import { trackAnalyticsEvent } from '../services/analytics';
import { useTranslation } from 'react-i18next';
import { useModalA11y } from '../hooks/useModalA11y';
import { PUBLIC_URL } from '../config/paths';
import caspelVideo from '../assets/caspel.mp4';

/**
 * Page A — the exhibition display.
 *
 * Runs unattended on a tablet or touch screen at the CASPEL stand: a silent
 * looping film that hands the visitor off to Page B by QR code on tap.
 *
 * Three failure modes matter more here than anywhere else in the product,
 * because nobody is watching the screen when they happen:
 *
 *   · autoplay refused  — browsers block it in some kiosk configurations, so
 *     the screen offers an explicit touch-to-start rather than going black;
 *   · video unavailable — the QR and the address are shown directly, because a
 *     media error must never cost CASPEL the handoff the stand exists for;
 *   · nobody dismisses  — the overlay retires by itself so the next visitor in
 *     the queue finds the film running, not a stale panel.
 *
 * The QR encodes the build's own public address and nothing else: no visitor
 * data, no session, no expiry. It is deliberately NOT derived from
 * window.location, which on this route would encode /display and send every
 * visitor to the kiosk page instead of the mobile hub.
 */

const RESET_TIMEOUT_SECONDS = parseInt(import.meta.env.VITE_DISPLAY_RESET_SECONDS || '25', 10);

/** Page B, as baked in at build time. Never the current URL. */
const PAGE_B_URL = PUBLIC_URL;

/** Shown under the QR so a visitor can type it if scanning fails. */
const PAGE_B_LABEL = PAGE_B_URL.replace(/^https?:\/\//, '');

type VideoState = 'playing' | 'blocked' | 'failed';

export const DisplayPage: React.FC = () => {
  const { t } = useTranslation();
  const [isQrRevealed, setIsQrRevealed] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(RESET_TIMEOUT_SECONDS);
  const [videoState, setVideoState] = useState<VideoState>('playing');
  const videoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    trackAnalyticsEvent('DISPLAY_LOOP_VIEW');
  }, []);

  // Autoplay is requested through the attribute AND explicitly here: Safari on
  // iPadOS honours muted autoplay, but a kiosk profile can still refuse it, and
  // the returned promise is the only way to find out.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const attempt = video.play();
    if (attempt && typeof attempt.catch === 'function') {
      attempt.catch(() => setVideoState((s) => (s === 'failed' ? s : 'blocked')));
    }
  }, []);

  const openQr = useCallback(() => {
    videoRef.current?.pause();
    trackAnalyticsEvent('DISPLAY_TAP');
    trackAnalyticsEvent('QR_REVEAL');
    setIsQrRevealed(true);
  }, []);

  const dismiss = useCallback(() => {
    setIsQrRevealed(false);
    const video = videoRef.current;
    if (!video) return;
    const attempt = video.play();
    if (attempt && typeof attempt.catch === 'function') {
      attempt.catch(() => setVideoState((s) => (s === 'failed' ? s : 'blocked')));
    }
  }, []);

  const handleSurfaceActivate = useCallback(() => {
    if (isQrRevealed) return;
    // A blocked autoplay turns the first tap into "start the film"; the QR is
    // one tap away after that, which is the normal flow again.
    if (videoState === 'blocked') {
      const video = videoRef.current;
      const attempt = video?.play();
      if (attempt && typeof attempt.catch === 'function') {
        attempt.then(() => setVideoState('playing')).catch(() => undefined);
      } else {
        setVideoState('playing');
      }
      return;
    }
    openQr();
  }, [isQrRevealed, videoState, openQr]);

  // Retire the overlay on its own so an abandoned tap does not hold the screen
  // for the next visitor in the queue.
  useEffect(() => {
    if (!isQrRevealed) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    setSecondsRemaining(RESET_TIMEOUT_SECONDS);
    timerRef.current = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          dismiss();
          return RESET_TIMEOUT_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isQrRevealed, dismiss]);

  const handleDismissClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    dismiss();
  };

  // Escape, focus trap, focus restoration, scroll lock.
  const qrPanelRef = useModalA11y<HTMLDivElement>(isQrRevealed, dismiss);

  const videoUnavailable = videoState === 'failed';

  const qrBlock = (
    <>
      {/* data-qr-value mirrors the encoded target onto the DOM so the handoff
          destination is assertable and inspectable; the QR component consumes
          `value` itself and does not surface it. */}
      <div className="kiosk__qr">
        <QRCodeSVG
          value={PAGE_B_URL}
          data-qr-value={PAGE_B_URL}
          size={260}
          bgColor="#ffffff"
          fgColor="#04222f"
          level="Q"
          marginSize={4}
          data-testid="kiosk-qr"
        />
      </div>
      <p className="kiosk__url" data-testid="kiosk-url">{PAGE_B_LABEL}</p>
    </>
  );

  return (
    <div
      className="kiosk"
      onClick={handleSurfaceActivate}
      data-video-state={videoState}
    >
      {!videoUnavailable && (
        <video
          ref={videoRef}
          className="kiosk__video"
          data-testid="kiosk-video"
          src={caspelVideo}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          // The film is silent and decorative; the handoff it supports is
          // described by the overlay, so it carries no accessible name.
          aria-hidden="true"
          onError={() => setVideoState('failed')}
          onPlaying={() => setVideoState('playing')}
        />
      )}

      {/* Autoplay refused: say so, rather than presenting a black screen. */}
      {videoState === 'blocked' && !isQrRevealed && (
        <div className="kiosk__notice" data-testid="kiosk-touch-to-start">
          <p className="kiosk__prompt">
            <Smartphone size={22} aria-hidden="true" />
            <span>{t('kiosk.touchToStart')}</span>
          </p>
        </div>
      )}

      {/* Video unavailable: the stand still gets its handoff. */}
      {videoUnavailable && (
        <div className="kiosk__fallback" data-testid="kiosk-video-fallback">
          <h1 className="kiosk__title">{t('kiosk.fallbackTitle')}</h1>
          <p className="kiosk__subtitle">{t('kiosk.instruction')}</p>
          {qrBlock}
        </div>
      )}

      {!videoUnavailable && !isQrRevealed && videoState === 'playing' && (
        <p className="kiosk__prompt kiosk__prompt--floating">
          <Smartphone size={22} aria-hidden="true" />
          <span>{t('kiosk.tapPrompt')}</span>
        </p>
      )}

      {isQrRevealed && (
        <div className="kiosk__overlay u-backdrop" onClick={handleDismissClick}>
          <div
            ref={qrPanelRef}
            tabIndex={-1}
            className="kiosk__card u-qr-enter"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="kiosk-qr-title"
          >
            <div className="kiosk__card-head">
              <h2 className="kiosk__card-title" id="kiosk-qr-title">
                {t('kiosk.scanTitle')}
              </h2>
              <button
                type="button"
                className="kiosk__close"
                onClick={handleDismissClick}
                aria-label={t('actions.close')}
              >
                <X size={26} aria-hidden="true" />
              </button>
            </div>

            {qrBlock}

            <p className="kiosk__instruction">{t('kiosk.instruction')}</p>
            <p className="kiosk__countdown" aria-live="off">
              {t('kiosk.returning').replace('{seconds}', String(secondsRemaining))}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
