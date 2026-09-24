// api/admin-panel.js
//
// A second way into the same review queue AdminReports.jsx uses — for
// when you need to review requests without going through Aura's normal
// sign-in/admin-doc setup at all. Same underlying data, same actions
// (approve/decline writes the same fields, deletes the same images,
// sends the same notification); this just gets there differently.
//
// AUTH: not Firebase — a single shared secret (ADMIN_PANEL_SECRET),
// checked against the x-admin-secret header. No anonymous session, no
// /admins/{uid} document, nothing tied to a browser or device. That's
// deliberately simpler than the in-app path, and also why it's a
// DIFFERENT secret from CRON_SECRET rather than reusing it: this one gets
// typed into a browser and sits in that browser's localStorage, which is
// a different exposure profile than a value that only ever lives in
// Vercel/GitHub's own secret stores. Treat it like a password — anyone
// who has it can approve or decline ANY pending request.
//
// SETUP NEEDED: generate a random secret (same idea as CRON_SECRET — see
// that endpoint's header comment) and add it as ADMIN_PANEL_SECRET in
// Vercel's environment variables. See public/admin-panel.html for the
// page that calls this.
//
// Three actions, chosen by ?action=:
//   GET  ?action=list             -> pending requests, newest first
//   GET  ?action=images&uid=...   -> that request's stored photos
//   POST ?action=decide           -> body: { uid, decision } — approves
//                                     or declines, same as AdminReports.jsx

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

let initError = null;
if (!getApps().length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({ credential: cert(serviceAccount) });
  } catch (err) {
    initError = err;
    console.error('Firebase admin init failed in admin-panel.js', err);
  }
}
const db = initError ? null : getFirestore();
const BASE_URL = 'https://aura-blush-zeta.vercel.app';

async function notifyUser(uid, title, body) {
  try {
    const tokenSnap = await db.doc(`pushTokens/${uid}`).get();
    const token = tokenSnap.exists ? tokenSnap.data()?.token : null;
    if (!token) return;
    await getMessaging().send({
      token,
      notification: { title, body },
      webpush: { fcmOptions: { link: `${BASE_URL}/login` }, notification: { icon: '/icon-192.png' } },
    });
  } catch (err) {
    console.error('admin-panel notifyUser failed', uid, err?.code || err);
  }
}

export default async function handler(req, res) {
  if (initError || !db) {
    res.status(500).json({ error: 'Server setup is broken (Firebase credentials).' });
    return;
  }
  if (!process.env.ADMIN_PANEL_SECRET) {
    res.status(500).json({ error: 'ADMIN_PANEL_SECRET is not set on the server.' });
    return;
  }
  const provided = req.headers['x-admin-secret'];
  if (provided !== process.env.ADMIN_PANEL_SECRET) {
    res.status(401).json({ error: 'Wrong secret.' });
    return;
  }

  try {
    const action = req.query?.action;
    if (req.method === 'GET' && action === 'list') return await listPending(req, res);
    if (req.method === 'GET' && action === 'images') return await getImages(req, res);
    if (req.method === 'POST' && action === 'decide') return await decide(req, res);
    res.status(400).json({ error: 'Unknown action.' });
    return undefined;
  } catch (err) {
    console.error('admin-panel handler failed', err);
    res.status(500).json({ error: `Request failed unexpectedly. (${err?.message || 'unknown error'})` });
  }
}

async function listPending(req, res) {
  // A plain equality filter — deliberately not combined with an
  // orderBy on a different field here, so this doesn't need its own
  // composite index the way api/escalate-verifications.js's query does.
  // Sorted newest-first in JS instead, after fetching.
  const snap = await db.collection('verificationRequests').where('status', '==', 'pending').get();
  const items = snap.docs.map((d) => {
    const data = d.data();
    const submittedMs = data.submittedAt?.toMillis?.() || 0;
    return {
      uid: d.id,
      age: data.age,
      gender: data.gender,
      submittedAt: submittedMs,
      minutesAgo: submittedMs ? Math.round((Date.now() - submittedMs) / 60000) : null,
    };
  }).sort((a, b) => b.submittedAt - a.submittedAt);
  res.status(200).json({ items });
}

async function getImages(req, res) {
  const uid = req.query?.uid;
  if (!uid) { res.status(400).json({ error: 'uid is required.' }); return; }
  const snap = await db.collection('verificationImages').doc(uid).get();
  if (!snap.exists) {
    res.status(404).json({ error: 'No photos on file for this request — likely already reviewed.' });
    return;
  }
  const data = snap.data();
  res.status(200).json({
    selfieBase64: data.selfieBase64,
    selfieMimeType: data.selfieMimeType || 'image/jpeg',
    idBase64: data.idBase64,
    idMimeType: data.idMimeType || 'image/jpeg',
  });
}

async function decide(req, res) {
  const { uid, decision } = req.body || {};
  if (!uid || !['approved', 'declined'].includes(decision)) {
    res.status(400).json({ error: 'uid and a valid decision (approved/declined) are required.' });
    return;
  }
  const requestRef = db.collection('verificationRequests').doc(uid);
  const requestSnap = await requestRef.get();
  if (!requestSnap.exists) {
    res.status(404).json({ error: 'No such request.' });
    return;
  }
  const request = requestSnap.data();

  await requestRef.set({
    status: decision,
    reviewedAt: Timestamp.now(),
    reviewerId: 'admin-panel',
  }, { merge: true });

  await db.collection('users').doc(uid).set({
    verified: decision === 'approved',
    verificationStatus: decision,
    // See the matching FIXED comment in api/escalate-verifications.js —
    // without this, a gender mismatch between the account's base field
    // and what was actually verified silently breaks Match Finder's
    // profile save with an unrelated-looking permission-denied error.
    gender: request.gender || '',
    age: request.age,
    verifiedSex: request.gender || '',
    verifiedAt: Timestamp.now(),
    verificationExpiresAt: Timestamp.fromMillis(Date.now() + 365 * 24 * 60 * 60 * 1000),
  }, { merge: true });

  // Same immediate deletion as the in-app review path — a decision exists
  // now, the photos have served their one purpose.
  await db.collection('verificationImages').doc(uid).delete().catch(() => {});

  await notifyUser(
    uid,
    decision === 'approved' ? "You're verified!" : 'Verification update',
    decision === 'approved' ? 'Match Finder is unlocked.' : 'Your verification was declined — open Aura for details.',
  );

  res.status(200).json({ ok: true });
}
