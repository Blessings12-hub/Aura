import { useEffect, useState } from 'react';
import { usePresence } from '../hooks/usePresence';

export default function PresenceRoot({ children }) {
  const [uid, setUid] = useState(() => localStorage.getItem('aura_userId'));

  // Login writes aura_userId to localStorage after sign-in; this listens
  // for that so presence starts as soon as a session exists, without
  // needing every page to wire this up individually.
  useEffect(() => {
    const check = () => setUid(localStorage.getItem('aura_userId'));
    const interval = setInterval(check, 1500);
    window.addEventListener('storage', check);
    return () => { clearInterval(interval); window.removeEventListener('storage', check); };
  }, []);

  usePresence(uid);

  return children;
}
