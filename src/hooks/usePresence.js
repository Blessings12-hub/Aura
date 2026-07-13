import { useEffect } from 'react';
import {
  ref, onValue, onDisconnect, set, serverTimestamp as rtdbServerTimestamp,
} from 'firebase/database';
import { rtdb } from '../firebase';

/**
 * Establishes GENUINE presence for `uid`, for as long as this hook stays
 * mounted (call it once, near the top of the app, for as long as someone
 * is signed in).
 *
 * This is the canonical Firebase presence pattern:
 *  - `.info/connected` is a special RTDB path that reflects the actual
 *    client-server socket connection state — not something we set.
 *  - Whenever we (re)connect, we queue an `onDisconnect().set(...)` that
 *    the RTDB SERVER will run the moment it detects we've disconnected
 *    (clean close, crash, lost network — all of it), then we mark
 *    ourselves online.
 *  - This means offline status is enforced by Firebase's servers, not by
 *    our own client-side cleanup code, which is what makes it genuine
 *    rather than "assume online until told otherwise."
 *
 * Data shape written to `status/{uid}`:
 *   { state: 'online' | 'offline', lastChanged: <server timestamp> }
 */
export function usePresence(uid) {
  useEffect(() => {
    if (!uid) return undefined;

    const statusRef = ref(rtdb, `status/${uid}`);
    const connectedRef = ref(rtdb, '.info/connected');

    const unsub = onValue(
      connectedRef,
      (snap) => {
        if (snap.val() === false) return;
        // Queue the offline write on the SERVER first, so it fires even if
        // our own JS never gets to run again (crash, network loss, etc.).
        onDisconnect(statusRef).set({ state: 'offline', lastChanged: rtdbServerTimestamp() })
          .then(() => {
            set(statusRef, { state: 'online', lastChanged: rtdbServerTimestamp() });
          })
          .catch((err) => console.error('presence: failed to set up onDisconnect', err));
      },
      (err) => console.error('presence: .info/connected listener failed (check Realtime Database rules are published)', err),
    );

    return () => unsub();
  }, [uid]);
}

/**
 * Subscribes to another user's genuine status. Returns
 * { state: 'online'|'offline'|null, lastChanged: number|null }.
 */
export function useUserStatus(uid, onChange) {
  useEffect(() => {
    if (!uid) return undefined;
    const statusRef = ref(rtdb, `status/${uid}`);
    return onValue(statusRef, (snap) => {
      onChange(snap.exists() ? snap.val() : { state: 'offline', lastChanged: null });
    });
  }, [uid, onChange]);
}
