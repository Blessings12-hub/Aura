// api/verify-selfie.js
//
// The fast path Roblox-style facial age estimation inspired, but scoped
// deliberately narrow: this can ONLY ever grant an early approval for
// someone who is obviously, confidently an adult. It can never decline
// anyone, and it never blocks access to the document flow — see
// api/verify-document.js, which remains the authoritative fallback for
// every case this doesn't confidently resolve.
//
// WHY IT ONLY EVER APPROVES, NEVER DECLINES:
// A face-based age estimate from a general vision model is a much weaker
// signal than a printed date of birth on a government document, and it's
// well documented that these models are least accurate exactly at the
// 13-20 boundary that matters here, with accuracy that also isn't uniform
// across demographics. Letting a bad read wrongly APPROVE someone is bad;
// letting a bad read wrongly DECLINE a real adult would be worse for no
// good reason, since the document flow already exists as an easy fallback
// — declining off a selfie would just be adding a way to fail with no
// corresponding benefit. So: confident-adult -> approve immediately.
// Anything else -> no change, "please use the ID upload below" instead.
//
// WHY THE BAR IS SET WELL ABOVE 18, NOT AT 18:
// The margin exists to absorb estimation error. A model whose average error
// is a few years in either direction will sometimes read a genuine 18-year-
// old as visually 15, which is fine (falls through to the document flow,
// no harm) — but it will just as often read a genuine 15-year-old as
// visually 19, which would be a real miss if the approval threshold sat
// right at 18. Requiring a high-confidence estimate comfortably above 18
// (see MIN_ESTIMATED_AGE below) makes that specific failure much less
// likely, at the cost of more adults falling through to the ID flow
// unnecessarily — a deliberate, conservative trade given what's at stake
// on the other side of it.
//
// PRIVACY: the same as verify-document.js — the image lives only in this
// function's memory for the length of one request and is never written to
// storage. A face photo is a more sensitive category of data than a
// document photo in most privacy frameworks (it's biometric on its own,
// not just a document containing biometric data), which is exactly why
// this function's job is to look at it once and forget it, not to keep or
// analyze it further.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';

// FIXED: this used to be JSON.parse(...) and initializeApp(...) with no
// try/catch, at module scope — meaning a missing or malformed
// FIREBASE_SERVICE_ACCOUNT (the single most common cause of this: Vercel's
// env var UI mangling the private_key field's embedded newlines when it's
// pasted in) crashed the ENTIRE module before the handler function below
// even existed to catch anything. Vercel returns that as a bare 500 with
// no JSON body, which is exactly why the client showed the unhelpful
// literal string "HTTP 500" instead of a real message — there was no body
// for it to read a message out of.
let initError = null;
if (!getApps().length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({ credential: cert(serviceAccount) });
  } catch (err) {
    initError = err;
    console.error('Firebase admin init failed in verify-selfie.js', err);
  }
}
const db = initError ? null : getFirestore();

const MIN_VERIFY_AGE = 18;
// How far above MIN_VERIFY_AGE the model's estimate must sit before this
// function will act on it at all. See the file header for the reasoning.
const MIN_ESTIMATED_AGE = 23;
const MIN_CONFIDENCE = 0.7;
const COOLDOWN_MS = 60_000;
const MAX_ATTEMPTS = 6;
const GROQ_VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const ALLOWED_GENDERS = ['Female', 'Male', 'Non-binary', 'Prefer not to say'];

async function callGroqSelfieCheck(fileBase64, mimeType) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const prompt = `You are doing a narrow, single-purpose visual age estimate for an age-gate. Look at the photo and respond with ONLY a JSON object, no other text, matching exactly this shape:
{"facesDetected": number, "estimatedAge": number or null, "confidence": number, "concerns": [string, ...]}

Rules:
- "facesDetected": how many distinct human faces are clearly visible. 0 if none, 1 if exactly one clear face, 2+ if more than one.
- "estimatedAge": your best single-number age estimate in years for the primary face, based only on general visual age cues (approximate skin/face maturity). null if facesDetected is not exactly 1, or the face is too unclear to estimate.
- "confidence": 0 to 1, how confident you are in that specific number.
- "concerns": short phrases for anything that undermines a live capture — e.g. "appears to be a photo of a screen or printed photo", "image looks AI-generated", "face partially obscured", "very low light". Empty array if nothing stands out.
- Do not describe or comment on the person's race, ethnicity, gender presentation, attractiveness, or any trait other than an approximate age estimate and the technical concerns listed above.`;

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
        max_tokens: 300,
        response_format: { type: 'json_object' },
      }),
    });
    if (!response.ok) {
      console.error('Groq selfie request failed', response.status, await response.text().catch(() => ''));
      return null;
    }
    const data = await response.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content);
    return {
      facesDetected: Number.isInteger(parsed.facesDetected) ? parsed.facesDetected : 0,
      estimatedAge: typeof parsed.estimatedAge === 'number' ? parsed.estimatedAge : null,
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0,
      concerns: Array.isArray(parsed.concerns) ? parsed.concerns.filter((c) => typeof c === 'string').slice(0, 10) : [],
    };
  } catch (err) {
    console.error('Groq selfie call/parse failed', err);
    return null;
  }
}

export default async function handler(req, res) {
  if (initError || !db) {
    // A clear, actionable message instead of a crash — if this is what's
    // showing, the fix is in Vercel's environment variables, not the code:
    // re-paste FIREBASE_SERVICE_ACCOUNT as a single-line JSON string (the
    // private_key field's \n sequences need to survive intact — copying
    // out of a text editor that reformats them is the usual culprit).
    res.status(500).json({ error: 'Server verification setup is broken (Firebase credentials). Check FIREBASE_SERVICE_ACCOUNT in Vercel and the function logs for the exact error.' });
    return;
  }
  try {
    await handleVerifySelfie(req, res);
  } catch (err) {
    // FIXED: previously nothing below this point was inside a try/catch —
    // any Firestore Admin SDK call throwing (wrong project, missing IAM
    // permissions on the service account, Firestore not enabled, etc.)
    // crashed the function the same opaque way a bad credential did. This
    // is the other half of that fix: whatever goes wrong from here on
    // now reaches the client as a real, readable message, and the full
    // error is still logged server-side for the Vercel function log.
    console.error('verify-selfie handler failed', err);
    res.status(500).json({ error: `Verification check failed unexpectedly. (${err?.message || 'unknown error'})` });
  }
}

async function handleVerifySelfie(req, res) {
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
    res.status(400).json({ error: 'A photo is required.' });
    return;
  }
  const numericAge = Number(age);
  // The self-reported age is what the person already told the app. The
  // selfie fast-path exists to skip the ID upload for an obvious adult —
  // it was never meant to be a way to override what someone already told
  // Aura about themselves, so anyone reporting under 18 is sent straight
  // to the document flow (which itself would decline them) rather than
  // being run through this at all.
  if (!Number.isInteger(numericAge) || numericAge < MIN_VERIFY_AGE) {
    res.status(400).json({ error: 'The selfie check is only available for accounts reporting 18 or older.' });
    return;
  }
  if (!ALLOWED_GENDERS.includes(gender)) {
    res.status(400).json({ error: 'A valid gender selection is required.' });
    return;
  }

  const requestRef = db.collection('verificationRequests').doc(uid);
  const existingSnap = await requestRef.get();
  const existing = existingSnap.exists ? existingSnap.data() : null;

  if (existing?.status === 'approved') {
    res.status(200).json({ approved: true, alreadyVerified: true });
    return;
  }

  // Shared cooldown/attempt bookkeeping with verify-document.js (same
  // fields on the same document) — this and the ID upload draw from one
  // combined budget so alternating between the two doesn't double the
  // effective rate limit.
  if (existing) {
    const lastAttemptMs = existing.lastAttemptAt?.toMillis?.() || 0;
    if (Date.now() - lastAttemptMs < COOLDOWN_MS) {
      res.status(429).json({ error: 'Please wait a moment before trying again.' });
      return;
    }
    if ((existing.attempts || 0) >= MAX_ATTEMPTS) {
      res.status(429).json({ error: 'Too many attempts. Please submit an ID document instead.' });
      return;
    }
  }

  // Bookkeeping only — deliberately does NOT touch `status`. A selfie
  // attempt that doesn't confidently resolve should leave no trace an
  // admin would mistake for a real pending review (which needs the
  // document flow's richer data to act on); it should just count against
  // the shared rate limit and otherwise be invisible.
  await requestRef.set({
    uid,
    age: numericAge,
    gender,
    lastAttemptAt: Timestamp.now(),
    attempts: FieldValue.increment(1),
  }, { merge: true });

  const result = await callGroqSelfieCheck(fileBase64, mimeType);

  const confidentAdult = result
    && result.facesDetected === 1
    && result.estimatedAge !== null
    && result.estimatedAge >= MIN_ESTIMATED_AGE
    && result.confidence >= MIN_CONFIDENCE
    && result.concerns.length === 0;

  if (!confidentAdult) {
    res.status(200).json({
      approved: false,
      reason: !result ? 'unavailable' : (result.facesDetected !== 1 ? 'no_single_face' : 'inconclusive'),
    });
    return;
  }

  await requestRef.set({
    status: 'approved',
    verificationMethod: 'selfie',
    reviewedAt: Timestamp.now(),
    reviewerId: 'ai:groq-selfie',
  }, { merge: true });

  await db.collection('users').doc(uid).set({
    verified: true,
    verificationStatus: 'approved',
    verifiedSex: gender || '',
    verifiedAt: Timestamp.now(),
    verificationExpiresAt: Timestamp.fromMillis(Date.now() + 365 * 24 * 60 * 60 * 1000),
  }, { merge: true });

  res.status(200).json({ approved: true });
}
