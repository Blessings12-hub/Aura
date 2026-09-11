import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { databases, databaseId, APPWRITE_COLLECTIONS, getCurrentAccount, subscribeToDocument } from '../lib/appwriteClient';

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
        const account = await getCurrentAccount();
        if (!account) throw new Error('No Appwrite session');
        if (!active) return;
        setUserId(account.$id);
        const apply = (document) => {
          if (!active) return;
          setUser({ id: document.$id, ...document });
          setLoading(false);
        };
        try {
          const document = await databases.getDocument(databaseId, APPWRITE_COLLECTIONS.users, account.$id);
          apply(document);
        } catch (error) {
          setUser(null);
          setLoading(false);
          if (redirectIfMissing) navigate('/login', { replace: true });
        }
        unsubscribe = subscribeToDocument(APPWRITE_COLLECTIONS.users, account.$id, apply, setAuthError);
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
