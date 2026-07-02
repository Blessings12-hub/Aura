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

  useEffect(() => {
    if (!roomId || !uid) return undefined;
    const memberRef = ref(rtdb, `roomPresence/${roomId}/${uid}`);
    const roomRef = ref(rtdb, `roomPresence/${roomId}`);

    onDisconnect(memberRef).remove().then(() => {
      set(memberRef, { ...meta, joinedAt: rtdbServerTimestamp() });
    });

    const unsub = onValue(roomRef, (snap) => {
      setMembers(snap.exists() ? snap.val() : {});
    });

    return () => {
      unsub();
      remove(memberRef);
    };
    // meta is intentionally not in deps — we don't want to re-join the room
    // every time avatarColor/etc. re-renders with a new object reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, uid]);

  const count = Object.keys(members).length;
  return { members, count };
}
