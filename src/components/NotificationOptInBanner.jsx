import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, X } from 'lucide-react';
import { useFcmToken } from '../hooks/useFcmToken';

const DISMISS_KEY = 'aura_push_banner_dismissed_v1';

// Shown on Home when push notifications are available but not yet granted
// or declined. This is what actually closes the "the other person never
// finds out" gap for real — enabling it means a Cloud Function can reach
// this device even when the app isn't open (see functions/index.js).
export default function NotificationOptInBanner({ userId }) {
  const { t } = useTranslation();
  const { permission, enable, syncing } = useFcmToken(userId);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  if (permission !== 'default' || dismissed || typeof Notification === 'undefined') {
    return null;
  }

  const dismiss = () => {
    setDismissed(true);
    try { window.localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
  };

  return (
    <div className="aura-card aura-section fade-in" style={{ display: 'flex', alignItems: 'center', gap: 12 }} data-testid="push-optin-banner">
      <Bell size={20} style={{ flexShrink: 0 }} />
      <p className="aura-muted" style={{ margin: 0, flex: 1 }}>{t('push_optin_desc')}</p>
      <button type="button" className="aura-btn aura-btn-primary" disabled={syncing} onClick={enable} data-testid="push-optin-enable">
        {syncing ? t('loading') : t('push_optin_enable')}
      </button>
      <button type="button" className="message__safety-btn" onClick={dismiss} aria-label={t('skip')} data-testid="push-optin-dismiss">
        <X size={16} />
      </button>
    </div>
  );
}
