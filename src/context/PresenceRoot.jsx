import { useEffect, useState } from 'react';
import { useAuthUid } from '../hooks/useAuthUid';
import { usePresence } from '../hooks/usePresence';
import IncomingRequestWatcher from '../components/IncomingRequestWatcher';
import { recordAppStreak } from '../lib/streak';
import { signOutFirebase } from '../lib/firebaseClient';
import { doc, getDoc, COLLECTIONS, db } from '../lib/firestoreClient';

export default function PresenceRoot({ children }) {
  const { uid } = useAuthUid();
  const [banInfo, setBanInfo] = useState(null);

  usePresence(uid);

  useEffect(() => {
    if (!uid) return;
    recordAppStreak(uid).catch((err) => console.error('app streak update failed', err));
  }, [uid]);

  useEffect(() => {
    if (!uid) { setBanInfo(null); return undefined; }
    let active = true;
    const readBan = async () => {
      try {
        const snap = await getDoc(doc(db, COLLECTIONS.users, uid));
        const profile = snap.exists() ? snap.data() : null;
        if (active) setBanInfo(profile?.banned === true ? { reason: profile.banReason || null } : null);
      } catch (error) {
        if (active) console.error('ban status lookup failed', error);
      }
    };
    readBan();
    const timer = window.setInterval(readBan, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [uid]);

  if (banInfo) {
    return (
      <div className="aura-page" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', textAlign: 'center', padding: 24 }}>
        <div>
          <h1 style={{ marginBottom: 8 }}>This account has been suspended</h1>
          <p className="aura-muted">{banInfo.reason || "This account was suspended for violating Aura's community guidelines."}</p>
          <button type="button" className="aura-btn aura-btn-secondary" style={{ marginTop: 16 }} onClick={async () => { await signOutFirebase(); window.location.href = '/'; }}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return <><IncomingRequestWatcher userId={uid} />{children}</>;
}
