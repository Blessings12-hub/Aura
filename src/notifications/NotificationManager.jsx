import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const NotificationContext = createContext({ permission: 'default', request: () => {}, notify: () => {} });

export function NotificationProvider({ children }) {
  const [permission, setPermission] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'default');

  const request = useCallback(async () => {
    if (typeof Notification === 'undefined') return 'unsupported';
    if (Notification.permission === 'granted' || Notification.permission === 'denied') {
      setPermission(Notification.permission);
      return Notification.permission;
    }
    const p = await Notification.requestPermission();
    setPermission(p);
    if (p === 'granted') {
      try { new Notification('Aura', { body: 'Notifications are on — you’ll hear from us when something happens.', icon: '/icon-192.png' }); } catch {}
    }
    return p;
  }, []);

  const notify = useCallback((title, body, opts = {}) => {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;
    try {
      new Notification(title, { body, icon: '/icon-192.png', badge: '/icon-192.png', ...opts });
    } catch {}
  }, []);

  // Listen to the global custom event so any module can emit notifications without coupling
  useEffect(() => {
    const handler = (e) => { const { title, body, opts } = e.detail || {}; notify(title || 'Aura', body || '', opts); };
    window.addEventListener('aura:notify', handler);
    return () => window.removeEventListener('aura:notify', handler);
  }, [notify]);

  return (
    <NotificationContext.Provider value={{ permission, request, notify }}>
      {children}
    </NotificationContext.Provider>
  );
}

export const useNotifications = () => useContext(NotificationContext);

// Convenience helper to dispatch a notification from anywhere
export function pushAuraNotification(title, body, opts = {}) {
  window.dispatchEvent(new CustomEvent('aura:notify', { detail: { title, body, opts } }));
}

// The old default export keeps the App tree happy
export default function NotificationManager() { return null; }