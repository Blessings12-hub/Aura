import { useEffect, useState } from 'react';
import { ensureAnonymousSession } from '../lib/appwriteClient';

export function useAuthUid() {
  const [uid, setUid] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    ensureAnonymousSession()
      .then((session) => {
        if (active) setUid(session.$id);
      })
      .catch((error) => console.error('Appwrite session failed', error))
      .finally(() => {
        if (active) setReady(true);
      });
    return () => { active = false; };
  }, []);

  return { uid, ready };
}
