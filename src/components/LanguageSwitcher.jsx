
import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { LANGUAGES } from '../constants/languages';

export default function LanguageSwitcher({ compact = false }) {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = LANGUAGES.find((l) => l.code === i18n.resolvedLanguage) || LANGUAGES[0];

  const change = async (code) => {
    await i18n.changeLanguage(code);
    localStorage.setItem('aura_lang', code);
    setOpen(false);
  };

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type=\"button\"
        onClick={() => setOpen((v) => !v)}
        className=\"aura-btn aura-btn-secondary aura-btn-pill\"
        data-testid=\"language-switcher-btn\"
        aria-haspopup=\"listbox\"
        aria-expanded={open}
      >
        <Globe size={14} />
        <span>{current.label}</span>
      </button>

      {open && (
        <div
          className=\"aura-card-compact\"
          role=\"listbox\"
          data-testid=\"language-switcher-list\"
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0,
            zIndex: 50, minWidth: 180, padding: 6, display: 'grid', gap: 4,
            maxHeight: 320, overflowY: 'auto',
          }}
        >
          {LANGUAGES.map((lang) => {
            const active = i18n.resolvedLanguage === lang.code;
            return (
              <button
                key={lang.code}
                type=\"button\"
                role=\"option\"
                aria-selected={active}
                onClick={() => change(lang.code)}
                data-testid={`lang-option-${lang.code}`}
                className=\"aura-btn aura-btn-ghost\"
                style={{
                  justifyContent: 'flex-start', borderRadius: 10, padding: '8px 12px',
                  background: active ? 'var(--surface-3)' : 'transparent',
                  color: 'var(--text)',
                }}
              >
                {lang.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}