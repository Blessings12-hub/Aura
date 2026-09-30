// api/export-account.js
//
// Companion to delete-account.js, and the other half of the same gap:
// AccountSettings.jsx's export only ever covered the account profile and
// Match Finder identity/cards, with an honest note in its own code that
// it excluded every message the person ever sent. This gathers the same
// full set of "everything this uid touched" that delete-account.js
// deletes — same queries, same collectionGroup reach across every chat
// surface — and returns it as one JSON document instead of removing it.
// See delete-account.js for the fuller explanation of why this lives
// here as a Vercel function (firebase-admin, bypassing firestore.rules)
// rather than a Firebase Cloud Function.
//
// Deliberately read-only: nothing here writes or deletes anything.

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
    console.error('Firebase admin init failed in export-account.js', err);
  }
}
const db = initError ? null : getFirestore();

// Firestore Timestamp fields serialize to JSON as opaque {_seconds,
// _nanoseconds} objects otherwise — this walks the plain-object tree
// (Timestamps aside, everything here is already plain JSON-safe data:
// strings, numbers, booleans, arrays, nested maps) and converts any
// Timestamp instance to a readable ISO string instead.
function serializeTimestamps(value) {
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serializeTimestamps);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serializeTimestamps(v)]));
  }
  return value;
}

const docsToJson = (snap) => snap.docs.map((d) => ({ id: d.id, path: d.ref.path, ...serializeTimestamps(d.data()) }));

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
    const [
      userSnap, identitySnap,
      matchCardsSnap, skillSwapsSnap, eventBuddySnap, lettersSnap,
      matchPairsASnap, matchPairsBSnap, swapPairsASnap, swapPairsBSnap,
      eventJoinsSnap,
      messagesSnap, answersSnap,
    ] = await Promise.all([
      db.doc(`users/${uid}`).get(),
      db.doc(`userIdentities/${uid}`).get(),
      db.collection('matchProfiles').where('userId', '==', uid).get(),
      db.collection('skillSwaps').where('userId', '==', uid).get(),
      db.collection('eventBuddy').where('userId', '==', uid).get(),
      db.collection('letters').where('authorId', '==', uid).get(),
      db.collection('matchPairs').where('userA', '==', uid).get(),
      db.collection('matchPairs').where('userB', '==', uid).get(),
      db.collection('swapPairs').where('userA', '==', uid).get(),
      db.collection('swapPairs').where('userB', '==', uid).get(),
      db.collection('eventJoins').where('userIds', 'array-contains', uid).get(),
      db.collectionGroup('messages').where('userId', '==', uid).get(),
      db.collectionGroup('answers').where('userId', '==', uid).get(),
    ]);

    res.status(200).json({
      exportedAt: new Date().toISOString(),
      account: userSnap.exists ? serializeTimestamps(userSnap.data()) : null,
      matchIdentity: identitySnap.exists ? serializeTimestamps(identitySnap.data()) : null,
      matchProfileCards: docsToJson(matchCardsSnap),
      skillSwapListings: docsToJson(skillSwapsSnap),
      eventBuddyListings: docsToJson(eventBuddySnap),
      lettersWritten: docsToJson(lettersSnap),
      matchPairs: [...docsToJson(matchPairsASnap), ...docsToJson(matchPairsBSnap)],
      swapPairs: [...docsToJson(swapPairsASnap), ...docsToJson(swapPairsBSnap)],
      eventJoins: docsToJson(eventJoinsSnap),
      // Every message/answer this uid ever sent, across Mood Chat, Daily
      // Question, and every 1:1 match/swap/event chat — `path` on each
      // entry tells you which room/thread it came from (e.g.
      // "chats/happy/messages/abc123" or "matchChats/uidA_uidB/messages/xyz").
      messagesSent: docsToJson(messagesSnap),
      dailyQuestionAnswers: docsToJson(answersSnap),
      note: 'This is everything Aura has stored under your account: your profile, Match Finder identity/cards, Skill Swap and Event Buddy listings, Letters you wrote, match/swap pairings, event joins, and every message or answer you sent across every activity.',
    });
  } catch (err) {
    console.error('export-account failed', err);
    res.status(500).json({ error: 'Could not gather your data. Please try again.' });
  }
}
