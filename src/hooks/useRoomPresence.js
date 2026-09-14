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
    join().then((cleanup) => { unsubscribe = cleanup; });
    const heartbeat = window.setInterval(async () => {
      try {
        await updateDoc(doc(db, COLLECTIONS.presence, documentId), { lastChanged: new Date().toISOString() });
      } catch (heartbeatError) {
        if (active) setError(heartbeatError?.message || 'presence unavailable');
      }
    }, 30000);

    return () => {
      active = false;
      window.clearInterval(heartbeat);
      unsubscribe?.();
      deleteDoc(doc(db, COLLECTIONS.presence, documentId)).catch(() => {});
    };
  }, [roomId, uid]);

  return { members, count: Object.keys(members).length, error };
}
