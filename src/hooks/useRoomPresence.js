import { useEffect, useState } from 'react';
import {
  collection, query, where, doc, getDocs, deleteDoc, updateDoc, onSnapshot,
  upsertDocument, COLLECTIONS, db,
} from '../lib/firestoreClient';

export function useRoomPresence(roomId, uid, meta = {}) {
  const [members, setMembers] = useState({});
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!roomId || !uid) return undefined;
    let active = true;
    const documentId = `${roomId}-${uid}`.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 36);
    const data = { roomId, uid, ...meta, lastChanged: new Date().toISOString() };

    async function join() {
      try {
        await upsertDocument(COLLECTIONS.presence, documentId, data);
        if (!active) return undefined;
        const refresh = (snap) => {
          const rows = snap.docs.map((d) => ({ $id: d.id, ...d.data() }));
          setMembers(Object.fromEntries(rows.map((row) => [row.uid || row.$id, row])));
        };
        const q = query(collection(db, COLLECTIONS.presence), where('roomId', '==', roomId));
        refresh(await getDocs(q));
        return onSnapshot(q, refresh, setError);
      } catch (joinError) {
        if (active) setError(joinError?.message || 'presence unavailable');
        return undefined;
      }
    }

    let unsubscribe;
    let heartbeat;
    let joined = false;
    let heartbeatFailed = false;

    join().then((cleanup) => {
      if (!active) return;
      unsubscribe = cleanup;
      // Do not start a heartbeat until the presence document has been created.
      // This avoids a race where updateDoc runs before auth/rules have accepted
      // the initial join and then logs a permission-denied error every tick.
      joined = Boolean(cleanup);
      if (!joined) return;
      heartbeat = window.setInterval(async () => {
        if (!active || heartbeatFailed) return;
        try {
          await updateDoc(doc(db, COLLECTIONS.presence, documentId), { lastChanged: new Date().toISOString() });
        } catch (heartbeatError) {
          // A revoked Firebase session or stale rules cannot be repaired by
          // retrying forever. Stop the timer and show the room's fallback UI.
          heartbeatFailed = true;
          if (heartbeat) window.clearInterval(heartbeat);
          if (active) setError(heartbeatError?.message || 'presence unavailable');
        }
      }, 30000);
    });

    return () => {
      active = false;
      if (heartbeat) window.clearInterval(heartbeat);
      unsubscribe?.();
      deleteDoc(doc(db, COLLECTIONS.presence, documentId)).catch(() => {});
    };
  }, [roomId, uid]);

  return { members, count: Object.keys(members).length, error };
}
