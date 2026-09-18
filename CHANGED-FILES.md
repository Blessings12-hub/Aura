# Aura — selfie fast-path verification (Match Finder + Login)

Six files, one new component, one new endpoint. Extract over `Aura-main/`,
on top of the three earlier patches. No firestore.rules changes this time
— both new endpoints use the Firebase Admin SDK like verify-document.js
already does, so they're not subject to the rules at all.

You already have `GROQ_API_KEY` set from the last patch — nothing new
needed in Vercel for this one.

## What this is

A fast, conservative first pass modeled on what Roblox actually does
(estimate first, fall back to full verification for anyone it can't
confidently call) — not a replacement for the ID document check, which
remains the authoritative fallback exactly as before.

**It can only ever approve, never decline.** A face-based estimate from a
general vision model is a weaker signal than a printed date of birth, and
it's documented to be least accurate exactly at the 13-20 boundary that
matters here — with accuracy that isn't uniform across demographics either.
Letting a bad read wrongly approve someone would be a real problem; letting
a bad read wrongly decline a genuine adult would just be adding a failure
mode with no benefit, since the document upload is always sitting right
there as a fallback. So a low-confidence or ambiguous selfie just falls
through silently to "please use the ID upload instead" — nothing is
recorded that an admin would mistake for a real pending case.

**The approval bar sits well above 18, not at 18** (`MIN_ESTIMATED_AGE = 23`
in `api/verify-selfie.js`) — deliberately, to absorb estimation error in the
direction that matters. A model that's off by a few years will sometimes
read a genuine 18-year-old as visually 15 (harmless — falls through to the
document flow), but it would just as often read a genuine 15-year-old as
visually 19 if the bar sat right at 18. Requiring a confident read
comfortably above the line makes that specific failure much less likely, at
the cost of sending more real adults to the ID upload than strictly
necessary. That trade is intentional given what's on the other side of it.

**No liveness detection** — this was flagged in the conversation that led
here and is still true. A live camera capture (not a file picker) is a
small mitigation, not a fix; nothing here proves it wasn't a photo held up
to another screen. That gap is exactly what paid vendors like Persona/Yoti
are selling, and there's no free equivalent.

## How the pieces fit together

- **`api/verify-selfie.js`** (new) — the endpoint. Verifies the caller's
  Firebase ID token, requires the self-reported age to already be 18+
  (selfie fast-track was never meant to override what someone already told
  the app about themselves — under-18 self-reports are routed straight to
  the document flow, which would decline them anyway), sends the photo to
  Groq with a prompt scoped to visual age estimation only — explicitly told
  not to comment on race, ethnicity, or gender — and only writes anything
  to Firestore (via the Admin SDK) on a confident approval. Shares its rate
  limit (60s cooldown, 6 attempts) with the document endpoint on the same
  `verificationRequests/{uid}` document, so alternating between the two
  doesn't double the effective budget.

- **`src/components/SelfieVerification.jsx`** (new) — the camera UI, built
  once and used from both pages. Handles `getUserMedia`, a live preview,
  capture-and-submit, and releasing the camera on unmount or navigation.
  Needs nothing back from its parent: an approval is written server-side
  and picked up automatically by the Firestore listeners that already exist
  elsewhere (`useCurrentUser`'s listener on `users/{uid}`, and MatchFinder's
  own listener on `verificationRequests/{uid}`) — this component only
  reports its own local status message.

- **`src/lib/verificationService.js`** — added `submitSelfieCheck` and
  `captureVideoFrameAsBase64` alongside the existing `submitIdentityDocument`.
  Selfies are resized smaller than ID photos (900px vs 1400px) since a face
  doesn't need the resolution small printed text does.

- **`src/pages/MatchFinder.jsx`** — the hard gate now offers the selfie
  check first, with the ID upload underneath as the option that "always
  works, no camera needed."

- **`src/pages/Login.jsx`** — this is the part worth reading closely, because
  it's not just "add the same widget." Verification used to be offered
  *inside* the signup form, before the account existed. That's fine for the
  ID upload (which never touched Firestore from the client anyway once the
  last patch moved everything server-side) — but it would have been a real
  bug for the selfie check specifically: if someone ran it *before* clicking
  "Sign in", the server would create `users/{uid}` immediately with only
  verification fields on it — no `age`/`gender`/`avatarColor`/`createdAt`,
  which every other page's `useCurrentUser` hook treats as "this account is
  real and complete." That could have let someone into the anonymous
  activities with a half-written profile before they'd actually finished
  signing up.

  Fixed by moving verification to a new step *after* signup completes:
  `handleLogin` now creates the full profile doc first, then shows a
  "You're in! Want to unlock Match Finder too?" screen with the same selfie
  check + ID upload, with a "Continue to Aura" button to skip it. By the
  time either verification path can run, `users/{uid}` is guaranteed to
  already have every field it should. This is also, incidentally, a better
  signup flow — the initial form is shorter, and verification is presented
  once the person already has something to lose by not finishing it.

## Files

| File | What changed |
|---|---|
| `api/verify-selfie.js` | New — Groq-based selfie fast path |
| `api/verify-document.js` | Tiny rename for consistency: `reviewerId: 'ai:groq'` → `'ai:groq-document'`, added `verificationMethod: 'document'` |
| `src/components/SelfieVerification.jsx` | New — shared camera capture widget |
| `src/lib/verificationService.js` | Added `submitSelfieCheck` / `captureVideoFrameAsBase64` |
| `src/pages/MatchFinder.jsx` | Gate now offers selfie check + ID upload together |
| `src/pages/Login.jsx` | Verification moved to a new post-signup step, for the partial-account reason above |
