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
        localStorage.setItem('aura_userId', user.uid);
        setReady(true);
      } else {
        const stored = localStorage.getItem('aura_userId');
        if (stored) {
          // Anonymous session expired or new device — sign back in anonymously,
          // but we don't migrate data here; new uid is fine for an anonymous app.
        }
        try {
          const cred = await signInAnonymously(auth);
          setUid(cred.user.uid);
          localStorage.setItem('aura_userId', cred.user.uid);
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