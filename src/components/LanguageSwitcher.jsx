
import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { LANGUAGES } from '../constants/languages';

const DROPDOWN_WIDTH = 180;
const VIEWPORT_MARGIN = 10;

export default function LanguageSwitcher({ compact = false }) {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  // FIXED: the dropdown used to be `position: absolute; right: 0`,
  // anchored purely in CSS relative to its own trigger button. That
  // works fine when the trigger sits well inside a wide, padded
  // container (like on the Login card) — but this component is also
  // rendered `compact` inside TopBar's icon row on every other page,
  // where the trigger sits much closer to the actual screen edge. With
  // `body { overflow-x: hidden }` already set globally (to stop
  // unwanted horizontal scroll elsewhere), any part of the dropdown that
  // computed past either edge of the viewport wasn't just visually
  // spilling over — it was being clipped and made invisible, which is
  // what "half hides in the phone's sides" was.
  //
  // Fixed by switching to `position: fixed` with coordinates computed in
  // JS from the trigger's actual on-screen position, then clamped so the
  // dropdown's left and right edges both always stay within the
  // viewport (minus a small margin) — regardless of which page it's on,
  // how narrow the screen is, or how close to the edge the trigger sits.
  const [dropdownPos, setDropdownPos] = useState(null);
  const ref = useRef(null);
  const btnRef = useRef(null);
  const current = LANGUAGES.find((l) => l.code === i18n.resolvedLanguage) || LANGUAGES[0];

  const change = async (code) => {
    await i18n.changeLanguage(code);
    localStorage.setItem('aura_lang', code);
    setOpen(false);
  };

  const computePosition = () => {
    if (!btnRef.current) return null;
    const rect = btnRef.current.getBoundingClientRect();
    let left = rect.right - DROPDOWN_WIDTH;
    const maxLeft = window.innerWidth - DROPDOWN_WIDTH - VIEWPORT_MARGIN;
    left = Math.min(left, maxLeft);
    left = Math.max(left, VIEWPORT_MARGIN);
    return { top: rect.bottom + 8, left };
  };

  const toggleOpen = () => {
    if (!open) setDropdownPos(computePosition());
    setOpen((v) => !v);
  };

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // Re-clamp on resize/orientation change while open, so rotating the
  // phone or resizing doesn't leave a stale, now-off-screen position
  // behind.
  useEffect(() => {
    if (!open) return undefined;
    const onResize = () => setDropdownPos(computePosition());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  return (
    <div ref={ref}>
      <button
        ref={btnRef}
        type="button"
        onClick={toggleOpen}
        className={`aura-btn aura-btn-secondary aura-btn-pill${compact ? ' is-compact' : ''}`}
        data-testid="language-switcher-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Globe size={14} />
        <span className="aura-lang-switcher-label">{current.label}</span>
      </button>

      {open && dropdownPos && (
        <div
          className="aura-card-compact"
          role="listbox"
          data-testid="language-switcher-list"
          style={{
            position: 'fixed', top: dropdownPos.top, left: dropdownPos.left,
            zIndex: 50, width: DROPDOWN_WIDTH, padding: 6, display: 'grid', gap: 4,
            maxHeight: 320, overflowY: 'auto',
          }}
        >
          {LANGUAGES.map((lang) => {
            const active = i18n.resolvedLanguage === lang.code;
            return (
              <button
                key={lang.code}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => change(lang.code)}
                data-testid={`lang-option-${lang.code}`}
                className="aura-btn aura-btn-ghost"
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
