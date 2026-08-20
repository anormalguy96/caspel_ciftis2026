import React, { useState } from 'react';
import { X, CheckCircle, Send, AlertCircle } from 'lucide-react';
import { LeadFormData } from '../types';
import { submitLead } from '../services/api';
import { trackAnalyticsEvent } from '../services/analytics';
import en from '../locales/en.json';

interface RequestDemoModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultProduct?: string;
}

export const RequestDemoModal: React.FC<RequestDemoModalProps> = ({
  isOpen,
  onClose,
  defaultProduct = 'erp',
}) => {
  const [formData, setFormData] = useState<LeadFormData>({
    name: '',
    company: '',
    business_email: '',
    interest: defaultProduct,
    honeypot: '',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      trackAnalyticsEvent('FORM_SUBMIT', formData.interest);
      await submitLead(formData);
      setIsSuccess(true);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('An unexpected error occurred. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetAndClose = () => {
    setIsSuccess(false);
    setErrorMessage(null);
    setFormData({
      name: '',
      company: '',
      business_email: '',
      interest: defaultProduct,
      honeypot: '',
    });
    onClose();
  };

  return (
    <div style={styles.backdrop} onClick={handleResetAndClose}>
      <div
        style={styles.modalContent}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div style={styles.modalHeader}>
          <div>
            <h2 style={styles.modalTitle}>{en.demoForm.title}</h2>
            <p style={styles.modalSubtitle}>{en.demoForm.subtitle}</p>
          </div>
          <button
            onClick={handleResetAndClose}
            style={styles.closeBtn}
            aria-label="Close modal"
          >
            <X size={20} color="#94a3b8" />
          </button>
        </div>

        {isSuccess ? (
          <div style={styles.successBox}>
            <div style={styles.successIcon}>
              <CheckCircle size={48} color="var(--color-success)" />
            </div>
            <h3 style={styles.successTitle}>{en.demoForm.successTitle}</h3>
            <p style={styles.successText}>{en.demoForm.successMessage}</p>
            <button
              onClick={handleResetAndClose}
              style={styles.primaryButton}
            >
              {en.actions.close}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={styles.form}>
            {errorMessage && (
              <div style={styles.errorBanner}>
                <AlertCircle size={18} color="var(--color-error)" />
                <span style={styles.errorText}>{errorMessage}</span>
              </div>
            )}

            {/* Hidden honeypot field for bot protection */}
            <input
              type="text"
              name="website_ref"
              value={formData.honeypot}
              onChange={(e) => setFormData({ ...formData, honeypot: e.target.value })}
              style={styles.honeypot}
              tabIndex={-1}
              autoComplete="off"
            />

            <div style={styles.formGroup}>
              <label style={styles.label}>{en.demoForm.nameLabel} *</label>
              <input
                type="text"
                required
                maxLength={255}
                placeholder={en.demoForm.namePlaceholder}
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                style={styles.input}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>{en.demoForm.companyLabel} *</label>
              <input
                type="text"
                required
                maxLength={255}
                placeholder={en.demoForm.companyPlaceholder}
                value={formData.company}
                onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                style={styles.input}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>{en.demoForm.emailLabel} *</label>
              <input
                type="email"
                required
                maxLength={255}
                placeholder={en.demoForm.emailPlaceholder}
                value={formData.business_email}
                onChange={(e) => setFormData({ ...formData, business_email: e.target.value })}
                style={styles.input}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>{en.demoForm.interestLabel} *</label>
              <select
                value={formData.interest}
                onChange={(e) => setFormData({ ...formData, interest: e.target.value })}
                style={styles.select}
              >
                <option value="erp">Caspel ERP</option>
                <option value="pms">Caspel PMS</option>
                <option value="irissea">IRISSEA</option>
                <option value="general">General / Partnership</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                ...styles.primaryButton,
                opacity: isSubmitting ? 0.7 : 1,
              }}
            >
              <Send size={16} />
              <span>{isSubmitting ? en.actions.submitting : en.actions.submit}</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    backdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    padding: '16px',
  },
  modalContent: {
    width: '100%',
    maxWidth: '480px',
    backgroundColor: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-modal)',
    padding: '24px',
    animation: 'fadeIn 0.2s ease',
  },
  modalHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: '20px',
  },
  modalTitle: {
    fontSize: '20px',
    fontWeight: '800',
    color: 'var(--color-text)',
    marginBottom: '4px',
  },
  modalSubtitle: {
    fontSize: '13px',
    color: 'var(--color-text-secondary)',
  },
  closeBtn: {
    padding: '6px',
    borderRadius: '8px',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  label: {
    fontSize: '12px',
    fontWeight: '600',
    color: 'var(--color-text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  input: {
    padding: '12px 14px',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-surface-elevated)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)',
    fontSize: '14px',
  },
  select: {
    padding: '12px 14px',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-surface-elevated)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)',
    fontSize: '14px',
  },
  honeypot: {
    display: 'none',
  },
  primaryButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '14px',
    borderRadius: 'var(--radius-md)',
    background: 'var(--color-accent-gradient)',
    color: '#ffffff',
    fontWeight: '700',
    fontSize: '15px',
    marginTop: '6px',
    boxShadow: '0 4px 15px rgba(0, 102, 204, 0.35)',
  },
  errorBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 14px',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
  },
  errorText: {
    fontSize: '13px',
    color: 'var(--color-error)',
  },
  successBox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    padding: '24px 0',
  },
  successIcon: {
    marginBottom: '16px',
  },
  successTitle: {
    fontSize: '22px',
    fontWeight: '800',
    color: 'var(--color-text)',
    marginBottom: '8px',
  },
  successText: {
    fontSize: '14px',
    color: 'var(--color-text-secondary)',
    marginBottom: '24px',
    lineHeight: 1.5,
  },
};
