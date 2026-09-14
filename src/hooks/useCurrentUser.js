import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentFirebaseUser } from '../lib/firebaseClient';
import {
  doc, getDoc, onSnapshot, COLLECTIONS, db,
} from '../lib/firestoreClient';

export function useCurrentUser({ redirectIfMissing = true } = {}) {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    let unsubscribe;
    let active = true;
    async function load() {
      try {
        const account = await getCurrentFirebaseUser();
        if (!account) throw new Error('No Firebase session');
        if (!active) return;
        setUserId(account.$id);
        const ref = doc(db, COLLECTIONS.users, account.$id);
        const apply = (snap) => {
          if (!active) return;
          if (!snap.exists()) {
            setUser(null);
            setLoading(false);
            if (redirectIfMissing) navigate('/login', { replace: true });
            return;
          }
          setUser({ id: snap.id, ...snap.data() });
          setLoading(false);
        };
        try {
          apply(await getDoc(ref));
        } catch (error) {
          setUser(null);
          setLoading(false);
          if (redirectIfMissing) navigate('/login', { replace: true });
        }
        unsubscribe = onSnapshot(ref, apply, setAuthError);
      } catch (error) {
        if (!active) return;
        setAuthError(error);
        setLoading(false);
        if (redirectIfMissing) navigate('/login', { replace: true });
      }
    }
    load();
    return () => { active = false; unsubscribe?.(); };
  }, [navigate, redirectIfMissing]);

  return { user, userId, loading, authError };
}
