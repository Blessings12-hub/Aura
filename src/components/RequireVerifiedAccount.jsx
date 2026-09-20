// src/components/RequireVerifiedAccount.jsx
//
// TIGHTENED, per explicit request: verification is no longer scoped to
// Match Finder. Every route wrapped in this — everything in App.jsx except
// Account Settings and Admin Reports (see the note there) — requires both
// a users/{uid} profile AND an approved, unexpired verification. Without
// this, someone could reach any page directly (a bookmark, a shared link,
// browser back/forward) and skip Login.jsx's own check entirely, since
// that check only runs when Login itself mounts.
//
// This mirrors the same two conditions Login.jsx's bootstrap check already
// uses (profile exists, verificationStatus === 'approved' && not expired),
// just enforced centrally so there's exactly one place this logic lives
// for routing purposes, and live — an approval that lands while someone is
// sitting on a page they got to before verifying (unlikely but possible:
// they had a stale tab open) unblocks it without a manual reload.
import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { observeFirebaseAuth } from '../lib/firebaseClient';
import { doc, onSnapshot, COLLECTIONS, db } from '../lib/firestoreClient';
import PageSkeleton from './PageSkeleton';

function isVerified(profile) {
  if (!profile) return false;
  const expiresAt = profile.verificationExpiresAt;
  const expiresMs = typeof expiresAt?.toMillis === 'function' ? expiresAt.toMillis() : Number(expiresAt || 0);
  return profile.verificationStatus === 'approved' && expiresMs > Date.now();
}

export default function RequireVerifiedAccount({ children }) {
  const location = useLocation();
  const [authUser, setAuthUser] = useState(undefined);
  // undefined = still loading, null = no profile doc yet
  const [profile, setProfile] = useState(undefined);

  useEffect(() => observeFirebaseAuth(setAuthUser), []);

  useEffect(() => {
    if (authUser === undefined) return undefined;
    if (!authUser) { setProfile(null); return undefined; }
    return onSnapshot(
      doc(db, COLLECTIONS.users, authUser.uid),
      (snap) => setProfile(snap.exists() ? snap.data() : null),
      () => setProfile(null),
    );
  }, [authUser]);

  if (authUser === undefined || profile === undefined) return <PageSkeleton />;
  if (!authUser) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  // No profile doc, or a profile that isn't verified — either way, Login.jsx
  // is where both signup and the verification step live now, so this
  // sends both cases to the same place. Login's own bootstrap check reads
  // the same document and decides which of those two states to show.
  if (!isVerified(profile)) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  return children;
}
