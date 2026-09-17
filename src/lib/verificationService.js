// src/lib/verificationService.js
//
// Sends the ID document straight to /api/verify-document (a Vercel
// function, see api/verify-document.js), which relays it to OCR.space and
// returns the extracted result. The raw image is never persisted anywhere
// — not Appwrite Storage (removed), not Firebase Storage (needs the paid
// Blaze plan, see CHANGES.md) — it exists only in memory for the length of
// this one request. Only the OCR RESULT (dateOfBirth, confidence, status)
// is saved, onto verificationRequests/{uid} in Firestore.
import { ensureFirebaseSession, requireFirebase } from './firebaseClient';
import { doc, setDoc, COLLECTIONS, db } from './firestoreClient';

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.readAsDataURL(file);
  });
}

export async function submitIdentityDocument({ userId, file }) {
  requireFirebase();
  if (!file || !userId) throw new Error('A verification document is required.');

  // Was `if (!auth.currentUser) throw` — which fired on a cold load simply
  // because Firebase hadn't finished restoring the session yet. Awaiting the
  // shared session removes that false failure.
  const user = await ensureFirebaseSession();
  if (!user) throw new Error('You need to be signed in to verify.');

  const idToken = await user.getIdToken();
  const base64 = await readFileAsBase64(file);

  const response = await fetch('/api/verify-document', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ fileBase64: base64, fileName: file.name, mimeType: file.type }),
  });
  if (!response.ok) {
    // Surface what the endpoint actually said instead of a flat message —
    // "OCR verification is not configured yet" (a missing OCR_SPACE_API_KEY)
    // and a 404 from running vite without the Vercel functions are very
    // different problems, and they used to look identical here.
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.error || '';
    } catch {
      detail = response.status === 404
        ? 'the /api/verify-document endpoint was not found — run `vercel dev` rather than `vite` if you are testing locally'
        : `HTTP ${response.status}`;
    }
    throw new Error(detail || 'OCR verification could not process this document.');
  }
  const result = await response.json();

  // This write used to send ONLY the three ocr* fields. On an existing
  // request document that made it an update whose affectedKeys were
  // ['ocrStatus','ocrDateOfBirth','ocrConfidence'] — none of which were in
  // the rule's hasOnly() allowlist, so it was rejected with
  // permission-denied. And on a document that didn't exist yet it counted as
  // a create, which the rule requires to carry `uid` and status 'pending' —
  // neither of which were present.
  //
  // Sending uid/status alongside satisfies both paths. The matching rules
  // change adds the three ocr* keys to the owner's allowlist.
  await setDoc(doc(db, COLLECTIONS.verificationRequests, userId), {
    uid: userId,
    status: 'pending',
    ocrStatus: result.status || 'pending',
    ocrDateOfBirth: result.dateOfBirth || '',
    ocrConfidence: Number(result.confidence || 0),
  }, { merge: true });

  return result;
}
