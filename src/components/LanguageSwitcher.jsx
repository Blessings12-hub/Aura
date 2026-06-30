import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, ChevronDown } from 'lucide-react';
import { LANGUAGES } from '../constants/languages';

export default function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const current =
    LANGUAGES.find((l) => l.code === i18n.resolvedLanguage || l.code === i18n.language) || LANGUAGES[0];

  const changeLanguage = async (code) => {
    await i18n.changeLanguage(code);
    localStorage.setItem('aura_lang', code);
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
          minWidth: 130,
          fontSize: '0.85rem',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Globe size={14} />
        <span style={{ flex: 1, textAlign: 'left' }}>{current.label}</span>
        <ChevronDown size={14} />
      </button>

      {open && (
        <div
          className="aura-card-compact"
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            zIndex: 50,
            minWidth: 180,
            padding: 8,
            display: 'grid',
            gap: 6
          }}
        >
          {LANGUAGES.map((lang) => {
            const active = (i18n.resolvedLanguage || i18n.language) === lang.code;
            return (
              <button
                key={lang.code}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => changeLanguage(lang.code)}
                className="aura-btn aura-btn-secondary"
                style={{
                  justifyContent: 'flex-start',
                  padding: '10px 12px',
                  borderRadius: 10,
                  borderColor: active ? 'var(--primary)' : 'var(--border)',
                  background: active ? 'rgba(79, 70, 229, 0.10)' : 'var(--surface)'
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