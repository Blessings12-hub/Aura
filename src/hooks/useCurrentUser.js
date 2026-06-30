import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Loads the current user's profile from Firestore.
 *
 * Replaces the `loadUser` useEffect that was copy-pasted across every page.
 * If no `aura_userId` is in localStorage, the user is redirected to login.
 *
 * @returns {{ user: object | null, userId: string | null, loading: boolean }}
 */
export function useCurrentUser() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const storedId = localStorage.getItem('aura_userId');
      if (!storedId) {
        navigate('/');
        return;
      }

      const snap = await getDoc(doc(db, 'users', storedId));
      if (cancelled) return;

      if (!snap.exists()) {
        navigate('/');
        return;
      }

      setUserId(storedId);
      setUser(snap.data());
      setLoading(false);
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return { user, userId, loading };
}