import { ArrowLeft, Moon, Sun, Bell, BellRing, LogOut, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { account } from '../lib/appwriteClient';
import { useTheme } from '../context/ThemeContext';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from './LanguageSwitcher';
import { useNotifications } from '../notifications/NotificationManager';

export default function TopBar({ title, subtitle, onBack, right = null, showLogout = false, showSettings = false }) {
  const { theme, toggleTheme } = useTheme();
  const { t } = useTranslation();
  const { permission, request } = useNotifications();
  const navigate = useNavigate();

  const handleLogout = async () => {
    if (!window.confirm('Log out of Aura? You can always come back anonymously again.')) return;
    try { await account.deleteSession('current'); } catch (e) { console.error('sign out failed', e); }
    navigate('/');
  };

  return (
    <div className="aura-topbar fade-in">
      <div className="aura-topbar-copy">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="aura-btn aura-btn-secondary aura-topbar-back"
            data-testid="topbar-back-btn"
            aria-label={t('back')}
          >
            <ArrowLeft size={16} />
          </button>
        )}
        <div style={{ minWidth: 0 }}>
          <h1 className="aura-topbar-title" data-testid="topbar-title">{title}</h1>
          {subtitle && <p className="aura-topbar-subtitle" data-testid="topbar-subtitle">{subtitle}</p>}
        </div>
      </div>

      <div className="aura-topbar-actions">
        {right}
        <LanguageSwitcher compact />
        <button
          type="button"
          className="aura-btn aura-btn-secondary aura-btn-pill"
          onClick={request}
          data-testid="notifications-toggle"
          aria-label={t('notifications')}
          title={permission === 'granted' ? t('notifications_enabled') : t('enable_notifications')}
        >
          {permission === 'granted' ? <BellRing size={14} /> : <Bell size={14} />}
        </button>
        <button
          type="button"
          className="aura-btn aura-btn-secondary aura-btn-pill"
          onClick={toggleTheme}
          data-testid="theme-toggle"
          aria-label={theme === 'light' ? t('dark_mode') : t('light_mode')}
        >
          {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
        </button>
        {showSettings && (
          <button
            type="button"
            className="aura-btn aura-btn-secondary aura-btn-pill"
            onClick={() => navigate('/aura/settings')}
            data-testid="settings-btn"
            aria-label="Account settings"
            title="Account settings"
          >
            <Settings size={14} />
          </button>
        )}
        {showLogout && (
          <button
            type="button"
            className="aura-btn aura-btn-secondary aura-btn-pill"
            onClick={handleLogout}
            data-testid="logout-btn"
            aria-label="Log out"
            title="Log out"
          >
            <LogOut size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
