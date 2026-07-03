import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../firebase';

/**
 * Loads the current user's profile from Firestore.
 *
 * IMPORTANT: this waits for Firebase Auth's session-restoration to actually
 * complete (via onAuthStateChanged) before touching Firestore at all. Every
 * Firestore security rule in this app requires request.auth != null — if we
 * query before Auth has restored the persisted anonymous session (which is
 * inherently asynchronous and does not complete instantly, especially on a
 * slow connection or first paint), the read gets rejected as unauthenticated.
 * The previous version of this hook read `localStorage.getItem('aura_userId')`
 * and queried Firestore immediately, with no error handling on the
 * subscription — so that race condition would leave the whole app stuck on
 * `loading: true` forever, silently, on essentially every return visit.
 */
export function useCurrentUser({ redirectIfMissing = true } = {}) {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const redirectedRef = useRef(false);

  useEffect(() => {
    let unsubDoc;

    const unsubAuth = onAuthStateChanged(auth, async (fbUser) => {
      let uid = fbUser?.uid || null;

      if (!uid) {
        // No active Firebase Auth session. If we previously had one (uid
        // stored locally) it has expired or this is a new device/browser —
        // re-establish an anonymous session rather than getting stuck.
        try {
          const cred = await signInAnonymously(auth);
          uid = cred.user.uid;
        } catch (e) {
          console.error('anonymous sign-in failed', e);
          setAuthError(e);
          setLoading(false);
          if (redirectIfMissing && !redirectedRef.current) { redirectedRef.current = true; navigate('/'); }
          return;
        }
      }

      localStorage.setItem('aura_userId', uid);
      setUserId(uid);

      if (unsubDoc) unsubDoc();
      unsubDoc = onSnapshot(
        doc(db, 'users', uid),
        (snap) => {
          if (!snap.exists()) {
            // Auth session exists but no profile doc yet (e.g. mid-signup,
            // or a stale/orphaned uid) — send back to Login rather than
            // hanging forever on a user object that will never arrive.
            setUser(null);
            setLoading(false);
            if (redirectIfMissing && !redirectedRef.current) { redirectedRef.current = true; navigate('/'); }
          } else {
            setUser({ id: snap.id, ...snap.data() });
            setLoading(false);
          }
        },
        (err) => {
          // THIS was the missing piece: without an error handler, a
          // permission-denied (or any other) failure here left `loading`
          // stuck at `true` forever with no way to recover or even see
          // what went wrong.
          console.error('useCurrentUser: user doc subscription failed', err);
          setAuthError(err);
          setLoading(false);
        },
      );
    });

    return () => { unsubAuth(); if (unsubDoc) unsubDoc(); };
  }, [navigate, redirectIfMissing]);

  return { user, userId, loading, authError };
}
