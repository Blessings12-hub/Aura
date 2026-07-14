import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

// A short first-run carousel explaining what each of the six activities
// does, plus a closing tip about blocking/reporting. Shown once — Home.jsx
// gates it behind a localStorage flag so it never reappears after the
// person has seen or skipped it. `slides` is an array of
// { icon: LucideIcon | null, color, title, desc } built by the caller.
export default function OnboardingModal({ slides, onDismiss }) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const slide = slides[step];
  const isLast = step === slides.length - 1;
  const Icon = slide.icon;

  return (
    <div className="aura-modal-backdrop" data-testid="onboarding-backdrop" onClick={onDismiss}>
      <div className="aura-modal fade-in" style={{ textAlign: 'center' }} data-testid="onboarding-modal" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="message__safety-btn"
          style={{ position: 'absolute', top: 16, right: 16 }}
          onClick={onDismiss}
          aria-label={t('skip')}
          data-testid="onboarding-skip"
        >
          <X size={16} />
        </button>

        {Icon && (
          <div
            className="activity-card__icon"
            style={{
              background: slide.color, margin: '0 auto 16px', width: 56, height: 56,
            }}
            aria-hidden="true"
          >
            <Icon size={26} />
          </div>
        )}
        <h2 className="aura-title" style={{ marginTop: 0 }}>{slide.title}</h2>
        <p className="aura-muted" style={{ margin: '8px 0 20px' }}>{slide.desc}</p>

        <div className="aura-row" style={{ justifyContent: 'center', gap: 6, marginBottom: 18 }}>
          {slides.map((s, i) => (
            <span
              // eslint-disable-next-line react/no-array-index-key
              key={i}
              style={{
                width: 6, height: 6, borderRadius: 999,
                background: i === step ? 'var(--text)' : 'var(--border-strong)',
              }}
            />
          ))}
        </div>

        <div className="aura-row">
          <button
            type="button"
            className="aura-btn aura-btn-secondary"
            style={{ flex: 1, visibility: step === 0 ? 'hidden' : 'visible' }}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            data-testid="onboarding-back"
          >
            <ChevronLeft size={16} /> {t('back')}
          </button>
          <button
            type="button"
            className="aura-btn aura-btn-primary"
            style={{ flex: 1 }}
            onClick={() => (isLast ? onDismiss() : setStep((s) => s + 1))}
            data-testid="onboarding-next"
          >
            {isLast ? t('get_started') : t('next')} {!isLast && <ChevronRight size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
