import React, { useState, useEffect, useRef, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Smartphone, X } from 'lucide-react';
import { trackAnalyticsEvent } from '../services/analytics';
import en from '../locales/en.json';
import { useModalA11y } from '../hooks/useModalA11y';
import caspelLogo from '../assets/caspel-logo-horizontal.svg';
import { PUBLIC_URL } from '../config/paths';

/**
 * Booth display.
 *
 * Runs unattended on the screen at the CASPEL stand: an idle panel that reveals
 * the QR code on tap and returns to rest by itself. Deliberately still — a
 * looping animation on a screen nobody is touching is just noise on the stand.
 */

const RESET_TIMEOUT_SECONDS = parseInt(import.meta.env.VITE_DISPLAY_RESET_SECONDS || '25', 10);

// The QR target is the build's own public address. Never derived from
// window.location: a bundle that guessed its own URL would print a different
// code depending on how the operator happened to open the kiosk page.
const PUBLIC_CIFTIS_URL = PUBLIC_URL;

export const DisplayPage: React.FC = () => {
  const [isQrRevealed, setIsQrRevealed] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(RESET_TIMEOUT_SECONDS);
  // ReturnType keeps this correct in both DOM and Node typings.
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    trackAnalyticsEvent('DISPLAY_LOOP_VIEW');
  }, []);

  useEffect(() => {
    if (!isQrRevealed) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    setSecondsRemaining(RESET_TIMEOUT_SECONDS);

    timerRef.current = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          setIsQrRevealed(false);
          return RESET_TIMEOUT_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isQrRevealed]);

  const handleScreenTap = () => {
    if (isQrRevealed) return;
    trackAnalyticsEvent('DISPLAY_TAP');
    trackAnalyticsEvent('QR_REVEAL');
    setIsQrRevealed(true);
  };

  const dismiss = useCallback(() => setIsQrRevealed(false), []);

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    dismiss();
  };

  const qrPanelRef = useModalA11y<HTMLDivElement>(isQrRevealed, dismiss);

  return (
    <div className="kiosk" onClick={handleScreenTap}>
      <div className="kiosk__stage">
        <header className="kiosk__header">
          <img src={caspelLogo} alt="CASPEL" className="kiosk__logo" />
          <p className="kiosk__eyebrow">CIFTIS 2026 · Beijing</p>
        </header>

        <div className="kiosk__center">
          <h1 className="kiosk__title">Enterprise Technology Solutions</h1>
          <p className="kiosk__subtitle">
            Caspel ERP · Procurement Management · IRISSEA LRIT
          </p>

          <p className="kiosk__prompt">
            <Smartphone size={22} aria-hidden="true" />
            <span>{en.kiosk.tapPrompt}</span>
          </p>
        </div>
      </div>

      {isQrRevealed && (
        <div className="kiosk__overlay u-backdrop" onClick={handleDismiss}>
          <div
            ref={qrPanelRef}
            tabIndex={-1}
            className="kiosk__card u-panel"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="kiosk-qr-title"
          >
            <div className="kiosk__card-head">
              <h2 className="kiosk__card-title" id="kiosk-qr-title">
                Scan to explore
              </h2>
              <button
                type="button"
                className="modal__close"
                onClick={handleDismiss}
                aria-label={en.actions.close}
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            <div className="kiosk__qr">
              <QRCodeSVG
                value={PUBLIC_CIFTIS_URL}
                size={220}
                bgColor="#ffffff"
                fgColor="#04222f"
                level="Q"
                marginSize={2}
              />
            </div>

            <p className="kiosk__instruction">{en.kiosk.instruction}</p>
            <p className="kiosk__countdown" aria-live="off">
              Returning to the welcome screen in {secondsRemaining}s
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
