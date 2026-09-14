// api/verify-document.js
//
// Age/gender verification, without storing the ID photo anywhere. The
// client sends the image as base64 in the request body; this function
// relays it straight to OCR.space, extracts a date of birth from the
// returned text, and returns only that result. Nothing is written to
// Storage (Appwrite's is gone, Firebase's needs the paid Blaze plan — see
// CHANGES.md) — the image only ever exists in this function's memory for
// the length of one request.
//
// SETUP NEEDED:
//   1. Create a free account at ocr.space and copy your API key.
//   2. In Vercel -> Settings -> Environment Variables, add
//      OCR_SPACE_API_KEY with that key. Server-side only — never expose
//      this as a VITE_ variable.
//   3. This reuses the same FIREBASE_SERVICE_ACCOUNT variable that
//      api/send-notification.js already needs, to verify the caller is a
//      real signed-in Aura session before spending OCR.space quota on
//      their request.
//
// IMPORTANT — this always returns status: 'pending' and lets an admin do
// the final approval from the Aura admin screen (see the "MANUAL
// VERIFICATION" block in firestore.rules and AdminReports.jsx). OCR text
// extraction from an ID photo is not reliable enough to auto-approve on
// its own — this narrows what a reviewer has to check by hand, it doesn't
// replace them.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  initializeApp({ credential: cert(serviceAccount) });
}

// Matches common date-of-birth formats found on ID documents:
// DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, and "DD Mon YYYY" (e.g. 05 Jan 2000).
const DATE_PATTERNS = [
  /\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b/, // DD/MM/YYYY or MM/DD/YYYY
  /\b(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})\b/, // YYYY-MM-DD
  /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})\b/i,
];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function extractDateOfBirth(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const pattern of DATE_PATTERNS) {
    const match = lower.match(pattern);
    if (!match) continue;
    try {
      if (pattern === DATE_PATTERNS[2]) {
        const month = MONTHS.indexOf(match[2].slice(0, 3)) + 1;
        if (!month) continue;
        return `${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
      }
      if (pattern === DATE_PATTERNS[1]) {
        return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
      }
      // DD/MM/YYYY assumed (most ID documents outside the US) — a
      // reviewer double-checks this against the photo either way.
      return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
    } catch {
      continue;
    }
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) {
    res.status(401).json({ error: 'Missing auth token' });
    return;
  }
  try {
    await getAuth().verifyIdToken(idToken);
  } catch {
    res.status(401).json({ error: 'Invalid auth token' });
    return;
  }

  const apiKey = process.env.OCR_SPACE_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'OCR verification is not configured yet.' });
    return;
  }

  const { fileBase64, mimeType } = req.body || {};
  if (!fileBase64) {
    res.status(400).json({ error: 'A verification document is required.' });
    return;
  }

  try {
    const ocrResponse = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      headers: {
        apikey: apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        base64Image: `data:${mimeType || 'image/jpeg'};base64,${fileBase64}`,
        OCREngine: '2',
        scale: 'true',
        detectOrientation: 'true',
      }),
    });

    if (!ocrResponse.ok) {
      res.status(502).json({ error: 'OCR.space request failed.' });
      return;
    }

    const ocrResult = await ocrResponse.json();
    if (ocrResult.IsErroredOnProcessing) {
      res.status(200).json({ status: 'pending', dateOfBirth: '', confidence: 0 });
      return;
    }

    const text = ocrResult.ParsedResults?.[0]?.ParsedText || '';
    const dateOfBirth = extractDateOfBirth(text);

    res.status(200).json({
      status: 'pending', // always human-reviewed — see note above
      dateOfBirth: dateOfBirth || '',
      confidence: dateOfBirth ? 0.6 : 0,
    });
  } catch (err) {
    console.error('verify-document failed', err);
    res.status(500).json({ error: 'OCR verification could not process this document.' });
  }
}
