import { useEffect, useState } from 'react';

// Tracks the browser's online/offline state. This is a real-time app —
// every screen breaks silently on a dropped connection without some
// visible signal, so this backs a persistent banner (see OfflineBanner).
export function useOnlineStatus() {
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
