// src/lib/verificationService.js
//
// One function now: submitVerification. It sends BOTH a selfie and an ID
// photo together to /api/verify-submission, which stores them and queues
// the request for review — either by hand (Admin Reports) or, an hour
// later, automatically (api/escalate-verifications.js). Nothing decides
// anything at submission time anymore; see that endpoint's header comment
// for the full reasoning on why the old instant-approval fast path was
// retired.
import { ensureFirebaseSession, requireFirebase } from './firebaseClient';

// IDs need more resolution than a face does — small printed text like a
// date of birth has to stay legible after resizing. But this now also has
// to share a combined ~700KB budget with the selfie inside ONE Firestore
// document (see MAX_COMBINED_BYTES in api/verify-submission.js — Firestore
// caps a document at 1 MiB total), which the old document-only flow never
// had to worry about. 1100px/0.8 quality is a deliberately tighter budget
// than this project used before, chosen to leave real headroom under that
// cap rather than sitting right at the edge of it.
const MAX_DIMENSION = 1100;
const JPEG_QUALITY = 0.8;

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

// Turns a captured video frame into a compressed base64 JPEG. Faces don't
// need the resolution an ID's printed text does, so this stays smaller —
// less to store, less for Groq to process.
const SELFIE_MAX_DIMENSION = 900;
const SELFIE_JPEG_QUALITY = 0.8;

export function captureVideoFrameAsBase64(videoEl) {
  const scale = Math.min(1, SELFIE_MAX_DIMENSION / Math.max(videoEl.videoWidth, videoEl.videoHeight));
  const w = Math.max(1, Math.round(videoEl.videoWidth * scale));
  const h = Math.max(1, Math.round(videoEl.videoHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoEl, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', SELFIE_JPEG_QUALITY).split(',')[1] || '';
}

// selfieBase64 comes from captureVideoFrameAsBase64 (already a compressed
// JPEG); idFile is the raw File from a <input type="file">, resized here.
// age/gender are re-validated server-side regardless of what's sent.
export async function submitVerification({
  userId, selfieBase64, idFile, age, gender,
}) {
  requireFirebase();
  if (!selfieBase64) throw new Error('A selfie photo is required.');
  if (!idFile) throw new Error('An ID document is required.');
  if (!userId) throw new Error('You need to be signed in to verify.');

  const user = await ensureFirebaseSession();
  if (!user) throw new Error('You need to be signed in to verify.');

  const idToken = await user.getIdToken();
  const idBase64 = await resizeIdPhoto(idFile);

  const response = await fetch('/api/verify-submission', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      selfieBase64,
      selfieMimeType: 'image/jpeg',
      idBase64,
      idMimeType: 'image/jpeg',
      age: Number(age),
      gender,
    }),
  });

  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.error || '';
    } catch {
      detail = `HTTP ${response.status}`;
    }
    throw new Error(detail || 'Verification could not be submitted.');
  }

  // { status: 'pending' } on a normal submission, or
  // { status: 'approved', alreadyVerified: true } if they were already
  // verified and this call was redundant.
  return response.json();
}
