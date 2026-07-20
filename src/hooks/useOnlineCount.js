import { useEffect, useState } from 'react';
import { ref, onValue } from 'firebase/database';
import { rtdb } from '../firebase';

/**
 * Live count of everyone currently online across the whole app — not
 * scoped to any one activity/room (see useRoomPresence for that). Reads
 * the same status/{uid} tree usePresence() writes to, counting entries
 * whose state is 'online'.
 *
 * Needs database.rules.json to grant .read at the status PARENT level,
 * not just per-uid — reading/counting the whole list is a different
 * permission from reading your own single entry, and RTDB rules don't
 * infer one from the other.
 */
export function useOnlineCount() {
  const [count, setCount] = useState(null); // null = still loading, not "zero"

  useEffect(() => {
    const statusRef = ref(rtdb, 'status');
    const unsub = onValue(
      statusRef,
      (snap) => {
        if (!snap.exists()) { setCount(0); return; }
        let online = 0;
        snap.forEach((child) => {
          if (child.val()?.state === 'online') online += 1;
        });
        setCount(online);
      },
      (err) => {
        // Almost always means database.rules.json's .read at the status
        // level hasn't been published yet — fails closed to "don't show
        // a count" rather than showing a misleading 0.
        console.error('online count: failed to read presence (check database.rules.json is published)', err);
        setCount(null);
      },
    );
    return () => unsub();
  }, []);

  return count;
}
