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
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions');

initializeApp();
const db = getFirestore();

// Voice-note transcription (Match Chat's long-press "Transcribe" action)
// calls OpenAI's Whisper API. Set this once with:
//   firebase functions:secrets:set OPENAI_API_KEY
// (paste your own OpenAI API key when prompted). Until that's set, the
// transcribe action will fail with a clear "not configured yet" error
// instead of silently doing nothing.
const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');

async function sendToUser(uid, notification) {
  if (!uid) return;
  const tokenSnap = await db.doc(`pushTokens/${uid}`).get();
  const token = tokenSnap.exists ? tokenSnap.data()?.token : null;
  if (!token) return; // They never opted in (or haven't on this device) — nothing to do.

  try {
    await getMessaging().send({
      token,
      notification,
      webpush: {
        fcmOptions: { link: 'https://aura-blush-zeta.vercel.app/' },
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
  });
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
    });
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
  });
});

// Long-press "Transcribe" on a voice note (MatchChat.jsx). Runs server-side
// (not client-side Web Speech API) because Web Speech only ever recognizes
// LIVE microphone audio — it has no way to transcribe an already-recorded
// clip, which is exactly what a voice note is. Writes the result straight
// onto the message doc via the Admin SDK (bypasses Firestore rules — no
// client-side write path for `transcript` exists or is needed).
exports.transcribeVoiceNote = onCall({ secrets: [OPENAI_API_KEY] }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const { matchId, messageId } = request.data || {};
  if (!matchId || !messageId) throw new HttpsError('invalid-argument', 'matchId and messageId are required.');

  // matchId is "<uidA>_<uidB>" — only a participant of that pair may
  // transcribe a voice note inside it.
  const [uidA, uidB] = matchId.split('_');
  if (uid !== uidA && uid !== uidB) {
    throw new HttpsError('permission-denied', 'You are not a participant of this match.');
  }

  const msgRef = db.doc(`matchChats/${matchId}/messages/${messageId}`);
  const msgSnap = await msgRef.get();
  if (!msgSnap.exists) throw new HttpsError('not-found', 'Message not found.');
  const msg = msgSnap.data();
  if (msg.type !== 'voice' || !msg.voiceUrl) {
    throw new HttpsError('failed-precondition', 'This message is not a voice note.');
  }
  // Already transcribed — return the cached result instead of re-billing
  // the API for a repeat tap.
  if (msg.transcript) return { transcript: msg.transcript };

  const apiKey = OPENAI_API_KEY.value();
  if (!apiKey) {
    throw new HttpsError('failed-precondition', 'Transcription is not configured yet. Run: firebase functions:secrets:set OPENAI_API_KEY');
  }

  // voiceUrl is a base64 data URL (see src/lib/chatMedia.js) — decode
  // straight to a Buffer, no Storage bucket involved.
  const parsed = /^data:([^;]+);base64,(.*)$/s.exec(msg.voiceUrl);
  if (!parsed) throw new HttpsError('internal', 'Voice note could not be read.');
  const [, mime, base64] = parsed;
  const buffer = Buffer.from(base64, 'base64');
  const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'mp4' : mime.includes('wav') ? 'wav' : 'webm';

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), `voice.${ext}`);
  form.append('model', 'whisper-1');

  let resp;
  try {
    resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch (err) {
    logger.error('transcribeVoiceNote: network error', { err: err?.message || String(err) });
    throw new HttpsError('unavailable', 'Could not reach the transcription service. Try again.');
  }
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    logger.error('transcribeVoiceNote: API error', { status: resp.status, errText });
    throw new HttpsError('internal', 'Transcription failed. Please try again.');
  }
  const json = await resp.json();
  const transcript = (json.text || '').trim() || '(No speech detected)';

  await msgRef.update({ transcript });
  return { transcript };
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
  });
});

exports.onSwapRequestUpdated = onDocumentUpdated('swapPairs/{pairId}', async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (!before || !after) return;
  if (before.status !== 'matched' && after.status === 'matched') {
    await sendToUser(after.userA, {
      title: 'Aura • Skill Swap',
      body: 'Your swap request was accepted!',
    });
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
  });
});

exports.onEventJoinUpdated = onDocumentUpdated('eventJoins/{joinId}', async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (!before || !after) return;
  if (before.status !== 'accepted' && after.status === 'accepted') {
    await sendToUser(after.guestId, {
      title: 'Aura • Event Buddy',
      body: 'Your join request was accepted!',
    });
  }
});
