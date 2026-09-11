import { useCallback, useState } from 'react';

export function useFcmToken() {
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
  );
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  const enable = useCallback(async () => {
    if (typeof Notification === 'undefined') return 'unsupported';
    setSyncing(true);
    setError('');
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      return result;
    } catch (err) {
      setError(err?.message || 'Could not enable notifications');
      return 'error';
    } finally {
      setSyncing(false);
    }
  }, []);

  return { permission, enable, syncing, error };
}
