import React, { useState, useCallback } from 'react';
import { X, CheckCircle, Send, AlertCircle } from 'lucide-react';
import { LeadFormData } from '../types';
import { submitLead } from '../services/api';
import { trackAnalyticsEvent } from '../services/analytics';
import { useTranslation } from 'react-i18next';
import { useExitTransition } from '../hooks/useExitTransition';
import { useModalA11y } from '../hooks/useModalA11y';

interface RequestDemoModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultProduct?: string;
}

const INTEREST_OPTIONS = [
  { value: 'erp', label: 'Caspel ERP' },
  { value: 'pms', label: 'Caspel PMS' },
  { value: 'irissea', label: 'IRISSEA' },
  { value: 'general', label: 'General / Partnership' },
];

export const RequestDemoModal: React.FC<RequestDemoModalProps> = ({
  isOpen,
  onClose,
  defaultProduct = 'erp',
}) => {
  const { t } = useTranslation();
  const emptyForm = (): LeadFormData => ({
    name: '',
    company: '',
    business_email: '',
    interest: defaultProduct,
    honeypot: '',
  });

  const [formData, setFormData] = useState<LeadFormData>(emptyForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleResetAndClose = useCallback(() => {
    setIsSuccess(false);
    setErrorMessage(null);
    setFormData(emptyForm());
    onClose();
    // emptyForm closes over defaultProduct only, which is stable per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, defaultProduct]);

  const transitionState = useExitTransition(isOpen);
  const panelRef = useModalA11y<HTMLDivElement>(isOpen, handleResetAndClose);

  if (transitionState === null) return null;

  const update = (patch: Partial<LeadFormData>) =>
    setFormData((current) => ({ ...current, ...patch }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      await submitLead(formData);
      // Tracked only after the server accepts it — counting attempts as
      // submissions would overstate conversions in the exhibition report.
      trackAnalyticsEvent('FORM_SUBMIT', formData.interest);
      setIsSuccess(true);
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="modal-backdrop u-backdrop"
      data-state={transitionState}
      onClick={handleResetAndClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="modal u-panel"
        data-state={transitionState}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-modal-title"
      >
        <div className="modal__header">
          <div>
            <h2 className="modal__title" id="demo-modal-title">
              {t('demoForm.title')}
            </h2>
            <p className="modal__subtitle">{t('demoForm.subtitle')}</p>
          </div>
          <button
            type="button"
            className="modal__close"
            onClick={handleResetAndClose}
            aria-label={t('actions.close')}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {isSuccess ? (
          <div className="modal__success">
            <CheckCircle size={44} className="modal__success-icon" aria-hidden="true" />
            <h3 className="modal__success-title">{t('demoForm.successTitle')}</h3>
            <p className="modal__success-text">{t('demoForm.successMessage')}</p>
            <button
              type="button"
              className="btn btn--primary btn--block"
              onClick={handleResetAndClose}
            >
              {t('actions.close')}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="modal__form">
            {errorMessage && (
              <p className="form-error" role="alert">
                <AlertCircle size={16} aria-hidden="true" />
                <span>{errorMessage}</span>
              </p>
            )}

            {/* Honeypot: invisible to people, tempting to bots. A filled value
                makes the server discard the submission silently. */}
            <input
              type="text"
              name="website_ref"
              className="honeypot"
              value={formData.honeypot}
              onChange={(e) => update({ honeypot: e.target.value })}
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
            />

            <div className="field">
              <label className="field__label" htmlFor="demo-name">
                {t('demoForm.nameLabel')} *
              </label>
              <input
                id="demo-name"
                data-autofocus
                className="field__input"
                type="text"
                required
                maxLength={255}
                autoComplete="name"
                placeholder={t('demoForm.namePlaceholder')}
                value={formData.name}
                onChange={(e) => update({ name: e.target.value })}
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="demo-company">
                {t('demoForm.companyLabel')} *
              </label>
              <input
                id="demo-company"
                className="field__input"
                type="text"
                required
                maxLength={255}
                autoComplete="organization"
                placeholder={t('demoForm.companyPlaceholder')}
                value={formData.company}
                onChange={(e) => update({ company: e.target.value })}
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="demo-email">
                {t('demoForm.emailLabel')} *
              </label>
              <input
                id="demo-email"
                className="field__input"
                type="email"
                required
                maxLength={255}
                autoComplete="email"
                inputMode="email"
                placeholder={t('demoForm.emailPlaceholder')}
                value={formData.business_email}
                onChange={(e) => update({ business_email: e.target.value })}
              />
            </div>

            <div className="field">
              <label className="field__label" id="demo-interest-label" htmlFor="demo-interest">
                {t('demoForm.interestLabel')} *
              </label>
              <div className="demo-pills" role="radiogroup" aria-labelledby="demo-interest-label">
                {INTEREST_OPTIONS.map((option) => {
                  const isSelected = formData.interest === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      className={`demo-pill ${isSelected ? 'demo-pill--active' : ''}`}
                      onClick={() => update({ interest: option.value })}
                    >
                      <span className="demo-pill__indicator" aria-hidden="true" />
                      <span className="demo-pill__label">{option.label}</span>
                    </button>
                  );
                })}
              </div>
              <select
                id="demo-interest"
                className="visually-hidden"
                value={formData.interest}
                onChange={(e) => update({ interest: e.target.value })}
                tabIndex={-1}
                aria-hidden="true"
              >
                {INTEREST_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <button type="submit" className="btn btn--primary btn--block" disabled={isSubmitting}>
              {isSubmitting ? (
                <span className="u-dots" aria-hidden="true">
                  <span style={{ ['--i' as string]: 0 }} />
                  <span style={{ ['--i' as string]: 1 }} />
                  <span style={{ ['--i' as string]: 2 }} />
                </span>
              ) : (
                <>
                  <Send size={16} aria-hidden="true" />
                  <span>{t('actions.submit')}</span>
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
