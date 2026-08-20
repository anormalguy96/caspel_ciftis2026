import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Smartphone, Sparkles, X } from 'lucide-react';
import { trackAnalyticsEvent } from '../services/analytics';
import en from '../locales/en.json';

const RESET_TIMEOUT_SECONDS = parseInt(
  import.meta.env.VITE_DISPLAY_RESET_SECONDS || '25',
  10
);

const PUBLIC_CIFTIS_URL =
  import.meta.env.VITE_PUBLIC_CIFTIS_URL || `${window.location.origin}/ciftis`;

export const DisplayPage: React.FC = () => {
  const [isQrRevealed, setIsQrRevealed] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(RESET_TIMEOUT_SECONDS);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    trackAnalyticsEvent('DISPLAY_LOOP_VIEW');
  }, []);

  // Handle inactivity auto-reset
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
    if (!isQrRevealed) {
      trackAnalyticsEvent('DISPLAY_TAP');
      trackAnalyticsEvent('QR_REVEAL');
      setIsQrRevealed(true);
    }
  };

  const handleDismissOverlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsQrRevealed(false);
  };

  return (
    <div style={styles.kioskContainer} onClick={handleScreenTap}>
      {/* Background High-Tech Animation Canvas / Video Loop */}
      <div style={styles.visualLoop}>
        <div style={styles.glowOrb1}></div>
        <div style={styles.glowOrb2}></div>

        <div style={styles.kioskHeader}>
          <div style={styles.logoBadge}>
            <span style={styles.logoIcon}>C</span>
          </div>
          <div>
            <h1 style={styles.kioskBrand}>CASPEL</h1>
            <p style={styles.kioskTagline}>CIFTIS 2026 • BEIJING</p>
          </div>
        </div>

        <div style={styles.kioskCenterHero}>
          <div style={styles.heroGlowBox}>
            <Sparkles size={32} color="#00c2ff" />
          </div>
          <h2 style={styles.heroMainTitle}>Enterprise Technology Solutions</h2>
          <p style={styles.heroMainSubtitle}>
            ERP • Procurement Management (PMS) • IRISSEA Maritime LRIT
          </p>

          <div style={styles.tapPromptBox}>
            <Smartphone size={24} color="#00c2ff" />
            <span style={styles.tapPromptText}>{en.kiosk.tapPrompt}</span>
          </div>
        </div>
      </div>

      {/* QR Code Reveal Modal / Overlay */}
      {isQrRevealed && (
        <div style={styles.qrOverlay} onClick={handleDismissOverlay}>
          <div
            style={styles.qrCard}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={styles.qrCardHeader}>
              <div style={styles.qrHeaderTitle}>
                <Smartphone size={20} color="var(--color-accent)" />
                <h3 style={styles.qrTitle}>Scan to Explore</h3>
              </div>
              <button
                onClick={handleDismissOverlay}
                style={styles.dismissBtn}
                aria-label="Dismiss QR overlay"
              >
                <X size={20} color="#94a3b8" />
              </button>
            </div>

            <div style={styles.qrBox}>
              <QRCodeSVG
                value={PUBLIC_CIFTIS_URL}
                size={220}
                bgColor="#ffffff"
                fgColor="#070c18"
                level="Q"
                includeMargin={true}
              />
            </div>

            <p style={styles.qrInstruction}>{en.kiosk.instruction}</p>

            <div style={styles.qrFooterBar}>
              <span style={styles.timerBadge}>
                Resetting in {secondsRemaining}s
              </span>
              <span style={styles.urlHint}>{PUBLIC_CIFTIS_URL}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  kioskContainer: {
    width: '100vw',
    height: '100vh',
    position: 'relative',
    backgroundColor: '#040812',
    color: '#ffffff',
    overflow: 'hidden',
    cursor: 'pointer',
    userSelect: 'none',
  },
  visualLoop: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: '40px',
    position: 'relative',
    zIndex: 1,
  },
  glowOrb1: {
    position: 'absolute',
    top: '-10%',
    left: '20%',
    width: '500px',
    height: '500px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(0, 102, 204, 0.25) 0%, rgba(0,0,0,0) 70%)',
    filter: 'blur(50px)',
    pointerEvents: 'none',
  },
  glowOrb2: {
    position: 'absolute',
    bottom: '-10%',
    right: '15%',
    width: '600px',
    height: '600px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(0, 194, 255, 0.2) 0%, rgba(0,0,0,0) 70%)',
    filter: 'blur(60px)',
    pointerEvents: 'none',
  },
  kioskHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  logoBadge: {
    width: '48px',
    height: '48px',
    borderRadius: '12px',
    background: 'var(--color-accent-gradient)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 0 20px rgba(0, 194, 255, 0.4)',
  },
  logoIcon: {
    fontSize: '28px',
    fontWeight: '800',
    color: '#ffffff',
  },
  kioskBrand: {
    fontSize: '24px',
    fontWeight: '800',
    letterSpacing: '2px',
    lineHeight: 1,
  },
  kioskTagline: {
    fontSize: '12px',
    color: 'var(--color-accent)',
    letterSpacing: '1px',
    fontWeight: '600',
    marginTop: '4px',
  },
  kioskCenterHero: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    margin: 'auto 0',
  },
  heroGlowBox: {
    width: '64px',
    height: '64px',
    borderRadius: '18px',
    backgroundColor: 'rgba(0, 194, 255, 0.15)',
    border: '1px solid rgba(0, 194, 255, 0.35)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '20px',
    animation: 'pulseGlow 3s infinite ease-in-out',
  },
  heroMainTitle: {
    fontSize: '38px',
    fontWeight: '800',
    letterSpacing: '-0.5px',
    marginBottom: '12px',
  },
  heroMainSubtitle: {
    fontSize: '18px',
    color: 'var(--color-text-secondary)',
    marginBottom: '36px',
    maxWidth: '650px',
  },
  tapPromptBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '16px 32px',
    borderRadius: 'var(--radius-full)',
    backgroundColor: 'rgba(0, 102, 204, 0.25)',
    border: '1px solid rgba(0, 194, 255, 0.5)',
    boxShadow: '0 0 25px rgba(0, 194, 255, 0.3)',
    animation: 'fadeIn 0.5s ease',
  },
  tapPromptText: {
    fontSize: '16px',
    fontWeight: '800',
    letterSpacing: '1.5px',
    color: '#ffffff',
  },
  qrOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(4, 8, 18, 0.88)',
    backdropFilter: 'blur(16px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
    animation: 'fadeIn 0.25s ease',
  },
  qrCard: {
    backgroundColor: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-lg)',
    padding: '32px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    maxWidth: '420px',
    boxShadow: 'var(--shadow-modal)',
  },
  qrCardHeader: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '20px',
  },
  qrHeaderTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  qrTitle: {
    fontSize: '18px',
    fontWeight: '800',
    color: '#ffffff',
  },
  dismissBtn: {
    padding: '6px',
    borderRadius: '8px',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  qrBox: {
    padding: '16px',
    backgroundColor: '#ffffff',
    borderRadius: 'var(--radius-md)',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
    marginBottom: '20px',
  },
  qrInstruction: {
    fontSize: '14px',
    color: 'var(--color-text-secondary)',
    lineHeight: 1.5,
    marginBottom: '20px',
  },
  qrFooterBar: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: '16px',
    borderTop: '1px solid var(--color-border)',
  },
  timerBadge: {
    fontSize: '12px',
    color: 'var(--color-accent)',
    fontWeight: '600',
  },
  urlHint: {
    fontSize: '11px',
    color: 'var(--color-text-muted)',
  },
};
