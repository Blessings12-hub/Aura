import { useEffect } from 'react';
import {
  doc, getDoc, upsertDocument, COLLECTIONS, db,
} from '../lib/firestoreClient';

const HEARTBEAT_MS = 25_000;

export function usePresence(uid) {
  useEffect(() => {
    if (!uid) return undefined;
    let active = true;
    let permissionDenied = false;
    let timer;
    const publish = async (state = 'online') => {
      if (!active || permissionDenied) return;
      try {
        await upsertDocument(COLLECTIONS.presence, uid, {
          uid,
          state,
          lastChanged: Date.now(),
        });
      } catch (error) {
        if (error?.code === 'permission-denied') {
          permissionDenied = true;
          if (timer) window.clearInterval(timer);
          // Presence is optional; do not flood the console when the deployed
          // Firebase rules have not yet been updated for this collection.
          return;
        }
        if (active) console.warn('[v0] presence unavailable', error);
      }
    };
    publish();
    timer = window.setInterval(() => publish(), HEARTBEAT_MS);
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
    let permissionDenied = false;
    let timer;
    const read = async () => {
      if (!active || permissionDenied) return;
      try {
        const snap = await getDoc(doc(db, COLLECTIONS.presence, uid));
        if (active) onChange(snap.exists() ? snap.data() : { state: 'offline', lastChanged: null });
      } catch (error) {
        if (error?.code === 'permission-denied') {
          permissionDenied = true;
          if (timer) window.clearInterval(timer);
          if (active) onChange({ state: 'offline', lastChanged: null });
          return;
        }
        if (active) {
          console.warn('[v0] presence read unavailable', error);
          onChange({ state: 'offline', lastChanged: null });
        }
      }
    };
    read();
    timer = window.setInterval(read, HEARTBEAT_MS);
    return () => { active = false; window.clearInterval(timer); };
  }, [uid, onChange]);
}
