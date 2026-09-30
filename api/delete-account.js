// api/delete-account.js
//
// Found during a readiness review: AccountSettings.jsx's delete flow only
// ever removed users/{uid}, userIdentities/{uid}, pushTokens/{uid}, and
// the caller's own matchProfiles cards — client-side, using the caller's
// own ID token. Everything else a person leaves behind (Skill Swap and
// Event Buddy listings, Letters they wrote, matchPairs/swapPairs,
// eventJoins, and every message they ever sent across Mood Chat, Daily
// Question, and every 1:1 chat) stayed in Firestore forever. The code's
// own comment on this was honest about the gap: "a true full erasure of
// that needs a server-side Cloud Function... that's a real, separate,
// larger piece of work, not something to fake here." This is that piece
// of work — as a Vercel function using firebase-admin, matching how every
// other server-side piece of Aura is built (see send-notification.js),
// not an actual Firebase Cloud Function, which would need the paid Blaze
// plan this project deliberately avoids everywhere else.
//
// Runs as the ADMIN SDK, which bypasses firestore.rules entirely — that's
// the whole point, since a lot of what needs deleting here (someone
// else's matchChats message the caller sent, an eventJoins doc another
// person owns updates on) isn't something the caller's own client-side
// credentials could reach anyway. The ID token check below is what keeps
// this a genuine self-service "delete MY account" and not an open door:
// it proves who's asking, and the uid it decodes to is the ONLY uid this
// ever acts on — there is no uid field read from the request body.
//
// SETUP: same FIREBASE_SERVICE_ACCOUNT env var as send-notification.js
// and verify-submission.js — nothing additional to configure.
//
// A NOTE ON COST/SCALE, worth knowing before this runs against a real
// user base: collectionGroup queries against 'messages' and 'answers'
// need composite/collection-group indexes to exist (added in
// firestore.indexes.json — deploy indexes before this ever runs, or the
// collectionGroup() calls below throw with a link to create them
// on-the-fly instead). For an account with a genuinely large message
// history this could mean thousands of individual document deletes,
// batched in chunks of 500 (Firestore's hard batch limit) — slow, but
// correctness matters more than speed for "erase everything" and this
// still comfortably fits inside a normal Vercel function timeout at
// Aura's current scale. If that ever stops being true, this is the file
// to revisit.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

let initError = null;
if (!getApps().length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({ credential: cert(serviceAccount) });
  } catch (err) {
    initError = err;
    console.error('Firebase admin init failed in delete-account.js', err);
  }
}
const db = initError ? null : getFirestore();

// Firestore batch writes cap at 500 operations. Deletes are queued here
// and flushed in chunks rather than one batch per collection, so a
// person with (say) 50 matchProfiles-cleanup-worthy docs and 3,000
// messages still gets everything removed correctly instead of the 500th
// operation onward silently failing.
async function flushInChunks(refs) {
  for (let i = 0; i < refs.length; i += 500) {
    const batch = db.batch();
    for (const ref of refs.slice(i, i + 500)) batch.delete(ref);
    await batch.commit();
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (initError || !db) {
    res.status(500).json({ error: 'Server not configured' });
    return;
  }

  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) {
    res.status(401).json({ error: 'Missing auth token' });
    return;
  }
  let uid;
  try {
    ({ uid } = await getAuth().verifyIdToken(idToken));
  } catch {
    res.status(401).json({ error: 'Invalid auth token' });
    return;
  }

  try {
    const refsToDelete = [
      db.doc(`users/${uid}`),
      db.doc(`userIdentities/${uid}`),
      db.doc(`pushTokens/${uid}`),
      db.doc(`verificationRequests/${uid}`),
      db.doc(`verificationImages/${uid}`),
    ];

    // Owned public cards/listings — one query each, by the field each
    // collection actually uses for ownership (see firestore.rules).
    const ownedQueries = [
      db.collection('matchProfiles').where('userId', '==', uid),
      db.collection('skillSwaps').where('userId', '==', uid),
      db.collection('eventBuddy').where('userId', '==', uid),
      db.collection('letters').where('authorId', '==', uid),
    ];
    // Pair docs are id'd by two participants, neither of which is
    // guaranteed to be "first" — each needs both a userA and a userB
    // query, since Firestore can't OR across two different fields in one
    // query the way this needs.
    const pairQueries = [
      db.collection('matchPairs').where('userA', '==', uid),
      db.collection('matchPairs').where('userB', '==', uid),
      db.collection('swapPairs').where('userA', '==', uid),
      db.collection('swapPairs').where('userB', '==', uid),
    ];
    const joinQuery = db.collection('eventJoins').where('userIds', 'array-contains', uid);

    // Every message/answer this person ever sent, anywhere — matchChats,
    // swapChats, eventChats, and Mood Chat all name their subcollection
    // 'messages'; Daily Question names its 'answers'. A collectionGroup
    // query reaches every one of those subcollections regardless of
    // which mood/day/pairId/eventId parent it lives under.
    const groupQueries = [
      db.collectionGroup('messages').where('userId', '==', uid),
      db.collectionGroup('answers').where('userId', '==', uid),
    ];

    // userStickers/{uid}/items/{stickerId} is a direct subcollection of
    // this exact uid, not something a collectionGroup query is needed
    // for — listDocuments() gets every ref without reading each doc's
    // (potentially large, base64) content just to delete it.
    const stickerRefsPromise = db.collection('userStickers').doc(uid).collection('items').listDocuments();

    const [ownedSnaps, pairSnaps, joinSnap, groupSnaps, stickerRefs] = await Promise.all([
      Promise.all(ownedQueries.map((q) => q.get())),
      Promise.all(pairQueries.map((q) => q.get())),
      joinQuery.get(),
      Promise.all(groupQueries.map((q) => q.get())),
      stickerRefsPromise,
    ]);

    for (const snap of ownedSnaps) refsToDelete.push(...snap.docs.map((d) => d.ref));
    for (const snap of pairSnaps) refsToDelete.push(...snap.docs.map((d) => d.ref));
    refsToDelete.push(...joinSnap.docs.map((d) => d.ref));
    for (const snap of groupSnaps) refsToDelete.push(...snap.docs.map((d) => d.ref));
    refsToDelete.push(...stickerRefs);

    await flushInChunks(refsToDelete);

    // Auth user last, only after every Firestore doc is confirmed gone —
    // if something above throws, the account (and the ability to retry
    // this whole request) still exists rather than leaving someone
    // signed out with data still stranded behind them.
    await getAuth().deleteUser(uid);

    res.status(200).json({ deleted: true, documentsDeleted: refsToDelete.length });
  } catch (err) {
    console.error('delete-account failed', err);
    res.status(500).json({ error: 'Account deletion failed partway through. Nothing further was changed — please try again.' });
  }
}
