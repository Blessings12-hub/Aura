# Aura — fix the login redirect, hard-gate Match Finder, add AI document review

Six files. Extract over `Aura-main/`. Apply on top of the two earlier
patches (auth-race fix, login/rules fix) — this doesn't re-touch anything
those already fixed.

**You need two things in Vercel before this works:**
- `GROQ_API_KEY` — free account at console.groq.com. Check
  console.groq.com/settings/limits for your account's current free-tier
  rate limits; they're not fixed and I'm not going to quote a number I
  can't verify is still accurate by the time you read this.
- `OCR_SPACE_API_KEY` — you should already have this from the earlier
  Firebase+OCR.space migration.

`firestore.rules` is one of the six files — redeploy it:
`firebase deploy --only firestore:rules`.

---

## 1. Why login went straight to Match Finder

`handleLogin` in `Login.jsx` ended with:

```js
navigate('/aura/match', { replace: true });
```

Unconditional — every new sign-up, verified or not, skipped the activity hub
entirely and landed in the one activity that actually requires 18+ and ID
verification. Nothing decided this on purpose: `handleRecover`, right above
it, already sends a returning user to `/aura` (the hub). `/aura/match` was
almost certainly a leftover from testing Match Finder specifically.

Fixed: new sign-ups now land on `/aura`, same as recovery. One line.

## 2. Scope decision, per your answers

Verification is required for Match Finder only. Mood Chat, Daily Question,
Skill Swap, Event Buddy, and Letters are untouched — they never read
`user.verificationStatus` and nothing in this patch changes that. Once
someone submits a document, they're blocked until it's actually approved —
submitting alone doesn't let them in.

## 3. Match Finder now hard-gates, not just nags

Before: an unverified person could browse the deck, view profiles, and see
matches — only clicking "Save profile" was blocked. The "verify" prompt was
a card wedged into the middle of a fully-functional page.

Now: `MatchFinder.jsx` returns a dedicated blocking screen — no deck, no
profile editor, nothing else — until `verifiedForMatch` is true. The screen
shows one of three states, read live from `verificationRequests/{uid}`:
nothing submitted (error: submit a document), pending (your existing
attempt is being reviewed, unlocks automatically), or declined (with the
reason, and another chance to submit). This is the literal "bring an error
until they submit their documents" you asked for, now enforced as a real
gate instead of a suggestion.

**Also fixed while I was in there:** the deck-loading effect had an empty
dependency array (`useEffect(..., [])`) but read `user?.verificationStatus`
inside it. Since deps never changed, React only ever evaluated that check
using whatever `user` was on the component's very first render — which is
`null` before the profile finishes loading. So the deck subscription almost
never started, even for an already-approved account, and never retried once
`user` actually arrived. This would have undermined the new hard gate too
(approved users landing on a page that hard-gates correctly but then never
loads any cards). Fixed by depending on the two fields the check reads.

## 4. AI document review — Groq vision, OCR.space as a second read

`api/verify-document.js` is a full rewrite. What changed:

**All Firestore writes moved server-side.** Previously the client wrote its
own `pending` request doc, then separately wrote back an "OCR result" it
claimed to have gotten. Nothing stopped a browser from just lying about
that second write — `setDoc({ ocrConfidence: 1, ocrDateOfBirth: '1990-01-01' })`
would have sailed straight through the rules as they were. Now the client's
only job is to POST the image, its own claimed age/gender, and its Firebase
ID token; the server does the entire lifecycle — create the pending record,
run both checks, decide, write the result — via the Firebase Admin SDK,
which isn't subject to `firestore.rules` at all. `firestore.rules` now
rejects a client trying to write `verificationRequests` directly (`allow
create: if false`), so the API route is the only path in besides an admin's
manual override. This is the literal "tighten the rules" — not adding more
allowed fields, removing the client's write access entirely.

**Groq does the automatic review.** `meta-llama/llama-4-scout-17b-16e-instruct`
looks at the ID photo and returns structured JSON: does this look like a
real government ID, what date of birth is printed on it, anything that
looks off (blurry, cropped, edited-looking), and how confident it is in that
date specifically. It's deliberately instructed to comment only on printed
text and document condition — never on the person's appearance, race, or
gender. That's not a new restriction so much as staying consistent with how
the app already worked: `verifiedSex` has only ever mirrored the
self-reported gender from signup, and inferring gender from a photo would be
a different, much less reliable, and more invasive thing to build than
reading a printed date. I didn't build that, and I don't think you want it.

**Only a confident, clean Groq read decides automatically.** Approved
requires the model to recognize it as a government ID, extract a date,
confidence ≥ 0.55, and zero flagged concerns, and the computed age is 18+.
Declined is the mirror case — same confidence bar, but under 18, or the
image clearly isn't an ID at all. Anything murkier — no date found, low
confidence, a flagged concern, or Groq not configured/erroring — stays
`pending` for a human, exactly like the original OCR.space-only version did.
OCR.space still runs in parallel on every submission as a second, independent
read of the printed date; it's shown to the human reviewer for cross-checking
but never drives an automatic decision by itself, since (as the file's own
original comment already said) plain-text regex extraction alone isn't
reliable enough for that.

**Admin Reports now shows what the AI saw**, for the cases that do land in
front of a human: the document's read DOB, computed age, confidence
percentage, and any flagged concerns, plus a mismatch warning if the
document's computed age disagrees with what the person typed at signup.
Previously that screen showed only the self-reported age/gender with nothing
to check it against — approving was closer to a rubber stamp than a review.

**A lightweight cooldown and attempt cap** (60 seconds between submissions,
6 attempts before it's locked to manual-only) stop someone from burning
through your Groq/OCR.space free-tier quota by resubmitting rapidly. These
are deliberately conservative guesses, not tuned to a specific published
limit — see the note at the top of `api/verify-document.js`.

**The client-side image is now resized before upload** (`verificationService.js`),
same idea as the existing avatar-photo resizer but larger — 1400px on the
long edge, since small printed text like a date of birth needs to survive
the resize. A real phone photo of an ID is commonly 3-8MB raw; unresized,
that regularly exceeded Vercel's default ~4.5MB function body limit and
failed silently before either OCR.space or Groq ever saw it. This also cuts
your OCR.space/Groq bandwidth per submission.

## Files

| File | What changed |
|---|---|
| `src/pages/Login.jsx` | Routing fix (1 line) + calls the unified `submitIdentityDocument` with age/gender instead of writing `verificationRequests` itself + copy update on the optional upload field |
| `src/pages/MatchFinder.jsx` | Hard verification gate replaces the inline nag; fixed the stale-closure deck-loading bug; reads live request status; passes age/gender into verification |
| `src/lib/verificationService.js` | Resizes the ID photo client-side; no longer writes Firestore itself; sends age/gender to the server |
| `api/verify-document.js` | Full rewrite — server-authoritative Firestore writes, Groq vision auto-review, OCR.space as a secondary cross-check, rate limiting |
| `src/pages/AdminReports.jsx` | Shows the AI's extracted DOB/age/confidence/concerns for whatever still needs a human |
| `firestore.rules` | `verificationRequests` locked to server-only writes (admin SDK bypasses rules) plus admin manual override — client `create` is now `if false` |

## One thing worth deciding later, not done here

Home.jsx's activity list doesn't show any indicator that Match Finder needs
verification — someone taps it from the hub with no warning and lands
straight on the gate screen. That's a small, contained change (one line in
Home.jsx plus a locale string) if you want it; I left it out to keep this
patch to what you asked for.
