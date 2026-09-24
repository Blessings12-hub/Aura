// api/escalate-verifications.js
//
// Triggered by an external scheduler — NOT a Vercel Cron Job. Vercel's
// Hobby plan restricts Cron Jobs to once-per-day minimum (an hourly
// schedule fails at deploy time outright), and this project has stayed on
// the free tier everywhere else, so pushing you onto Vercel Pro just for
// this felt wrong to do quietly. See
// .github/workflows/verification-escalation.yml — a GitHub Actions
// scheduled workflow, genuinely free, that pings this endpoint hourly.
//
// SETUP NEEDED:
//   1. Generate a random secret (anything long and unguessable — e.g.
//      `openssl rand -hex 32`, or any password generator).
//   2. Add it as CRON_SECRET in Vercel -> Settings -> Environment Variables.
//   3. Add the SAME value as a GitHub repo secret named CRON_SECRET
//      (Settings -> Secrets and variables -> Actions -> New repository
//      secret). Both need the identical value — it's how this endpoint
//      tells "the real scheduled job" apart from anyone else on the
//      internet who finds this URL, since there's no signed-in user to
//      check an ID token against here.
//
// WHAT THIS DOES, each time it runs:
//   1. Finds every verificationRequests doc that's still 'pending' and was
//      submitted more than an hour ago — i.e., nobody reviewed it by hand
//      in time.
//   2. For each one, runs the same Groq vision analysis the old
//      verify-document.js used to run instantly at submission — except
//      now it gets BOTH images together (the selfie and the ID), and asks
//      Groq to also compare them: does the person in the selfie plausibly
//      match the photo on the ID? That's a real check the old single-image
//      flow couldn't do, and directly serves "know it's genuine" even on
//      the automatic path, not just the manual one.
//   3. Decides approved/declined/still-inconclusive using the same
//      confidence-gated philosophy as before: only a confident, clean read
//      decides anything; anything murkier stays 'pending' rather than
//      guessing, and will just get picked up again on the NEXT hourly run
//      (so it isn't stuck — it gets more chances, not zero).
//   4. Either way — decided or still pending — deletes the stored images
//      for anything OLDER than 24h regardless of outcome, as a backstop.
//      (Freshly-decided ones are deleted immediately as part of the same
//      pass; this second sweep only matters for the rare case something
//      stayed inconclusive across many runs.)
//   5. Notifies the applicant once a decision is actually made.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

let initError = null;
if (!getApps().length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({ credential: cert(serviceAccount) });
  } catch (err) {
    initError = err;
    console.error('Firebase admin init failed in escalate-verifications.js', err);
  }
}
const db = initError ? null : getFirestore();

const MIN_VERIFY_AGE = 18;
const ESCALATE_AFTER_MS = 60 * 60 * 1000; // 1 hour
// TIGHTENED, per explicit request to minimize this: was 48h. Normal
// operation never actually reaches this sweep — a request is either
// decided within an hour or two (images deleted immediately either way,
// see below) or picked up again on the very next hourly run. This is
// purely a backstop for the rare case something stays undecided across
// many runs (e.g. a Groq outage spanning hours), and 24h is enough slack
// for that without leaving sensitive photos around for two full days.
const IMAGE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MIN_CONFIDENCE = 0.6;
const GROQ_VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const BASE_URL = 'https://aura-blush-zeta.vercel.app';

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

// The one real upgrade over the old single-image analysis: both photos go
// to Groq in the SAME call, so it can reason about them together rather
// than each in isolation. Groq's vision models accept multiple images per
// message (up to 5), which is what makes this possible in one round trip.
async function analyzeSubmission(idBase64, idMimeType, selfieBase64, selfieMimeType) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const prompt = `You are assisting a human reviewer verifying that an ID document and a live selfie belong to the same person and show someone of adult age. You are given two images: the FIRST is a government-issued ID document, the SECOND is a live selfie photo. Respond with ONLY a JSON object, no other text, matching exactly this shape:
{"looksLikeGovernmentId": boolean, "dateOfBirth": "YYYY-MM-DD" or null, "selfieShowsSingleFace": boolean, "faceLikelyMatchesId": boolean or null, "concerns": [string, ...], "confidence": number}

Rules:
- "looksLikeGovernmentId": false if the first image is clearly not an ID document.
- "dateOfBirth": the date of birth printed on the ID, in YYYY-MM-DD, or null if not legible.
- "selfieShowsSingleFace": true only if the second image clearly shows exactly one human face.
- "faceLikelyMatchesId": your best judgment on whether the face in the selfie plausibly matches the photo on the ID — general resemblance only (bone structure, general features), not a biometric-grade match. null if you can't judge (ID photo unclear, selfie unclear, etc).
- "concerns": short phrases for anything that undermines confidence — "ID photo blurry", "selfie appears to be a photo of a screen", "dates don't align", "faces look like different people", etc. Empty array if nothing stands out.
- "confidence": 0 to 1, your overall confidence in this being a genuine, matching submission.
- Do not comment on race, ethnicity, gender presentation, or attractiveness — only the technical/identity assessment described above.`;

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
            { type: 'image_url', image_url: { url: `data:${idMimeType || 'image/jpeg'};base64,${idBase64}` } },
            { type: 'image_url', image_url: { url: `data:${selfieMimeType || 'image/jpeg'};base64,${selfieBase64}` } },
          ],
        }],
        temperature: 0,
        max_tokens: 400,
        response_format: { type: 'json_object' },
      }),
    });
    if (!response.ok) {
      console.error('Groq escalation request failed', response.status, await response.text().catch(() => ''));
      return null;
    }
    const data = await response.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content);
    return {
      looksLikeGovernmentId: parsed.looksLikeGovernmentId !== false,
      dateOfBirth: typeof parsed.dateOfBirth === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.dateOfBirth) ? parsed.dateOfBirth : null,
      selfieShowsSingleFace: Boolean(parsed.selfieShowsSingleFace),
      faceLikelyMatchesId: typeof parsed.faceLikelyMatchesId === 'boolean' ? parsed.faceLikelyMatchesId : null,
      concerns: Array.isArray(parsed.concerns) ? parsed.concerns.filter((c) => typeof c === 'string').slice(0, 10) : [],
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0,
    };
  } catch (err) {
    console.error('Groq escalation call/parse failed', err);
    return null;
  }
}

async function notifyUser(uid, title, body) {
  try {
    const tokenSnap = await db.doc(`pushTokens/${uid}`).get();
    const token = tokenSnap.exists ? tokenSnap.data()?.token : null;
    if (!token) return;
    await getMessaging().send({
      token,
      notification: { title, body },
      webpush: {
        fcmOptions: { link: `${BASE_URL}/login` },
        notification: { icon: '/icon-192.png' },
      },
    });
  } catch (err) {
    console.error('notifyUser failed', uid, err?.code || err);
  }
}

export default async function handler(req, res) {
  if (initError || !db) {
    res.status(500).json({ error: 'Server setup is broken (Firebase credentials).' });
    return;
  }

  const providedSecret = req.headers['x-cron-secret'];
  if (!process.env.CRON_SECRET || providedSecret !== process.env.CRON_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const result = await runEscalation();
    res.status(200).json(result);
  } catch (err) {
    console.error('escalate-verifications failed', err);
    res.status(500).json({ error: `Escalation run failed. (${err?.message || 'unknown error'})` });
  }
}

async function runEscalation() {
  const cutoff = Timestamp.fromMillis(Date.now() - ESCALATE_AFTER_MS);
  const pendingSnap = await db.collection('verificationRequests')
    .where('status', '==', 'pending')
    .where('submittedAt', '<=', cutoff)
    .get();

  let decided = 0;
  let stillPending = 0;
  let skippedNoImages = 0;

  await Promise.all(pendingSnap.docs.map(async (requestDoc) => {
    const uid = requestDoc.id;
    const request = requestDoc.data();

    const imagesSnap = await db.collection('verificationImages').doc(uid).get();
    if (!imagesSnap.exists) {
      // Most likely an admin already reviewed and deleted the images
      // between this query starting and now, and the status write just
      // hasn't been picked up by a re-query — nothing to do here.
      skippedNoImages += 1;
      return;
    }
    const images = imagesSnap.data();

    const analysis = await analyzeSubmission(
      images.idBase64, images.idMimeType, images.selfieBase64, images.selfieMimeType,
    );

    let status = 'pending';
    let declineReason = '';

    if (analysis) {
      const computedAge = analysis.dateOfBirth ? ageFromDateOfBirth(analysis.dateOfBirth) : null;
      const clean = analysis.confidence >= MIN_CONFIDENCE && analysis.concerns.length === 0;

      if (!analysis.looksLikeGovernmentId) {
        status = 'declined';
        declineReason = 'The submitted image does not appear to be a government-issued ID.';
      } else if (!analysis.selfieShowsSingleFace) {
        status = 'declined';
        declineReason = 'The selfie does not clearly show a single face.';
      } else if (clean && analysis.faceLikelyMatchesId === false) {
        status = 'declined';
        declineReason = 'The selfie does not appear to match the person on the ID.';
      } else if (clean && computedAge !== null) {
        if (computedAge < MIN_VERIFY_AGE) {
          status = 'declined';
          declineReason = `The document indicates an age under ${MIN_VERIFY_AGE}.`;
        } else if (analysis.faceLikelyMatchesId === true) {
          status = 'approved';
        }
        // faceLikelyMatchesId === null (Groq couldn't judge) with
        // everything else clean: deliberately stays 'pending' rather than
        // approving on age alone — the whole point of requiring both
        // images was the identity match, not just the birthdate.
      }
    }

    if (status === 'pending') {
      stillPending += 1;
      // Nothing to write — it'll be picked up again on the next hourly
      // run. Images are left in place (still needed for that next pass).
      return;
    }

    decided += 1;
    await db.collection('verificationRequests').doc(uid).set({
      status,
      declineReason,
      reviewedAt: Timestamp.now(),
      reviewerId: 'ai:groq-escalated',
    }, { merge: true });

    if (status === 'approved' || status === 'declined') {
      await db.collection('users').doc(uid).set({
        verified: status === 'approved',
        verificationStatus: status,
        // FIXED: this used to write only verifiedSex, never the base
        // gender/age fields. Match Finder's profile editor prefills its
        // own gender field from the base `gender`, not `verifiedSex` —
        // and firestore.rules' validMatchAge() requires those two to be
        // EQUAL before a match card can be saved at all. Anyone who was
        // verified with a different gender than whatever their account
        // doc already held (picked a different option at the gate than
        // what was on file, or edited it in Account Settings afterward)
        // would pass verification but then get "permission-denied" on
        // every attempt to save a Match Finder profile — an unrelated-
        // looking action, no error message pointing anywhere near the
        // actual cause. Writing gender/age here alongside verifiedSex
        // keeps the account's base fields in sync with whatever was
        // actually verified, which is the only copy that should matter
        // once a decision exists.
        gender: request.gender || '',
        age: request.age,
        verifiedSex: request.gender || '',
        verifiedAt: Timestamp.now(),
        verificationExpiresAt: Timestamp.fromMillis(Date.now() + 365 * 24 * 60 * 60 * 1000),
      }, { merge: true });
    }

    await db.collection('verificationImages').doc(uid).delete().catch(() => {});

    await notifyUser(
      uid,
      status === 'approved' ? "You're verified!" : 'Verification update',
      status === 'approved'
        ? 'Match Finder is unlocked.'
        : (declineReason || 'Your verification was declined.'),
    );
  }));

  // Backstop sweep: anything older than 24h gets its images deleted no
  // matter what state it's in. Normal operation should never actually
  // reach this — a request is either decided (images deleted above) or
  // still pending and gets re-tried every hour — but a Groq outage
  // spanning many hours, or any other stuck edge case, shouldn't leave
  // sensitive photos sitting around indefinitely.
  let sweptOld = 0;
  const oldImagesSnap = await db.collection('verificationImages')
    .where('createdAt', '<=', Timestamp.fromMillis(Date.now() - IMAGE_TTL_MS))
    .get();
  await Promise.all(oldImagesSnap.docs.map(async (imgDoc) => {
    await imgDoc.ref.delete().catch(() => {});
    sweptOld += 1;
  }));

  return {
    checked: pendingSnap.size, decided, stillPending, skippedNoImages, sweptOld,
  };
}
