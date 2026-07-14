import { useCallback, useEffect, useState } from 'react';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { requestNotificationPermission } from '../firebase-messaging';

// Requests the browser's notification permission, gets an FCM device
// token, and stores it in pushTokens/{uid} — deliberately its own
// collection, not a field on users/{uid} (that doc is readable by any
// signed-in user, which would leak everyone's raw device token). That
// stored token is what lets a Cloud Function (see functions/index.js)
// actually reach this device when a match/swap/event request comes in —
// WITHOUT this, a request notification only ever works while this exact
// tab is open (see IncomingRequestWatcher), never on a different device or
// a closed tab.
export function useFcmToken(userId) {
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
  );
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  const saveToken = useCallback(async (token) => {
    if (!userId || !token) return;
    await setDoc(doc(db, 'pushTokens', userId), {
      token, updatedAt: Timestamp.now(),
    }, { merge: true });
  }, [userId]);

  // If permission was already granted in a past session, keep the stored
  // token fresh (FCM tokens can rotate) without asking again.
  useEffect(() => {
    if (!userId || typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;
    requestNotificationPermission()
      .then((token) => { if (token) saveToken(token); })
      .catch(() => {});
  }, [userId, saveToken]);

  const enable = useCallback(async () => {
    if (typeof Notification === 'undefined') return 'unsupported';
    setSyncing(true);
    setError('');
    try {
      const token = await requestNotificationPermission();
      setPermission(Notification.permission);
      if (token) {
        await saveToken(token);
        return 'granted';
      }
      return Notification.permission;
    } catch (err) {
      setError(err?.message || 'Could not enable notifications');
      return 'error';
    } finally {
      setSyncing(false);
    }
  }, [saveToken]);

  return {
    permission, enable, syncing, error,
  };
}
