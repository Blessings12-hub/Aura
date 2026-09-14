import { useEffect, useState } from 'react';
import { doc, getDoc } from '../lib/firestoreClient';
import { db } from '../lib/firestoreClient';

// Checks for an /admins/{uid} doc for the current user. There's no
// self-service way to get one — see the comment on the admins collection
// in firestore.rules. A non-admin gets `false` (the getDoc simply comes
// back not-found, not an error, since the rule allows a user to check
// their own doc either way).
export function useIsAdmin(userId) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!userId) { setIsAdmin(false); setChecked(true); return; }
    let cancelled = false;
    getDoc(doc(db, 'admins', userId))
      .then((snap) => { if (!cancelled) setIsAdmin(snap.exists()); })
      .catch(() => { if (!cancelled) setIsAdmin(false); })
      .finally(() => { if (!cancelled) setChecked(true); });
    return () => { cancelled = true; };
  }, [userId]);

  return { isAdmin, checked };
}
