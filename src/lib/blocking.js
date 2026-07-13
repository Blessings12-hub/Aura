// src/lib/blocking.js
//
// Block list and report submission for the app's safety feature. Every card
// list (Match Finder, Skill Swap, Event Buddy) and every group chat (Mood
// Chat, Event Chat, Daily Question, Collab Studio) filters against the
// blocked-uid set from subscribeBlockedUsers/useBlockedUsers, so blocking
// someone once hides them everywhere at once — not just on the screen the
// block button happened to be on.
import {
  collection, doc, setDoc, deleteDoc, addDoc, onSnapshot, query, where, Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

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
export async function reportUser(reporterId, reportedId, { context, contextId, reason, details } = {}) {
  if (!reporterId || !reportedId || reportedId === reporterId || !reason) return;
  await addDoc(collection(db, 'reports'), {
    reporterId,
    reportedId,
    context: context || 'unknown',
    contextId: contextId || null,
    reason: reason.slice(0, 300),
    details: (details || '').slice(0, 1000),
    createdAt: Timestamp.now(),
  });
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
