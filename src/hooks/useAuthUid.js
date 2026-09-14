import { useEffect, useState } from 'react';
import { ensureFirebaseSession } from '../lib/firebaseClient';

export function useAuthUid() {
  const [uid, setUid] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    ensureFirebaseSession()
      .then((user) => {
        if (active) setUid(user.uid);
      })
      .catch((error) => console.error('Firebase session failed', error))
      .finally(() => {
        if (active) setReady(true);
      });
    return () => { active = false; };
  }, []);

  return { uid, ready };
}
