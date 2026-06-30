import { ArrowLeft, Moon, Sun } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

export default function TopBar({ title, subtitle, onBack }) {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="aura-card aura-topbar">
      <div className="aura-row aura-topbar-inner">
        <div className="aura-topbar-copy">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="aura-btn aura-btn-secondary aura-topbar-back"
            >
              <ArrowLeft size={16} />
              Back
            </button>
          )}

          <h1 className="aura-title aura-topbar-title">{title}</h1>

          {subtitle && <p className="aura-subtitle aura-topbar-subtitle">{subtitle}</p>}
        </div>

        <button
          type="button"
          className="aura-btn aura-btn-secondary aura-theme-toggle"
          onClick={toggleTheme}
          aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
        >
          {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
        </button>
      </div>
    </div>
  );
}