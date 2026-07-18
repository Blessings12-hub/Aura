import { useEffect, useState } from 'react';
import { usePresence } from '../hooks/usePresence';
import IncomingRequestWatcher from '../components/IncomingRequestWatcher';
import { recordAppStreak } from '../lib/streak';

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

  // General "used Aura today" streak — separate from the Daily Question
  // streak, and deliberately placed here rather than in any one activity
  // page, since this component already mounts once per session no matter
  // which activity someone opens (or none at all). The function itself
  // dedupes to once per calendar day, so this is safe to call on every
  // mount without extra guarding here.
  useEffect(() => {
    if (!uid) return;
    recordAppStreak(uid).catch((err) => console.error('app streak update failed', err));
  }, [uid]);

  return (
    <>
      <IncomingRequestWatcher userId={uid} />
      {children}
    </>
  );
}
