import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthUid } from './useAuthUid';
import {
  doc, onSnapshot, COLLECTIONS, db,
} from '../lib/firestoreClient';
import { logUnlessCancelled, isCancellation } from '../lib/quietErrors';

// ---------------------------------------------------------------------------
// What changed here and why
//
// Before: this hook called getCurrentFirebaseUser() itself on every page
// mount. That meant a fresh sign-in attempt per screen, racing PresenceRoot
// and Login — the abort storm. It then did a getDoc() AND an onSnapshot() on
// the same document, so the one-off read was frequently still in flight when
// the component unmounted (or when StrictMode discarded the first mount),
// producing another "The user aborted a request."
//
// After: the uid comes from AuthGate, which has already finished signing in,
// so there is nothing to race. A single onSnapshot does both jobs — its first
// callback fires with the current document, exactly what the getDoc was for.
// Its return value is the same shape as before, so no page needs editing.
// ---------------------------------------------------------------------------
export function useCurrentUser({ redirectIfMissing = true } = {}) {
  const navigate = useNavigate();
  const { uid, ready } = useAuthUid();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    // Auth hasn't settled yet — stay in the loading state rather than reading
    // Firestore with no uid, which security rules would reject.
    if (!ready) return undefined;

    if (!uid) {
      setUser(null);
      setLoading(false);
      if (redirectIfMissing) navigate('/login', { replace: true });
      return undefined;
    }

    let active = true;
    const ref = doc(db, COLLECTIONS.users, uid);

    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        if (!active) return;
        if (!snap.exists()) {
          setUser(null);
          setLoading(false);
          if (redirectIfMissing) navigate('/login', { replace: true });
          return;
        }
        setUser({ id: snap.id, ...snap.data() });
        setLoading(false);
      },
      (error) => {
        if (!active || isCancellation(error)) return;
        logUnlessCancelled('profile subscription failed', error);
        setAuthError(error);
        setLoading(false);
        if (redirectIfMissing) navigate('/login', { replace: true });
      },
    );

    return () => { active = false; unsubscribe(); };
  }, [uid, ready, navigate, redirectIfMissing]);

  return { user, userId: uid, loading: loading || !ready, authError };
}
