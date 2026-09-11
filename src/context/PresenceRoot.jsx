import { useEffect, useState } from 'react';
import { useAuthUid } from '../hooks/useAuthUid';
import { doc, onSnapshot } from 'firebase/firestore';
import { usePresence } from '../hooks/usePresence';
import IncomingRequestWatcher from '../components/IncomingRequestWatcher';
import { recordAppStreak } from '../lib/streak';
import { db, auth } from '../firebase';

export default function PresenceRoot({ children }) {
  const { uid } = useAuthUid();
  const [banInfo, setBanInfo] = useState(null);

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

  // This is the PRIMARY enforcement point for a ban — not any one
  // activity page. firestore.rules also blocks banned users from posting
  // in Mood Chat and Match Finder specifically (the highest-risk
  // surfaces), as defense-in-depth against someone hitting the API
  // directly, but the actual "you can't use Aura at all" experience for a
  // normal user comes from here: one live check, mounted once, wrapping
  // every route.
  useEffect(() => {
    if (!uid) { setBanInfo(null); return undefined; }
    const unsub = onSnapshot(doc(db, 'users', uid), (snap) => {
      const data = snap.data();
      setBanInfo(data?.banned === true ? { reason: data.banReason || null } : null);
    });
    return () => unsub();
  }, [uid]);

  if (banInfo) {
    return (
      <div className="aura-page" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', textAlign: 'center', padding: 24 }}>
        <div>
          <h1 style={{ marginBottom: 8 }}>This account has been suspended</h1>
          <p className="aura-muted">
            {banInfo.reason || 'This account was suspended for violating Aura\'s community guidelines.'}
          </p>
          <button
            type="button"
            className="aura-btn aura-btn-secondary"
            style={{ marginTop: 16 }}
            onClick={async () => { await auth.signOut(); window.location.href = '/'; }}
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <IncomingRequestWatcher userId={uid} />
      {children}
    </>
  );
}
