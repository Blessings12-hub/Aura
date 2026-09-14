import { useEffect, useState } from 'react';
import {
  collection, query, where, limit, getDocs, COLLECTIONS, db,
} from '../lib/firestoreClient';

const ONLINE_WINDOW_MS = 75_000;

export function useOnlineCount() {
  const [count, setCount] = useState(null);
  useEffect(() => {
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
        if (active) {
          console.error('online count: failed to read presence', error);
          setCount(null);
        }
      }
    };
    read();
    const timer = window.setInterval(read, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  return count;
}
