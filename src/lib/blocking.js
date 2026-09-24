// src/lib/blocking.js
//
// Block list and report submission for the app's safety feature. Every card
// list (Match Finder, Skill Swap, Event Buddy) and every group chat (Mood
// Chat, Event Chat, Daily Question, Collab Studio) filters against the
// blocked-uid set from subscribeBlockedUsers/useBlockedUsers, so blocking
// someone once hides them everywhere at once — not just on the screen the
// block button happened to be on.
import {
  collection, doc, setDoc, deleteDoc, onSnapshot, query, where, Timestamp,
  addDoc, COLLECTIONS, db,
} from './firestoreClient';
import { ensureFirebaseSession } from './firebaseClient';

const blockDocId = (blockerId, blockedId) => `${blockerId}_${blockedId}`;

export async function blockUser(blockerId, blockedId) {
  if (!blockerId || !blockedId || blockerId === blockedId) return;
  await setDoc(doc(db, 'blocks', blockDocId(blockerId, blockedId)), {
    blockerId, blockedId, createdAt: Timestamp.now(),
  });
}

export async function unblockUser(blockerId, blockedId) {
  if (!blockerId || !blockedId) return;
  await deleteDoc(doc(db, 'blocks', blockDocId(blockerId, blockedId)));
}

// context/contextId identify where the report was filed from (e.g.
// context: 'matchChat', contextId: the pairId) so a reviewer looking at the
// reports collection has enough to investigate without any extra reads.
// A reporter only ever needs to CREATE here, never read/update their own
// report — enforced in firestore.rules (create-only for non-admins).
export async function reportUser(reporterId, reportedId, { context, contextId, reason, details } = {}) {
  if (!reporterId || !reportedId || reportedId === reporterId || !reason) return;
  await addDoc(collection(db, COLLECTIONS.reports), {
    reporterId,
    reportedId,
    context: context || 'unknown',
    contextId: contextId || '',
    reason: reason.slice(0, 300),
    details: (details || '').slice(0, 1000),
    status: 'pending',
    createdAt: new Date().toISOString(),
    reviewedAt: '',
  });

  // FOUND IN A READINESS REVIEW: this report was already being written
  // correctly, but nothing ever told an admin it existed — Admin Reports
  // just sat there until someone happened to open it. This pings every
  // admin's device the moment a report lands, same pattern already used
  // for verification requests. Deliberately best-effort: the report
  // above is already safely saved by this point, so a failure here
  // (network hiccup, no admin has notifications enabled yet) should never
  // surface as an error to the person reporting — from where they're
  // standing, reporting someone already worked.
  try {
    const user = await ensureFirebaseSession();
    const idToken = await user?.getIdToken();
    if (idToken) {
      await fetch('/api/notify-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ reason, context: context || 'unknown' }),
      });
    }
  } catch (err) {
    console.error('report notification failed', err);
  }
}

// Live-subscribes to the uids the current user has blocked. onChange is
// called with a Set<string> every time the list changes.
export function subscribeBlockedUsers(userId, onChange) {
  if (!userId) { onChange(new Set()); return () => {}; }
  const q = query(collection(db, 'blocks'), where('blockerId', '==', userId));
  return onSnapshot(
    q,
    (snap) => onChange(new Set(snap.docs.map((d) => d.data().blockedId))),
    () => onChange(new Set()),
  );
}
