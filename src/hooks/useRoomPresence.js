import { useEffect, useState } from 'react';
import { ref, onValue, onDisconnect, set, remove, serverTimestamp as rtdbServerTimestamp } from 'firebase/database';
import { rtdb } from '../firebase';

/**
 * Joins `roomId` as genuinely present for as long as this hook stays
 * mounted, and returns the live count + list of who else is in the room
 * right now. Membership is removed server-side on disconnect (crash,
 * closed tab, lost network), via onDisconnect().remove() — not just when
 * our own cleanup code runs.
 *
 * roomId should be a safe RTDB key: no '.', '#', '$', '[', ']', or '/'.
 */
export function useRoomPresence(roomId, uid, meta = {}) {
  const [members, setMembers] = useState({});
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!roomId || !uid) return undefined;
    setError(null);
    const memberRef = ref(rtdb, `roomPresence/${roomId}/${uid}`);
    const roomRef = ref(rtdb, `roomPresence/${roomId}`);

    onDisconnect(memberRef).remove()
      .then(() => set(memberRef, { ...meta, joinedAt: rtdbServerTimestamp() }))
      .catch((err) => {
        // Almost always means database.rules.json was never deployed (or
        // Realtime Database isn't enabled for this project yet) — a fresh
        // RTDB instance denies everything by default. This used to only
        // log to the console, so the online count just silently sat at 0
        // forever with no hint why.
        console.error('room presence: failed to join room (check Realtime Database rules are published)', err);
        setError(err?.code || 'unknown');
      });

    const unsub = onValue(
      roomRef,
      (snap) => setMembers(snap.exists() ? snap.val() : {}),
      (err) => {
        console.error('room presence: room listener failed (check Realtime Database rules are published)', err);
        setError(err?.code || 'unknown');
      },
    );

    return () => {
      unsub();
      remove(memberRef);
    };
    // meta is intentionally not in deps — we don't want to re-join the room
    // every time avatarColor/etc. re-renders with a new object reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, uid]);

  const count = Object.keys(members).length;
  return {
    members, count, error,
  };
}
