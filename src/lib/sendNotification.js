// src/lib/sendNotification.js
//
// Calls the new /api/send-notification Vercel function (see api/send-
// notification.js) — this REPLACES what used to happen automatically via
// Firebase Cloud Functions' Firestore triggers. Since Vercel has no
// equivalent trigger, this must be called explicitly, right after the
// action that should notify someone (creating a match request, sending a
// message, accepting a join request, etc.) — see where this is called
// from in MatchFinder.jsx, MatchChat.jsx, SkillSwap.jsx, EventBuddy.jsx.
//
// Deliberately fire-and-forget from the caller's side: a notification
// failing to send should never block or error out the actual action (the
// match request itself, the message itself) that's the real thing the
// user cares about completing. Errors are logged, not thrown.
import { auth } from '../firebase';

export async function sendNotification({ uid, title, body, path }) {
  try {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) return; // Not signed in somehow — nothing sensible to do.
    await fetch('/api/send-notification', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ uid, title, body, path }),
    });
  } catch (err) {
    // Never let a notification failure surface to the user or block
    // whatever real action triggered it — this is best-effort.
    console.error('sendNotification failed', err);
  }
}
