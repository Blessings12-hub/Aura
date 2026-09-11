import { useEffect } from 'react';
import { APPWRITE_COLLECTIONS, databases, databaseId, requireAppwrite, upsertDocument } from '../lib/appwriteClient';

const HEARTBEAT_MS = 25_000;

export function usePresence(uid) {
  useEffect(() => {
    if (!uid) return undefined;
    let active = true;
    const publish = async (state = 'online') => {
      try {
        requireAppwrite();
        await upsertDocument(APPWRITE_COLLECTIONS.presence, uid, {
          uid,
          state,
          lastChanged: Date.now(),
        });
      } catch (error) {
        if (active) console.error('presence heartbeat failed', error);
      }
    };
    publish();
    const timer = window.setInterval(() => publish(), HEARTBEAT_MS);
    const markOffline = () => { publish('offline'); };
    window.addEventListener('pagehide', markOffline);
    window.addEventListener('beforeunload', markOffline);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('pagehide', markOffline);
      window.removeEventListener('beforeunload', markOffline);
      publish('offline');
    };
  }, [uid]);
}

export function useUserStatus(uid, onChange) {
  useEffect(() => {
    if (!uid) return undefined;
    let active = true;
    const read = async () => {
      try {
        requireAppwrite();
        const document = await databases.getDocument(databaseId, APPWRITE_COLLECTIONS.presence, uid);
        if (active) onChange(document);
      } catch (error) {
        if (active && error?.code !== 404) console.error(`presence: failed to read ${uid}`, error);
        if (active) onChange({ state: 'offline', lastChanged: null });
      }
    };
    read();
    const unsubscribe = databases ? undefined : undefined;
    const timer = window.setInterval(read, HEARTBEAT_MS);
    return () => { window.clearInterval(timer); unsubscribe?.(); };
  }, [uid, onChange]);
}
