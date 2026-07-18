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
const { logger } = require('firebase-functions');

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
