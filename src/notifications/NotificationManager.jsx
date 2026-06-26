import { useEffect } from 'react';
import { requestNotificationPermission, listenForForegroundMessages } from '../firebase-messaging';

export default function NotificationManager() {
  useEffect(() => {
    let unsub = null;

    const init = async () => {
      if (!('Notification' in window)) return;

      const token = await requestNotificationPermission();
      if (token) localStorage.setItem('aura_fcm_token', token);

      unsub = listenForForegroundMessages((payload) => {
        const title = payload?.notification?.title || 'Aura';
        const body = payload?.notification?.body || 'You have a new update';
        new Notification(title, { body });
      });
    };

    init();

    return () => {
      if (unsub) unsub();
    };
  }, []);

  return null;
}