import { useEffect, useState } from 'react';
import { Query, APPWRITE_COLLECTIONS, databaseId, databases, ownerPermissions, subscribeToCollection, upsertDocument } from '../lib/appwriteClient';

export function useRoomPresence(roomId, uid, meta = {}) {
  const [members, setMembers] = useState({});
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!roomId || !uid) return undefined;
    let active = true;
    let presenceUnavailable = false;
    const documentId = `${roomId}-${uid}`.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 36);
    const data = { roomId, uid, ...meta, lastChanged: new Date().toISOString() };

    async function join() {
      try {
        await upsertDocument(
          APPWRITE_COLLECTIONS.presence,
          documentId,
          data,
          ownerPermissions(uid),
        );
        if (!active) return;
        const refresh = (result) => {
          const rows = result?.documents || [];
          setMembers(Object.fromEntries(rows.map((row) => [row.uid || row.$id, row])));
        };
        const queries = [Query.equal('roomId', roomId)];
        refresh(await databases.listDocuments(databaseId, APPWRITE_COLLECTIONS.presence, queries));
        const unsubscribe = subscribeToCollection(APPWRITE_COLLECTIONS.presence, queries, refresh, setError);
        return unsubscribe;
      } catch (joinError) {
        if (joinError?.code === 404 || joinError?.type === 'collection_not_found') {
          presenceUnavailable = true;
          if (active) setError('Presence is not configured in Appwrite yet.');
          return undefined;
        }
        if (active) setError(joinError?.message || 'presence unavailable');
        return undefined;
      }
    }

    let unsubscribe;
    join().then((cleanup) => { unsubscribe = cleanup; });
    const heartbeat = window.setInterval(async () => {
      if (presenceUnavailable) return;
      try {
        await databases.updateDocument(databaseId, APPWRITE_COLLECTIONS.presence, documentId, { lastChanged: new Date().toISOString() });
      } catch (heartbeatError) {
        if (heartbeatError?.code === 404 || heartbeatError?.type === 'collection_not_found') {
          presenceUnavailable = true;
          if (active) setError('Presence is not configured in Appwrite yet.');
          return;
        }
        if (active) setError(heartbeatError?.message || 'presence unavailable');
      }
    }, 30000);

    return () => {
      active = false;
      window.clearInterval(heartbeat);
      unsubscribe?.();
      databases.deleteDocument(databaseId, APPWRITE_COLLECTIONS.presence, documentId).catch(() => {});
    };
  }, [roomId, uid]);

  return { members, count: Object.keys(members).length, error };
}
