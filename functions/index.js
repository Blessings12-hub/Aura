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
const Stripe = require('stripe');

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

// Identity verification is intentionally manual and free: users submit a
// verificationRequests document, and allowlisted admins approve or decline it
// from the Aura admin screen. No vendor API, webhook, or identity documents
// are stored by this app.

// ---------------------------------------------------------------------
// MONETIZATION — Match Finder's "see who liked you first" paid tier.
// Same shape as the Didit functions above: a callable function starts a
// hosted checkout flow, a webhook (verified, never trusted blind) is what
// actually flips user.plan — never the client. See the "see who liked you"
// gate in src/pages/MatchFinder.jsx for how this is actually used.
//
// SETUP NEEDED before this works (all browser-only at stripe.com, plus
// the same one-time CLI step as Didit's secrets):
//   1. Create a Stripe account at stripe.com (no card required to start
//      in test mode — you can build and test this whole flow for free
//      before ever taking a real payment).
//   2. Dashboard -> Product catalog -> add a product ("Aura Premium"),
//      recurring price, whatever you want to charge -> copy its Price ID
//      (starts with `price_`) into STRIPE_PRICE_ID below.
//   3. Dashboard -> Developers -> API keys -> copy your Secret key (test
//      mode key while building, live key only once you're ready to
//      actually charge people).
//   4. Dashboard -> Developers -> Webhooks -> Add destination -> paste
//      this function's URL (shown in Firebase Console after first
//      deploy) -> listen for `checkout.session.completed` and
//      `customer.subscription.deleted` -> copy the signing secret it
//      shows you.
//   5. From a machine with the Firebase CLI:
//        firebase functions:secrets:set STRIPE_SECRET_KEY
//        firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
//   6. firebase deploy --only functions
//   7. Before trusting this with real money: Stripe Dashboard ->
//      Developers -> Webhooks -> your endpoint -> Send test webhook ->
//      send a `checkout.session.completed` event, and confirm it
//      actually flips plan: 'premium' on a test user doc. Stripe's test
//      mode (test API keys + test card 4242 4242 4242 4242) lets you run
//      an entire real checkout end-to-end without any real charge.
const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');
const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET');
const STRIPE_PRICE_ID = 'REPLACE_WITH_YOUR_STRIPE_PRICE_ID';

exports.createStripeCheckoutSession = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');
  const uid = request.auth.uid;

  const stripe = Stripe(stripeSecretKey.value());

  // If they already have a Stripe customer from a previous checkout
  // attempt, reuse it instead of creating a duplicate customer record
  // every time someone opens the upgrade flow.
  const userSnap = await db.doc(`users/${uid}`).get();
  const existingCustomerId = userSnap.exists() ? userSnap.data()?.stripeCustomerId : null;

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
    // client_reference_id is how the webhook maps a completed checkout
    // back to a specific Aura account — Stripe has no idea what a
    // Firebase uid is otherwise.
    client_reference_id: uid,
    customer: existingCustomerId || undefined,
    success_url: `${BASE_URL}/aura/match?upgrade=success`,
    cancel_url: `${BASE_URL}/aura/match?upgrade=cancelled`,
  });

  return { url: session.url };
});

exports.stripeWebhook = onRequest({ secrets: [stripeSecretKey, stripeWebhookSecret] }, async (req, res) => {
  const stripe = Stripe(stripeSecretKey.value());

  let event;
  try {
    // constructEvent is what actually verifies this request really came
    // from Stripe (HMAC-signed with your webhook secret) rather than
    // trusting the request body blind — the same principle as Didit's
    // signature check above, just using Stripe's own SDK to do it since
    // they provide one, unlike Didit's simpler shared-secret HMAC.
    event = stripe.webhooks.constructEvent(req.rawBody, req.headers['stripe-signature'], stripeWebhookSecret.value());
  } catch (err) {
    logger.error('Stripe webhook signature verification failed', { message: err?.message });
    res.status(400).send(`Webhook signature verification failed`);
    return;
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const uid = session.client_reference_id;
    if (uid) {
      await db.doc(`users/${uid}`).set({
        plan: 'premium',
        stripeCustomerId: session.customer,
        stripeSubscriptionId: session.subscription,
      }, { merge: true });
    }
  } else if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    // No uid on a subscription-deleted event directly — look up whichever
    // account we stored this subscription id on back at checkout time.
    const matches = await db.collection('users').where('stripeSubscriptionId', '==', subscription.id).limit(1).get();
    if (!matches.empty) {
      await matches.docs[0].ref.set({ plan: 'free' }, { merge: true });
    }
  }
  // Any other event type — deliberately no-op; Stripe sends many event
  // types this app doesn't act on, and the correct response to those is
  // just a 200, not an error (an error makes Stripe keep retrying
  // delivery of an event we were never going to do anything with).

  res.status(200).send('ok');
});
