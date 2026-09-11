import { account } from './lib/appwriteClient';

/**
 * Appwrite does not use Firebase Cloud Messaging. Aura keeps notification
 * permission as an optional browser capability while in-app notifications
 * remain the source of truth.
 */
export async function registerServiceWorker() {
  return null;
}

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return null;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;
  try {
    return await account.get();
  } catch {
    return null;
  }
}

export function listenForForegroundMessages() {
  return () => {};
}
