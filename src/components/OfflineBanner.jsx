import { useTranslation } from 'react-i18next';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

// Rendered once, globally, in App.jsx — shows above everything whenever
// the browser goes offline, and disappears the instant it's back.
export default function OfflineBanner() {
  const { t } = useTranslation();
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div className="aura-offline-banner" role="status" data-testid="offline-banner">
      <WifiOff size={14} /> {t('offline_banner')}
    </div>
  );
}
