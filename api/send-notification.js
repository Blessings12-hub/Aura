// api/send-notification.js
//
// Replaces functions/index.js's sendToUser() + the 7 Firestore-triggered
// functions that used to call it automatically. Vercel functions have no
// equivalent of a Firestore trigger (that only exists on Firebase's own
// Cloud Functions) — so instead of the database silently waking up a
// function, the CLIENT now calls this endpoint directly, right after
// doing the thing that should notify someone (see the client changes in
// MatchFinder.jsx, MatchChat.jsx, SkillSwap.jsx, EventBuddy.jsx).
//
// This is a real architecture difference worth understanding, not just a
// relocation: if that client-side call doesn't fire for any reason (a
// crash between the write and the call, a network drop), no notification
// goes out — where a Firestore trigger fires no matter what, even if the
// client that made the write immediately closes the tab. For Aura's
// scale, that tradeoff is fine; worth knowing it exists.
//
// SETUP NEEDED (see the full walkthrough in the chat where this was built):
//   1. Generate a Firebase service account key (Firebase Console -> Project
//      Settings -> Service Accounts -> Generate new private key).
//   2. In Vercel -> Settings -> Environment Variables, add
//      FIREBASE_SERVICE_ACCOUNT with the ENTIRE contents of that JSON file
//      pasted in as a single value.
//   3. Redeploy. No Blaze plan needed anywhere in this — this endpoint
//      talks to Firestore/FCM the same way any external server would,
//      which is governed by Firestore's own free quota (very generous)
//      and FCM sending, which is always free regardless of plan.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { getAuth } from 'firebase-admin/auth';

// Vercel functions can be reused across invocations (a "warm" instance),
// so this guards against re-initializing the Admin SDK on every single
// request — getApps().length check is the standard pattern for this.
if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();
const BASE_URL = 'https://aura-blush-zeta.vercel.app';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Requires a valid Firebase ID token from the caller — proves this
  // request came from a real, currently-signed-in Aura session, not an
  // anonymous script. It does NOT prove the caller is who they claim
  // about (e.g. that they actually sent the message they say they did) —
  // this endpoint trusts the client's claimed title/body/target uid the
  // same way the rest of the app trusts a signed-in client for its own
  // writes. Worst case someone could abuse this to send an annoying
  // notification to an arbitrary uid; it's not a path to reading or
  // changing anyone's data.
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

  const { uid, title, body, path } = req.body || {};
  if (!uid || !title || !body) {
    res.status(400).json({ error: 'Missing uid, title, or body' });
    return;
  }

  try {
    const tokenSnap = await db.doc(`pushTokens/${uid}`).get();
    const token = tokenSnap.exists ? tokenSnap.data()?.token : null;
    if (!token) {
      // They never opted into push (or not on this device) — nothing to
      // do, and not an error. The app still falls back to the in-tab
      // notification (IncomingRequestWatcher) for anyone currently open.
      res.status(200).json({ sent: false, reason: 'no token' });
      return;
    }

    await getMessaging().send({
      token,
      notification: { title, body },
      webpush: {
        fcmOptions: { link: `${BASE_URL}${path || '/'}` },
        notification: { icon: '/icon-192.png' },
      },
    });
    res.status(200).json({ sent: true });
  } catch (err) {
    if (err?.code === 'messaging/registration-token-not-registered') {
      // Stale token (browser data cleared, permission revoked) — clean
      // it up so nothing keeps trying to send to a dead device.
      await db.doc(`pushTokens/${uid}`).delete().catch(() => {});
      res.status(200).json({ sent: false, reason: 'stale token, cleaned up' });
      return;
    }
    console.error('send-notification failed', err);
    res.status(500).json({ error: 'Failed to send notification' });
  }
}
