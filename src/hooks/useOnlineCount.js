import { useEffect, useState } from 'react';
import { APPWRITE_COLLECTIONS, Query, databases, databaseId, requireAppwrite } from '../lib/appwriteClient';

const ONLINE_WINDOW_MS = 75_000;

export function useOnlineCount() {
  const [count, setCount] = useState(null);
  useEffect(() => {
    let active = true;
    const read = async () => {
      try {
        requireAppwrite();
        const result = await databases.listDocuments(databaseId, APPWRITE_COLLECTIONS.presence, [Query.limit(500)]);
        const cutoff = Date.now() - ONLINE_WINDOW_MS;
        const online = result.documents.filter((item) => item.state === 'online' && Number(item.lastChanged) >= cutoff).length;
        if (active) setCount(online);
      } catch (error) {
        if (active) {
          console.error('online count: failed to read Appwrite presence', error);
          setCount(null);
        }
      }
    };
    read();
    const timer = window.setInterval(read, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  return count;
}
