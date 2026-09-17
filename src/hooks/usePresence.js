import { useEffect } from 'react';
import {
  doc, getDoc, upsertDocument, COLLECTIONS, db,
} from '../lib/firestoreClient';
import { isCancellation } from '../lib/quietErrors';

const HEARTBEAT_MS = 25_000;

export function usePresence(uid) {
  useEffect(() => {
    if (!uid) return undefined;
    let active = true;
    let permissionDenied = false;
    let timer;

    // `force` lets the unmount path write "offline" after the effect has
    // already flipped `active` to false. Without it the old cleanup called
    // publish('offline') and publish immediately returned on the !active
    // check — so leaving a page never actually marked anyone offline, and
    // the online count stayed inflated until the 75s window expired.
    const publish = async (state = 'online', force = false) => {
      if ((!active && !force) || permissionDenied) return;
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
        // A write cancelled by navigation is not a failure worth reporting.
        if (isCancellation(error)) return;
        if (active) console.warn('[presence] unavailable', error);
      }
    };

    publish();
    timer = window.setInterval(() => publish(), HEARTBEAT_MS);

    const markOffline = () => {
      // Do not start a network write while the page is already being torn
      // down. Firebase aborts that request and browsers report it as a noisy
      // error.
      if (document.visibilityState === 'hidden') return;
      publish('offline');
    };

    window.addEventListener('pagehide', markOffline);
    window.addEventListener('beforeunload', markOffline);

    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('pagehide', markOffline);
      window.removeEventListener('beforeunload', markOffline);
      publish('offline', true);
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
        if (isCancellation(error)) return;
        if (active) {
          console.warn('[presence] read unavailable', error);
          onChange({ state: 'offline', lastChanged: null });
        }
      }
    };
    read();
    timer = window.setInterval(read, HEARTBEAT_MS);
    return () => { active = false; window.clearInterval(timer); };
  }, [uid, onChange]);
}
