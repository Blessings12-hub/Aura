import { useEffect } from 'react';
import {
  doc, getDoc, upsertDocument, COLLECTIONS, db,
} from '../lib/firestoreClient';

const HEARTBEAT_MS = 25_000;

export function usePresence(uid) {
  useEffect(() => {
    if (!uid) return undefined;
    let active = true;
    const publish = async (state = 'online') => {
      try {
        await upsertDocument(COLLECTIONS.presence, uid, {
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
        const snap = await getDoc(doc(db, COLLECTIONS.presence, uid));
        if (active) onChange(snap.exists() ? snap.data() : { state: 'offline', lastChanged: null });
      } catch (error) {
        if (active) {
          console.error(`presence: failed to read ${uid}`, error);
          onChange({ state: 'offline', lastChanged: null });
        }
      }
    };
    read();
    const timer = window.setInterval(read, HEARTBEAT_MS);
    return () => { window.clearInterval(timer); };
  }, [uid, onChange]);
}
