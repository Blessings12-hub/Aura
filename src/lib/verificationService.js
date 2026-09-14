// src/lib/verificationService.js
//
// Sends the ID document straight to /api/verify-document (a Vercel
// function, see api/verify-document.js), which relays it to OCR.space and
// returns the extracted result. The raw image is never persisted anywhere
// — not Appwrite Storage (removed), not Firebase Storage (needs the paid
// Blaze plan, see CHANGES.md) — it exists only in memory for the length of
// this one request. Only the OCR RESULT (dateOfBirth, confidence, status)
// is saved, onto verificationRequests/{uid} in Firestore.
import { requireFirebase } from './firebaseClient';
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
  const auth = requireFirebase();
  if (!file || !userId) throw new Error('A verification document is required.');
  if (!auth.currentUser) throw new Error('You need to be signed in to verify.');

  const idToken = await auth.currentUser.getIdToken();
  const base64 = await readFileAsBase64(file);

  const response = await fetch('/api/verify-document', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ fileBase64: base64, fileName: file.name, mimeType: file.type }),
  });
  if (!response.ok) throw new Error('OCR verification could not process this document.');
  const result = await response.json();

  await setDoc(doc(db, COLLECTIONS.verificationRequests, userId), {
    ocrStatus: result.status || 'pending',
    ocrDateOfBirth: result.dateOfBirth || '',
    ocrConfidence: Number(result.confidence || 0),
  }, { merge: true });

  return result;
}
