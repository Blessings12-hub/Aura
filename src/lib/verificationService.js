// src/lib/verificationService.js
//
// Sends the ID photo to /api/verify-document, which runs it past OCR.space
// and Groq's vision model and writes the decision straight to Firestore
// itself (see the header comment in that file for why). This module does
// two things only: shrink the image so it doesn't blow past Vercel's
// request-body limit, and make the authenticated request.
//
// This file used to ALSO write the OCR result to Firestore itself
// (setDoc(verificationRequests, { ocrStatus, ... })). That's gone — the
// server is now the only writer, which is both simpler and closes a real
// hole: a client could previously fabricate its own "OCR result" by writing
// directly. See firestore.rules, verificationRequests, for the matching
// tightening.
import { ensureFirebaseSession, requireFirebase } from './firebaseClient';

// IDs need more resolution than the 320px avatar photo (resizePhotoToDataUrl
// in photoUpload.js) — small printed text like a date of birth has to stay
// legible after resizing, both for OCR.space's regex pass and for Groq's
// vision model. 1400px on the long edge is a reasonable middle ground: a
// typical 12MP phone photo of an ID (often 6-10MB as JPEG) comes down to
// somewhere around a few hundred KB at this size and quality, comfortably
// inside Vercel's default ~4.5MB function body limit even after base64's
// ~33% size overhead.
const MAX_DIMENSION = 1400;
const JPEG_QUALITY = 0.85;

function resizeIdPhoto(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith('image/')) {
      reject(new Error('Please choose an image file.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.onload = () => {
        const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
        resolve(dataUrl.split(',')[1] || '');
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// age/gender are the values the person entered on the form calling this
// (Login or MatchFinder) — the server re-validates both and stores them on
// the request record; nothing here trusts the client's OCR opinion, because
// there isn't one anymore.
export async function submitIdentityDocument({
  userId, file, age, gender,
}) {
  requireFirebase();
  if (!file || !userId) throw new Error('A verification document is required.');

  const user = await ensureFirebaseSession();
  if (!user) throw new Error('You need to be signed in to verify.');

  const idToken = await user.getIdToken();
  const fileBase64 = await resizeIdPhoto(file);

  const response = await fetch('/api/verify-document', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      fileBase64, mimeType: 'image/jpeg', age: Number(age), gender,
    }),
  });

  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.error || '';
    } catch {
      detail = response.status === 404
        ? 'the /api/verify-document endpoint was not found — run `vercel dev` rather than `vite` if you are testing locally'
        : `HTTP ${response.status}`;
    }
    throw new Error(detail || 'Verification could not process this document.');
  }

  // { status: 'approved' | 'declined' | 'pending', dateOfBirth, confidence,
  //   concerns, declineReason } — the server has already written this to
  // Firestore; the caller uses the return value purely to show an
  // immediate message without waiting on a snapshot listener to catch up.
  return response.json();
}
