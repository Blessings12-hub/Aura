import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Loads the current user's profile from Firestore, requires that they've completed login.
 * If no `aura_userId` is in localStorage, redirects to '/'.
 */
export function useCurrentUser({ redirectIfMissing = true } = {}) {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedId = localStorage.getItem('aura_userId');
    if (!storedId) {
      if (redirectIfMissing) navigate('/');
      setLoading(false);
      return undefined;
    }
    setUserId(storedId);
    const unsub = onSnapshot(doc(db, 'users', storedId), (snap) => {
      if (!snap.exists()) {
        if (redirectIfMissing) navigate('/');
        setUser(null);
      } else {
        setUser({ id: snap.id, ...snap.data() });
      }
      setLoading(false);
    });
    return () => unsub();
  }, [navigate, redirectIfMissing]);

  return { user, userId, loading };
}