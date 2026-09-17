import { useEffect, useState } from 'react';
import {
  collection, query, where, limit, getDocs, COLLECTIONS, db,
} from '../lib/firestoreClient';
import { useAuthUid } from './useAuthUid';
import { logUnlessCancelled } from '../lib/quietErrors';

const ONLINE_WINDOW_MS = 75_000;

// This hook used to fire its presence query the instant Home mounted, with no
// regard for whether anyone was signed in yet. The presence rule in
// firestore.rules is `allow read: if signedIn()`, so on a cold load that first
// query reliably came back "Missing or insufficient permissions" — and then
// repeated it every 30 seconds. Waiting for the shared session fixes it; the
// signature is unchanged, so Home.jsx needs no edit.
export function useOnlineCount() {
  const { uid, ready } = useAuthUid();
  const [count, setCount] = useState(null);

  useEffect(() => {
    if (!ready || !uid) return undefined;

    let active = true;
    const read = async () => {
      try {
        const cutoff = Date.now() - ONLINE_WINDOW_MS;
        // Firestore can't combine an inequality on lastChanged with the
        // 'online' equality filter without a composite index, so the
        // recency check is done client-side after the read instead —
        // fine at this app's scale (capped at 500 docs).
        const q = query(collection(db, COLLECTIONS.presence), where('state', '==', 'online'), limit(500));
        const snap = await getDocs(q);
        const online = snap.docs.filter((d) => Number(d.data().lastChanged) >= cutoff).length;
        if (active) setCount(online);
      } catch (error) {
        if (!active) return;
        logUnlessCancelled('online count: failed to read presence', error);
        setCount(null);
      }
    };

    read();
    const timer = window.setInterval(read, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [uid, ready]);

  return count;
}
