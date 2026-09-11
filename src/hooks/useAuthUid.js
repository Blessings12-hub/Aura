import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { auth } from '../firebase';

export function useAuthUid() {
  const [uid, setUid] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUid(user.uid);
        setReady(true);
      } else {
        try {
          const cred = await signInAnonymously(auth);
          setUid(cred.user.uid);
        } catch (e) {
          console.error('anon signin failed', e);
        }
        setReady(true);
      }
    });
    return () => unsub();
  }, []);

  return { uid, ready };
}
