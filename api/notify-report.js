// api/notify-report.js
//
// Found during a readiness review: verification requests page every admin
// the moment they're submitted; reports of harassment, "underage," sexual
// content, spam — arguably the more urgent category — did not. A report
// could sit unseen in Admin Reports indefinitely unless someone happened
// to check. This closes that gap, using the same pattern already built
// for verification: the reporting user's own client calls this right
// after the report document is written (see reportUser() in
// src/lib/blocking.js), authenticated with their own ID token, and this
// fans the notification out to every admin's registered device.
//
// Deliberately lightweight: this does not decide anything, store
// anything, or gate anything — it only notifies. The report itself is
// already safely written to Firestore by the time this is called, so if
// this fails for any reason (a transient error, an admin with no push
// token registered), the report is not lost — it's just not pinged about
// as quickly, and still sits in the Admin Reports queue exactly as before
// this existed.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

let initError = null;
if (!getApps().length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({ credential: cert(serviceAccount) });
  } catch (err) {
    initError = err;
    console.error('Firebase admin init failed in notify-report.js', err);
  }
}
const db = initError ? null : getFirestore();
const BASE_URL = 'https://aura-blush-zeta.vercel.app';

// Same short, human phrasing AdminReports.jsx already uses for these
// reason codes (see report_reason_* translation keys) — kept in sync
// manually since this runs server-side and doesn't have access to i18n.
const REASON_LABELS = {
  harassment: 'Harassment',
  sexual_content: 'Sexual content',
  spam_or_scam: 'Spam or scam',
  underage: 'Underage user',
  other: 'Other',
};

export default async function handler(req, res) {
  if (initError || !db) {
    res.status(500).json({ error: 'Server verification setup is broken (Firebase credentials).' });
    return;
  }
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
  try {
    await getAuth().verifyIdToken(idToken);
  } catch {
    res.status(401).json({ error: 'Invalid auth token' });
    return;
  }
  // Anyone signed in can trigger this — same as any other authenticated
  // user action. There's nothing sensitive in the notification itself
  // (no reporter/reported identity, just the reason and where it
  // happened), and the report it refers to already exists regardless of
  // whether this call ever fires.

  const { reason, context } = req.body || {};

  try {
    const adminsSnap = await db.collection('admins').get();
    if (adminsSnap.empty) { res.status(200).json({ notified: 0 }); return; }

    const tokens = [];
    await Promise.all(adminsSnap.docs.map(async (adminDoc) => {
      const tokenSnap = await db.doc(`pushTokens/${adminDoc.id}`).get();
      const token = tokenSnap.exists ? tokenSnap.data()?.token : null;
      if (token) tokens.push(token);
    }));

    const reasonLabel = REASON_LABELS[reason] || 'Report';
    const body = context ? `${reasonLabel} — ${context}` : reasonLabel;

    let notified = 0;
    await Promise.all(tokens.map((token) => getMessaging().send({
      token,
      notification: { title: 'New report filed', body },
      webpush: {
        fcmOptions: { link: `${BASE_URL}/aura/admin/reports` },
        notification: { icon: '/icon-192.png' },
      },
    }).then(() => { notified += 1; }).catch((err) => {
      console.error('report notification failed for one token', err?.code || err);
    })));

    res.status(200).json({ notified });
  } catch (err) {
    // A failed notification is never a reason to surface an error to the
    // reporting user — from their side, the report already succeeded.
    console.error('notify-report failed', err);
    res.status(200).json({ notified: 0 });
  }
}
