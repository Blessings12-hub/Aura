import { ArrowLeft, Moon, Sun, Bell, BellRing } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from './LanguageSwitcher';
import { useNotifications } from '../notifications/NotificationManager';

export default function TopBar({ title, subtitle, onBack, right = null }) {
  const { theme, toggleTheme } = useTheme();
  const { t } = useTranslation();
  const { permission, request } = useNotifications();

  return (
    <div className=\"aura-topbar fade-in\">
      <div className=\"aura-topbar-copy\">
        {onBack && (
          <button
            type=\"button\"
            onClick={onBack}
            className=\"aura-btn aura-btn-secondary aura-topbar-back\"
            data-testid=\"topbar-back-btn\"
            aria-label={t('back')}
          >
            <ArrowLeft size={16} />
          </button>
        )}
        <div style={{ minWidth: 0 }}>
          <h1 className=\"aura-topbar-title\" data-testid=\"topbar-title\">{title}</h1>
          {subtitle && <p className=\"aura-topbar-subtitle\" data-testid=\"topbar-subtitle\">{subtitle}</p>}
        </div>
      </div>

      <div className=\"aura-topbar-actions\">
        {right}
        <LanguageSwitcher compact />
        <button
          type=\"button\"
          className=\"aura-btn aura-btn-secondary aura-btn-pill\"
          onClick={request}
          data-testid=\"notifications-toggle\"
          aria-label={t('notifications')}
          title={permission === 'granted' ? t('notifications_enabled') : t('enable_notifications')}
        >
          {permission === 'granted' ? <BellRing size={14} /> : <Bell size={14} />}
        </button>
        <button
          type=\"button\"
          className=\"aura-btn aura-btn-secondary aura-btn-pill\"
          onClick={toggleTheme}
          data-testid=\"theme-toggle\"
          aria-label={theme === 'light' ? t('dark_mode') : t('light_mode')}
        >
          {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
        </button>
      </div>
    </div>
  );
}