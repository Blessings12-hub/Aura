import { useEffect, useState } from 'react';
import { ensureFirebaseSession } from '../lib/firebaseClient';
import { useAuthContext } from '../context/AuthGate';

// Reads the one session AuthGate already established. The old version called
// ensureFirebaseSession() itself from inside every component that used it,
// which was one of the callers racing to sign in at the same moment.
//
// The fallback effect below only does anything if this hook is somehow used
// outside AuthGate — and even then ensureFirebaseSession() is now deduped, so
// it joins the existing sign-in rather than starting a competing one.
export function useAuthUid() {
  const ctx = useAuthContext();
  const [fallbackUid, setFallbackUid] = useState(null);
  const [fallbackReady, setFallbackReady] = useState(false);
  const insideGate = ctx.ready || ctx.uid !== null;

  useEffect(() => {
    if (insideGate) return undefined;
    let active = true;
    ensureFirebaseSession()
      .then((user) => { if (active) setFallbackUid(user?.uid || null); })
      .catch((error) => console.error('Firebase session failed', error))
      .finally(() => { if (active) setFallbackReady(true); });
    return () => { active = false; };
  }, [insideGate]);

  if (insideGate) return { uid: ctx.uid, ready: ctx.ready };
  return { uid: fallbackUid, ready: fallbackReady };
}
