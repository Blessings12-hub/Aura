import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const languages = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'pt', label: 'Português' },
  { code: 'it', label: 'Italiano' },
  { code: 'ru', label: 'Русский' },
  { code: 'ar', label: 'العربية' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'zh', label: '中文' }
];

export default function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const current = languages.find((l) => l.code === i18n.language) || languages[0];

  const changeLanguage = async (lng) => {
    await i18n.changeLanguage(lng);
    localStorage.setItem('aura_lang', lng);
    setOpen(false);
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={boxRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="aura-btn aura-btn-secondary"
        style={{
          padding: '8px 12px',
          borderRadius: 999,
          minWidth: 110,
          fontSize: '0.85rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10
        }}
      >
        <span>{current.label}</span>
        <span style={{ fontSize: '0.7rem', opacity: 0.8 }}>▾</span>
      </button>

      {open && (
        <div
          className="aura-card-compact"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            zIndex: 50,
            minWidth: 180,
            padding: 8
          }}
        >
          <div style={{ display: 'grid', gap: 6 }}>
            {languages.map((lang) => (
              <button
                key={lang.code}
                type="button"
                onClick={() => changeLanguage(lang.code)}
                className="aura-btn aura-btn-secondary"
                style={{
                  justifyContent: 'flex-start',
                  padding: '10px 12px',
                  borderRadius: 10,
                  borderColor: i18n.language === lang.code ? 'var(--primary)' : 'var(--border)',
                  background: i18n.language === lang.code ? 'rgba(79,70,229,0.08)' : 'var(--surface)'
                }}
              >
                {lang.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}