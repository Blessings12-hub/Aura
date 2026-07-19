// functions/index.js
//
// This is the piece that actually makes cross-device request notifications
// real. A client (a browser tab) can NEVER push a notification to a
// different device or a closed tab — that has to come from a server that
// holds the Firebase Admin credentials, which is exactly what Cloud
// Functions gives us for free, triggered directly off the same Firestore
// writes the app is already making.
//
// Deploy:
//   cd functions && npm install
//   firebase deploy --only functions
//
// Requires:
//   - The Blaze (pay-as-you-go) plan — Firestore-triggered Cloud Functions
//     are not available on the free Spark plan. In practice, at this app's
//     scale, actual cost should be pennies/month.
//   - Client already writing a token to pushTokens/{uid} (see
//     src/hooks/useFcmToken.js) — if a recipient never enabled push, we
//     simply have no token to send to and skip silently; the app still
//     falls back to the in-tab notification (IncomingRequestWatcher).

const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions');
const crypto = require('crypto');

initializeApp();
const db = getFirestore();

// Base URL for building deep links below — same origin as the deployed
// app. If you ever move off this Vercel URL (custom domain, etc.), this
// is the one place to update it.
const BASE_URL = 'https://aura-blush-zeta.vercel.app';

async function sendToUser(uid, notification, path = '/') {
  if (!uid) return;
  const tokenSnap = await db.doc(`pushTokens/${uid}`).get();
  const token = tokenSnap.exists ? tokenSnap.data()?.token : null;
  if (!token) return; // They never opted in (or haven't on this device) — nothing to do.

  try {
    await getMessaging().send({
      token,
      notification,
      webpush: {
        // This is what actually controls where tapping the notification
        // lands — previously always the bare app root, so a match/swap
        // message notification opened Home instead of the conversation
        // that triggered it, and the person had to navigate there manually.
        fcmOptions: { link: `${BASE_URL}${path}` },
        notification: { icon: '/icon-192.png' },
      },
    });
  } catch (err) {
    // Most common cause: the token is stale (browser data cleared,
    // notification permission revoked, etc.) — messaging/registration-token-not-registered.
    // Clean it up so we stop trying and stop accumulating dead tokens.
    if (err?.code === 'messaging/registration-token-not-registered') {
      await db.doc(`pushTokens/${uid}`).delete().catch(() => {});
    } else {
      logger.error('sendToUser failed', { uid, err: err?.message || String(err) });
    }
  }
}

// ---------------------------------------------------------------------
// Match Finder
// ---------------------------------------------------------------------
exports.onMatchRequestCreated = onDocumentCreated('matchPairs/{pairId}', async (event) => {
  const data = event.data?.data();
  if (!data) return;
  // userA is always the initiator (auto-accepted at creation); userB is
  // the recipient who hasn't responded yet.
  await sendToUser(data.userB, {
    title: 'Aura • Match Finder',
    body: 'Someone wants to match with you.',
  }, '/aura/match');
});

exports.onMatchRequestUpdated = onDocumentUpdated('matchPairs/{pairId}', async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (!before || !after) return;
  if (before.status !== 'matched' && after.status === 'matched') {
    // The recipient just accepted — notify the original requester.
    await sendToUser(after.userA, {
      title: 'Aura • Match Finder',
      body: 'Your match request was accepted!',
    }, `/aura/match/chat/${event.params.pairId}`);
  }
});

// ---------------------------------------------------------------------
// Match Chat — one push per new message. Titled with the SENDER'S NAME,
// not a generic "someone sent you a message": by the time two people can
// message each other at all they've already matched, so their name is no
// longer hidden from one another (see userIdentities rules) and there's
// no reason the notification shouldn't say who it's from.
// ---------------------------------------------------------------------
function messagePreview(data) {
  switch (data.type) {
    case 'voice': return '🎤 Voice note';
    case 'image': return '📷 Photo';
    case 'audio': return '🎵 Audio file';
    case 'file': return `📎 ${data.fileName || 'File'}`;
    default: {
      const text = (data.text || '').trim();
      if (!text) return 'New message';
      return text.length > 120 ? `${text.slice(0, 117)}...` : text;
    }
  }
}

exports.onMatchMessageCreated = onDocumentCreated('matchChats/{pairId}/messages/{messageId}', async (event) => {
  const data = event.data?.data();
  const { pairId } = event.params;
  if (!data?.userId) return;

  // pairId is "<uidA>_<uidB>" (sorted) — the recipient is whichever half
  // isn't the sender.
  const recipientId = pairId.split('_').find((id) => id !== data.userId);
  if (!recipientId) return;

  const identitySnap = await db.doc(`userIdentities/${data.userId}`).get();
  const senderName = identitySnap.exists ? identitySnap.data()?.displayName : null;

  await sendToUser(recipientId, {
    title: senderName ? `${senderName} • Aura` : 'Aura • Match Finder',
    body: messagePreview(data),
  }, `/aura/match/chat/${pairId}`);
});

// ---------------------------------------------------------------------
// Skill Swap
// ---------------------------------------------------------------------
exports.onSwapRequestCreated = onDocumentCreated('swapPairs/{pairId}', async (event) => {
  const data = event.data?.data();
  if (!data) return;
  await sendToUser(data.userB, {
    title: 'Aura • Skill Swap',
    body: 'Someone wants to swap skills with you.',
  }, '/aura/swap');
});

exports.onSwapRequestUpdated = onDocumentUpdated('swapPairs/{pairId}', async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (!before || !after) return;
  if (before.status !== 'matched' && after.status === 'matched') {
    await sendToUser(after.userA, {
      title: 'Aura • Skill Swap',
      body: 'Your swap request was accepted!',
    }, `/aura/swap/chat/${event.params.pairId}`);
  }
});

// ---------------------------------------------------------------------
// Event Buddy
// ---------------------------------------------------------------------
exports.onEventJoinCreated = onDocumentCreated('eventJoins/{joinId}', async (event) => {
  const data = event.data?.data();
  if (!data) return;
  await sendToUser(data.hostId, {
    title: 'Aura • Event Buddy',
    body: 'Someone wants to join your event.',
  }, '/aura/event');
});

exports.onEventJoinUpdated = onDocumentUpdated('eventJoins/{joinId}', async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (!before || !after) return;
  if (before.status !== 'accepted' && after.status === 'accepted') {
    await sendToUser(after.guestId, {
      title: 'Aura • Event Buddy',
      body: 'Your join request was accepted!',
    }, `/aura/event/chat/${event.params.joinId}`);
  }
});

// ---------------------------------------------------------------------
// AGE VERIFICATION — Didit (didit.me). Real (Option B) verification on
// top of the self-attested 18+ checkbox already enforced in
// firestore.rules (validMatchAge — see there). That checkbox alone can't
// stop someone from lying; this can't either, technically, but it raises
// the bar to actually needing a face scan / ID, verified by a third
// party, not just a client-side flag someone could fake with a devtools
// edit — which is why users/{uid}.verified is locked down in
// firestore.rules to be settable ONLY by this server code (the Admin SDK
// used here bypasses security rules entirely; a normal client update()
// can never set it).
//
// SETUP NEEDED before this works (all browser-only at didit.me, plus one
// CLI step to store the two secrets):
//   1. Sign up at didit.me (free tier, no card, 500 checks/month).
//   2. Business Console -> Workflows -> create a KYC / ID Verification
//      workflow (ID document scan, not facial Age Estimation — more free
//      usage on Didit's tiers) -> copy its Workflow ID into
//      DIDIT_WORKFLOW_ID below.
//   3. Business Console -> API & Webhooks -> copy your API key.
//   4. Business Console -> API & Webhooks -> Add destination -> paste this
//      function's URL (shown in Firebase Console after first deploy, or
//      `firebase functions:list`), webhook_version "v3", subscribe to the
//      "status.updated" event -> copy the secret_shared_key it shows you
//      ONCE (it's not shown again).
//   5. From a machine with the Firebase CLI (same one-time need as #13):
//        firebase functions:secrets:set DIDIT_API_KEY
//        firebase functions:secrets:set DIDIT_WEBHOOK_SECRET
//      (each prompts for the value — pastes safely, never stored in
//      your repo or shell history).
//   6. firebase deploy --only functions
//   7. Before trusting this with real users: Business Console -> API &
//      Webhooks -> Try Webhook -> send an "approved_full_features" test
//      event at this function's URL, and confirm it returns 200 and
//      actually flips verified: true on a test user doc.
//
// Signature verification below uses X-Signature-Simple (verified directly
// against Didit's published webhook docs, docs.didit.me/integration/webhooks)
// rather than the recommended X-Signature-V2. That's a deliberate choice,
// not a shortcut: Simple only authenticates the envelope (timestamp,
// session_id, status, webhook_type) and NOT the `decision` object — but
// this handler never reads `decision` at all, only those four envelope
// fields plus vendor_data, so Simple's guarantee already covers everything
// this code trusts. V2 would require exactly reproducing Didit's canonical
// JSON serialization (sorted keys, compact separators, float normalization)
// in this function, which is real complexity to take on for no added
// protection given what this handler actually uses.
const diditApiKey = defineSecret('FX9s3ybNSW59XurBIasaPsq8vboQ8myh8FzSbVQINts');
const diditWebhookSecret = defineSecret('DIDIT_WEBHOOK_SECRET');
const DIDIT_WORKFLOW_ID = '293d9688-aafc-4c92-bdda-0279a937b383';

exports.createDiditSession = onCall({ secrets: [diditApiKey] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in to verify.');
  }
  const uid = request.auth.uid;

  // Didit's session-CREATE endpoint is v2 even though the newer decision/
  // webhook payload shapes are v3 (confirmed from their own quick-start
  // docs) — if this 404s or errors after you set up your account, check
  // Business Console -> API reference for the exact current URL, endpoint
  // versioning is the one part of this most likely to have moved on.
  const res = await fetch('https://verification.didit.me/v2/session/', {
    method: 'POST',
    headers: { 'x-api-key': diditApiKey.value(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflow_id: DIDIT_WORKFLOW_ID,
      // Echoed back on the webhook (as vendor_data) so we know which Aura
      // account a given session result belongs to — Didit's own session
      // id alone doesn't tell us that.
      vendor_data: uid,
      callback: `${BASE_URL}/aura/match`,
    }),
  });

  if (!res.ok) {
    logger.error('Didit session creation failed', { status: res.status, body: await res.text() });
    throw new HttpsError('internal', 'Could not start verification. Please try again.');
  }

  const data = await res.json();
  return { url: data.url, sessionId: data.session_id };
});

exports.diditWebhook = onRequest({ secrets: [diditWebhookSecret] }, async (req, res) => {
  const timestampHeader = req.headers['x-timestamp'];
  const signatureHeader = req.headers['x-signature-simple'];
  const body = req.body || {};
  const {
    session_id: sessionId, status, webhook_type: webhookType, timestamp, vendor_data: uid,
  } = body;

  if (!timestampHeader || !signatureHeader) {
    res.status(401).send('Missing signature headers');
    return;
  }
  // Reject anything older than 5 minutes — Didit's own documented replay
  // defense, and the same window their own reference implementations use.
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - parseInt(timestampHeader, 10)) > 300) {
    logger.error('Didit webhook stale timestamp', { timestampHeader });
    res.status(401).send('Stale timestamp');
    return;
  }

  // X-Signature-Simple = HMAC-SHA256("{timestamp}:{session_id}:{status}:{webhook_type}")
  // — the exact canonical string Didit documents, in that exact order.
  const canonical = `${timestamp ?? ''}:${sessionId ?? ''}:${status ?? ''}:${webhookType ?? ''}`;
  const expected = crypto.createHmac('sha256', diditWebhookSecret.value()).update(canonical).digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  const givenBuf = Buffer.from(String(signatureHeader), 'utf8');
  const signatureValid = expectedBuf.length === givenBuf.length && crypto.timingSafeEqual(expectedBuf, givenBuf);

  if (!signatureValid) {
    logger.error('Didit webhook signature mismatch', { sessionId });
    res.status(401).send('Invalid signature');
    return;
  }

  // Only care about session status changes with a vendor_data (our uid) —
  // ignore anything else (e.g. a future event type this app doesn't use)
  // rather than erroring on it, so Didit doesn't keep retrying a delivery
  // this code was never going to act on anyway.
  if (webhookType !== 'status.updated' || !uid) {
    res.status(200).send('ignored');
    return;
  }

  if (status === 'Approved') {
    await db.doc(`users/${uid}`).set({ verified: true, verifiedAt: new Date().toISOString() }, { merge: true });
  } else if (status === 'Declined') {
    await db.doc(`users/${uid}`).set({ verified: false, verifiedAt: new Date().toISOString() }, { merge: true });
  }
  // Any other status (e.g. "In Review", "In Progress") — deliberately
  // no-op; leave verified as it was and wait for a later webhook with a
  // final status.

  res.status(200).send('ok');
});

  res.status(200).send('OK');
});
