// src/lib/accountData.js
//
// Calls the /api/export-account and /api/delete-account Vercel functions
// (see api/export-account.js, api/delete-account.js) — the full-coverage
// replacement for what AccountSettings.jsx used to do entirely
// client-side, which only ever reached the account doc, Match Finder
// identity, and Match Finder cards. Same auth pattern as
// sendNotification.js: the caller's own fresh ID token, sent as a Bearer
// header, is what proves this is a genuine "do this to MY OWN account"
// request — there's no uid in the request body anywhere, so there's
// nothing for a tampered request to redirect at someone else's account.
//
// Unlike sendNotification.js, these are NOT fire-and-forget — a failed
// export or delete is something the person needs to know about and be
// able to retry, so both throw on failure instead of swallowing errors.
import { requireFirebase } from './firebaseClient';

async function callWithAuth(path) {
  const auth = requireFirebase();
  if (!auth.currentUser) throw new Error('No active session.');
  const idToken = await auth.currentUser.getIdToken();
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Request to ${path} failed`);
  return body;
}

export async function exportAccountData() {
  return callWithAuth('/api/export-account');
}

export async function deleteAccountServerSide() {
  return callWithAuth('/api/delete-account');
}
