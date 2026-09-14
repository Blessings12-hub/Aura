import { listenForFirebaseMessages, registerFirebaseMessaging } from './lib/firebaseClient';

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  return navigator.serviceWorker.register('/firebase-messaging-sw.js');
}

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return null;
  await registerServiceWorker();
  return registerFirebaseMessaging();
}

export function listenForForegroundMessages(callback) {
  let unsubscribe;
  listenForFirebaseMessages(callback).then((cleanup) => { unsubscribe = cleanup; });
  return () => unsubscribe?.();
}
