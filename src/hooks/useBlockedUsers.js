import { useEffect, useState } from 'react';
import { subscribeBlockedUsers } from '../lib/blocking';

// Returns a Set<string> of uids the current user has blocked, kept live.
// Every list/feed in the app filters against this so a blocked person
// disappears immediately, everywhere, without needing a page refresh.
export function useBlockedUsers(userId) {
  const [blocked, setBlocked] = useState(new Set());
  useEffect(() => {
    const unsub = subscribeBlockedUsers(userId, setBlocked);
    return () => unsub();
  }, [userId]);
  return blocked;
}
