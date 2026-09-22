// api/verify-submission.js
//
// Replaces api/verify-document.js and api/verify-selfie.js as the single
// entry point for Match Finder verification. Both of those are now dead
// code — nothing in the client calls them anymore — and can be deleted
// from the repo; they're left in place only in case you want the history.
//
// WHAT CHANGED AND WHY: verification used to have an instant AI fast path
// (a confident selfie alone could approve someone in seconds) with a
// document upload as the fallback for anything less clear. That's gone,
// on purpose. Every submission now requires BOTH a live selfie AND an ID
// document, together, and — this is the bigger change — nothing decides
// automatically at submission time anymore. This endpoint's only job is
// to take the submission, store it, and tell you about it. The decision
// comes from one of two places:
//   1. You, reviewing it by hand in Admin Reports (see AdminReports.jsx),
//      any time before the hour is up.
//   2. api/escalate-verifications.js, an hour later, if you haven't.
//
// IMAGE STORAGE — the real shift this patch makes: every verification
// piece built before this deliberately never stored an image anywhere,
// specifically so manual review couldn't happen (there was nothing to
// look at). That's reversed here, on your explicit request: both images
// are stored, base64, in verificationImages/{uid} — a separate collection
// from verificationRequests, admin-read-only, no client write access at
// all (see firestore.rules). They're temporary: a decision deletes them
// immediately (here's not where that happens — see AdminReports.jsx for
// the manual path, api/escalate-verifications.js for the automatic one
// and its cleanup), and anything older than 48h gets swept regardless, as
// a backstop.
//
// This does NOT use Firebase Storage, and deliberately so — Storage reads
// and writes require the paid Blaze plan, which this project has avoided
// everywhere else. Firestore itself is already free at this project's
// scale, so the images live there instead, as base64 fields on a plain
// document. The real constraint that comes with that: a Firestore
// document caps out at 1 MiB. See MAX_COMBINED_BYTES below for how that's
// guarded against.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

let initError = null;
if (!getApps().length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({ credential: cert(serviceAccount) });
  } catch (err) {
    initError = err;
    console.error('Firebase admin init failed in verify-submission.js', err);
  }
}
const db = initError ? null : getFirestore();

const MIN_VERIFY_AGE = 18;
const COOLDOWN_MS = 60_000;
const MAX_ATTEMPTS = 6;
const ALLOWED_GENDERS = ['Female', 'Male', 'Non-binary', 'Prefer not to say'];
// Firestore's hard ceiling is 1 MiB (1,048,576 bytes) PER DOCUMENT,
// including field names and every image's base64 text combined. Staying
// well under that — both for safety margin (Firestore's own bookkeeping
// overhead, base64's ~33% inflation over raw bytes) and because a bigger
// document costs more to read/write within Firestore's free quota too.
// The client (see verificationService.js) already compresses both images
// before this is ever called; this is the server-side backstop in case
// something slips through oversized anyway.
const MAX_COMBINED_BYTES = 700_000;
const BASE_URL = 'https://aura-blush-zeta.vercel.app';

async function notifyAdmins(title, body) {
  if (!db) return;
  try {
    const adminsSnap = await db.collection('admins').get();
    if (adminsSnap.empty) return;
    const tokens = [];
    await Promise.all(adminsSnap.docs.map(async (adminDoc) => {
      const tokenSnap = await db.doc(`pushTokens/${adminDoc.id}`).get();
      const token = tokenSnap.exists ? tokenSnap.data()?.token : null;
      if (token) tokens.push(token);
    }));
    if (!tokens.length) return;
    await Promise.all(tokens.map((token) => getMessaging().send({
      token,
      notification: { title, body },
      webpush: {
        fcmOptions: { link: `${BASE_URL}/aura/admin/reports` },
        notification: { icon: '/icon-192.png' },
      },
    }).catch((err) => {
      // One admin's stale/broken token shouldn't stop the others from
      // being notified — log and move on rather than letting
      // Promise.all reject the whole batch.
      console.error('admin notification failed for one token', err?.code || err);
    })));
  } catch (err) {
    // A notification failing is never a reason to fail the submission
    // itself — the request is still safely stored and reviewable either
    // way, an admin just might not get pinged about this one instantly.
    console.error('notifyAdmins failed', err);
  }
}

export default async function handler(req, res) {
  if (initError || !db) {
    res.status(500).json({ error: 'Server verification setup is broken (Firebase credentials). Check FIREBASE_SERVICE_ACCOUNT in Vercel and the function logs.' });
    return;
  }
  try {
    await handleSubmission(req, res);
  } catch (err) {
    console.error('verify-submission handler failed', err);
    res.status(500).json({ error: `Verification submission failed unexpectedly. (${err?.message || 'unknown error'})` });
  }
}

async function handleSubmission(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
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

  const {
    selfieBase64, selfieMimeType, idBase64, idMimeType, age, gender,
  } = req.body || {};

  if (!selfieBase64 || !idBase64) {
    res.status(400).json({ error: 'Both a selfie photo and an ID document are required.' });
    return;
  }
  const combinedBytes = selfieBase64.length + idBase64.length; // base64 chars ≈ bytes (close enough for a size guard)
  if (combinedBytes > MAX_COMBINED_BYTES) {
    res.status(400).json({ error: 'Those photos are too large. Please retake them (good lighting helps) and try again.' });
    return;
  }
  const numericAge = Number(age);
  if (!Number.isInteger(numericAge) || numericAge < MIN_VERIFY_AGE) {
    res.status(400).json({ error: `Verification requires an age of ${MIN_VERIFY_AGE} or older.` });
    return;
  }
  if (!ALLOWED_GENDERS.includes(gender)) {
    res.status(400).json({ error: 'A valid gender selection is required.' });
    return;
  }

  const requestRef = db.collection('verificationRequests').doc(uid);
  const existingSnap = await requestRef.get();
  const existing = existingSnap.exists ? existingSnap.data() : null;

  if (existing?.status === 'approved') {
    res.status(200).json({ status: 'approved', alreadyVerified: true });
    return;
  }
  if (existing) {
    const lastAttemptMs = existing.lastAttemptAt?.toMillis?.() || 0;
    if (Date.now() - lastAttemptMs < COOLDOWN_MS) {
      res.status(429).json({ error: 'Please wait a moment before resubmitting.' });
      return;
    }
    if ((existing.attempts || 0) >= MAX_ATTEMPTS && existing.status !== 'approved') {
      res.status(429).json({ error: 'Too many attempts. Your existing submission is still queued for review.' });
      return;
    }
  }

  await requestRef.set({
    uid,
    age: numericAge,
    gender,
    status: 'pending',
    submittedAt: existing?.status === 'pending' ? (existing.submittedAt || Timestamp.now()) : Timestamp.now(),
    lastAttemptAt: Timestamp.now(),
    attempts: FieldValue.increment(1),
    // Cleared from any previous declined attempt — a fresh submission
    // shouldn't still show the old decline reason while it's freshly
    // pending again.
    declineReason: '',
    reviewedAt: '',
    reviewerId: '',
  }, { merge: true });

  await db.collection('verificationImages').doc(uid).set({
    uid,
    selfieBase64,
    selfieMimeType: selfieMimeType || 'image/jpeg',
    idBase64,
    idMimeType: idMimeType || 'image/jpeg',
    createdAt: Timestamp.now(),
  });

  // Fire-and-forget from the response's perspective — the submission is
  // already safely stored regardless of whether this succeeds. See
  // notifyAdmins' own try/catch for why a failure here doesn't propagate.
  await notifyAdmins('New verification request', 'Someone submitted ID + selfie for Match Finder review.');

  res.status(200).json({ status: 'pending' });
}
