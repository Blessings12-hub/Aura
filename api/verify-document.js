// api/verify-document.js
//
// Age verification for Match Finder ONLY — the rest of Aura (Mood Chat,
// Daily Question, Skill Swap, Event Buddy, Letters) is anonymous by design
// and never calls this endpoint. Nothing is written to Storage; the image
// exists only in this function's memory for the length of one request.
//
// SETUP NEEDED:
//   1. OCR.space: free account at ocr.space, then OCR_SPACE_API_KEY in
//      Vercel -> Settings -> Environment Variables (server-side only).
//   2. Groq: free account at console.groq.com, then GROQ_API_KEY the same
//      way. Groq's free tier is rate-limited (requests/tokens per minute,
//      and I believe a daily cap too) — the exact numbers change over time,
//      so check console.groq.com/settings/limits for your account rather
//      than trusting a number written in a comment. The cooldown below is a
//      deliberately conservative guess at "reasonable", not a tuned value.
//   3. FIREBASE_SERVICE_ACCOUNT (already set for send-notification.js) is
//      reused here for BOTH verifying the caller's ID token and for writing
//      the verification decision directly to Firestore via the Admin SDK.
//
// ARCHITECTURE — why the server owns every write here:
//
// Previously the client wrote its own 'pending' verificationRequests doc,
// then called this endpoint, then wrote the OCR result back itself. Besides
// being fragile (two client writes that both had to individually satisfy
// firestore.rules, see the earlier CHANGED-FILES notes), it meant a client
// could simply lie about the OCR result — nothing stopped a browser from
// calling setDoc({ ocrConfidence: 1, ocrDateOfBirth: '1990-01-01' }) itself.
//
// Now the client only ever does one thing: POST the image (plus its own
// claimed age/gender) here, authenticated by its Firebase ID token. This
// function does the entire lifecycle — create the pending record, run the
// checks, decide, and write the result — using the Admin SDK, which isn't
// subject to firestore.rules at all. firestore.rules now rejects a client
// trying to write verificationRequests directly (see the TIGHTENED comment
// there), so this endpoint is the only path in or out of that collection
// besides an admin's manual approve/decline.
//
// REVIEW LOGIC — what's automated and what still needs a human:
//
// Groq's vision model looks at the ID photo and reports, as structured JSON,
// whether it looks like a real government ID, what date of birth is printed
// on it, and anything that looks off (blurry, cropped, edited-looking). Only
// when Groq is confident AND reports no concerns does this function decide
// automatically — either 'approved' (clearly 18+, clean read) or 'declined'
// (clearly not an ID, or clearly under 18). Anything less certain — no date
// found, low confidence, flagged concerns, or Groq not configured/erroring —
// is left as 'pending' for a human reviewer in Admin Reports, exactly as
// before. OCR.space's plain-text regex pass runs alongside as a second,
// independent read of the printed date; it's shown to the human reviewer for
// cross-checking but never drives an automatic decision on its own, since (as
// the original version of this file already noted) OCR text extraction alone
// isn't reliable enough for that.
//
// Groq is deliberately asked to comment ONLY on the printed text and general
// document condition — never on the person's appearance, race, gender, or
// any other trait. Gender on Aura has never been independently verified
// (verifiedSex mirrors the self-reported value at signup) and this doesn't
// change that; inferring gender from a photo would be a different, far less
// reliable, and more invasive thing to build than reading a printed date.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';

// FIXED: see the matching comment in api/verify-selfie.js — this was
// JSON.parse(...) + initializeApp(...) with no try/catch at module scope,
// so a missing or malformed FIREBASE_SERVICE_ACCOUNT crashed the whole
// module before the handler existed to catch it, which Vercel returns as
// a bare 500 with no JSON body. That's why the client showed the literal
// string "HTTP 500" — there was no body to read a real message from.
let initError = null;
if (!getApps().length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({ credential: cert(serviceAccount) });
  } catch (err) {
    initError = err;
    console.error('Firebase admin init failed in verify-document.js', err);
  }
}
const db = initError ? null : getFirestore();

// Match Finder's own minimum (see MIN_MATCH_AGE in MatchFinder.jsx) — not
// the account-wide minimum of 16 used at Login, since this endpoint only
// ever runs for Match Finder verification.
const MIN_VERIFY_AGE = 18;
const COOLDOWN_MS = 60_000;
const MAX_ATTEMPTS = 6;
const GROQ_VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const ALLOWED_GENDERS = ['Female', 'Male', 'Non-binary', 'Prefer not to say'];

// Matches common date-of-birth formats found on ID documents:
// DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, and "DD Mon YYYY" (e.g. 05 Jan 2000).
const DATE_PATTERNS = [
  /\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b/,
  /\b(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})\b/,
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
      // DD/MM/YYYY assumed (most ID documents outside the US).
      return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
    } catch {
      continue;
    }
  }
  return null;
}

function ageFromDateOfBirth(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return null;
  const dob = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const hadBirthdayThisYear = now.getUTCMonth() > dob.getUTCMonth()
    || (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() >= dob.getUTCDate());
  if (!hadBirthdayThisYear) age -= 1;
  return age;
}

async function callOcrSpace(fileBase64, mimeType) {
  const apiKey = process.env.OCR_SPACE_API_KEY;
  if (!apiKey) return null;
  try {
    const response = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      headers: { apikey: apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        base64Image: `data:${mimeType || 'image/jpeg'};base64,${fileBase64}`,
        OCREngine: '2',
        scale: 'true',
        detectOrientation: 'true',
      }),
    });
    if (!response.ok) return null;
    const result = await response.json();
    if (result.IsErroredOnProcessing) return null;
    const text = result.ParsedResults?.[0]?.ParsedText || '';
    return extractDateOfBirth(text);
  } catch (err) {
    console.error('OCR.space request failed', err);
    return null;
  }
}

// Returns null (not an error) when Groq isn't configured or the call fails —
// the caller treats "no Groq result" the same as "inconclusive", which
// routes to a human rather than blocking the submission outright.
async function callGroqVision(fileBase64, mimeType) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const prompt = `You are assisting a human reviewer who checks government-issued ID photos for an age-verification flow. Look ONLY at the printed text and general condition of the document. Respond with ONLY a JSON object, no other text, matching exactly this shape:
{"looksLikeGovernmentId": boolean, "dateOfBirth": "YYYY-MM-DD" or null, "concerns": [string, ...], "confidence": number}

Rules:
- "looksLikeGovernmentId": false if this is clearly not an ID document — a random photo, a screenshot, a blank or unrelated image.
- "dateOfBirth": the date of birth printed on the document in YYYY-MM-DD format, or null if none is legible.
- "concerns": short phrases for anything that looks off (e.g. "blurry", "corner cropped off", "glare over the date", "appears edited"). Empty array if nothing stands out.
- "confidence": 0 to 1, your confidence in the dateOfBirth value specifically.
- Do not comment on the person's appearance, race, gender, or any trait other than what is printed as text on the document.`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GROQ_VISION_MODEL,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${fileBase64}` } },
          ],
        }],
        temperature: 0,
        max_tokens: 400,
        response_format: { type: 'json_object' },
      }),
    });
    if (!response.ok) {
      console.error('Groq vision request failed', response.status, await response.text().catch(() => ''));
      return null;
    }
    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content;
    const parsed = JSON.parse(raw);
    const dob = typeof parsed.dateOfBirth === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.dateOfBirth)
      ? parsed.dateOfBirth : null;
    return {
      looksLikeGovernmentId: parsed.looksLikeGovernmentId !== false,
      dateOfBirth: dob,
      concerns: Array.isArray(parsed.concerns) ? parsed.concerns.filter((c) => typeof c === 'string').slice(0, 10) : [],
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0,
    };
  } catch (err) {
    console.error('Groq vision call/parse failed', err);
    return null;
  }
}

export default async function handler(req, res) {
  if (initError || !db) {
    res.status(500).json({ error: 'Server verification setup is broken (Firebase credentials). Check FIREBASE_SERVICE_ACCOUNT in Vercel and the function logs for the exact error.' });
    return;
  }
  try {
    await handleVerifyDocument(req, res);
  } catch (err) {
    // FIXED: see the matching comment in api/verify-selfie.js — nothing
    // below this point used to be inside a try/catch, so any Firestore
    // Admin SDK call throwing (permissions, wrong project, etc.) crashed
    // the function the same opaque way a bad credential did.
    console.error('verify-document handler failed', err);
    res.status(500).json({ error: `Verification check failed unexpectedly. (${err?.message || 'unknown error'})` });
  }
}

async function handleVerifyDocument(req, res) {
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
  let uid;
  try {
    ({ uid } = await getAuth().verifyIdToken(idToken));
  } catch {
    res.status(401).json({ error: 'Invalid auth token' });
    return;
  }

  const { fileBase64, mimeType, age, gender } = req.body || {};
  if (!fileBase64) {
    res.status(400).json({ error: 'A verification document is required.' });
    return;
  }
  const numericAge = Number(age);
  if (!Number.isInteger(numericAge) || numericAge < 16) {
    res.status(400).json({ error: 'A valid age is required.' });
    return;
  }
  if (!ALLOWED_GENDERS.includes(gender)) {
    res.status(400).json({ error: 'A valid gender selection is required.' });
    return;
  }

  const requestRef = db.collection('verificationRequests').doc(uid);
  const existingSnap = await requestRef.get();
  const existing = existingSnap.exists ? existingSnap.data() : null;

  // See the setup note at the top of this file re: exact free-tier numbers.
  // This is intentionally simple — a flat per-account cooldown plus a hard
  // attempt cap — rather than tuned to whatever Groq/OCR.space currently
  // publish, since those change.
  if (existing) {
    const lastAttemptMs = existing.lastAttemptAt?.toMillis?.() || 0;
    if (Date.now() - lastAttemptMs < COOLDOWN_MS) {
      res.status(429).json({ error: 'Please wait a moment before resubmitting.' });
      return;
    }
    if ((existing.attempts || 0) >= MAX_ATTEMPTS && existing.status !== 'approved') {
      res.status(429).json({ error: 'Too many attempts. A human reviewer will follow up on your existing submission.' });
      return;
    }
  }

  await requestRef.set({
    uid,
    age: numericAge,
    gender,
    status: 'pending',
    submittedAt: existing?.submittedAt || Timestamp.now(),
    lastAttemptAt: Timestamp.now(),
    attempts: FieldValue.increment(1),
  }, { merge: true });

  const [groqResult, ocrDateOfBirth] = await Promise.all([
    callGroqVision(fileBase64, mimeType),
    callOcrSpace(fileBase64, mimeType),
  ]);

  const groqAge = groqResult?.dateOfBirth ? ageFromDateOfBirth(groqResult.dateOfBirth) : null;
  // Shown to the admin either way; only Groq's own reading ever drives an
  // automatic decision (see the file header for why).
  const bestDateOfBirth = groqResult?.dateOfBirth || ocrDateOfBirth || '';
  const bestAge = groqAge !== null ? groqAge : (ocrDateOfBirth ? ageFromDateOfBirth(ocrDateOfBirth) : null);
  const concerns = groqResult?.concerns || [];
  const confidence = groqResult?.confidence ?? 0;

  let status = 'pending';
  let declineReason = '';

  if (groqResult) {
    if (!groqResult.looksLikeGovernmentId) {
      status = 'declined';
      declineReason = 'The submitted image does not appear to be a government-issued ID.';
    } else if (groqAge !== null && confidence >= 0.55 && concerns.length === 0) {
      if (groqAge < MIN_VERIFY_AGE) {
        status = 'declined';
        declineReason = `The document indicates an age under ${MIN_VERIFY_AGE}.`;
      } else {
        status = 'approved';
      }
    }
  }
  // Anything else — no confident Groq read, concerns flagged, or Groq
  // unavailable — stays 'pending' for Admin Reports, which now shows
  // bestDateOfBirth/bestAge/confidence/concerns for the human to weigh.

  await requestRef.set({
    status,
    ocrDateOfBirth: bestDateOfBirth,
    ocrAge: bestAge,
    ocrConfidence: confidence,
    ocrConcerns: concerns,
    declineReason,
    verificationMethod: 'document',
    reviewedAt: status === 'pending' ? '' : Timestamp.now(),
    reviewerId: status === 'pending' ? '' : 'ai:groq-document',
  }, { merge: true });

  // Mirrors exactly what AdminReports.reviewVerification writes for a manual
  // decision, so nothing downstream (MatchFinder's verifiedForMatch check)
  // needs to know or care whether a human or the AI made the call.
  if (status === 'approved' || status === 'declined') {
    await db.collection('users').doc(uid).set({
      verified: status === 'approved',
      verificationStatus: status,
      verifiedSex: gender || '',
      verifiedAt: Timestamp.now(),
      verificationExpiresAt: Timestamp.fromMillis(Date.now() + 365 * 24 * 60 * 60 * 1000),
    }, { merge: true });
  }

  res.status(200).json({
    status, dateOfBirth: bestDateOfBirth, confidence, concerns, declineReason,
  });
}
