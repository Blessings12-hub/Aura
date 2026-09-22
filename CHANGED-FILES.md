# Aura — manual review + AI fallback + admin/user notifications

14 files. This is a genuine architecture change to how verification works,
not an incremental patch — read the setup steps below before deploying,
there are four things that need doing outside the code itself.

## The new flow, end to end

1. Someone captures a selfie and uploads an ID photo together (no more
   either/or, no more instant approval — see the "what got removed"
   section below).
2. `api/verify-submission.js` stores both images (temporarily — see
   "image storage" below), creates the pending request, and pushes a
   notification to every admin.
3. You review it by hand in Admin Reports — the images are right there
   now, loaded on demand per request.
4. If you approve or decline, that's final: the decision is written, the
   images are deleted immediately, and the applicant gets notified.
5. If you don't act within an hour, `api/escalate-verifications.js` —
   triggered hourly by a GitHub Actions workflow, not a Vercel Cron Job,
   see why below — runs Groq's vision model on both images together
   (extracting the ID's date of birth AND judging whether the selfie
   plausibly matches the ID photo), and decides the same way: only a
   confident, clean read on all counts approves or declines anything.
   Anything murkier just waits for the next hourly pass, or for you.

## Setup you need to do — nothing here works until you do these

1. **`CRON_SECRET`** — generate a random secret, add it to Vercel's
   environment variables, and add the identical value as a GitHub repo
   secret (Settings → Secrets and variables → Actions → New repository
   secret), also named `CRON_SECRET`. This is how the hourly job proves
   it's really your scheduled workflow and not a stranger hitting the
   endpoint — there's no signed-in user to check a token against here.

2. **Firestore composite index** — `escalate-verifications.js` queries
   `verificationRequests` filtering on `status` AND `submittedAt`
   together, which Firestore requires a composite index for. I've added
   `firestore.indexes.json` and referenced it from `firebase.json`; run
   `firebase deploy --only firestore:indexes` (or the plain
   `firebase deploy --only firestore` you've used for rules before, which
   picks up both). If you skip this, the endpoint will fail with a clear
   error containing a direct link to auto-create the index — annoying but
   not silent.

3. **Your own admin push token** — for admin notifications to actually
   reach you, you (as an admin) need to have opened Aura and had push
   notifications register at least once, same as any user. If you've never
   enabled notifications on your own admin account, you won't get pinged —
   the pending queue is still there to check manually either way.

4. **Deploy `firestore.rules`** as usual — this patch adds a new
   `verificationImages` collection to it.

## What got removed, and why it had to be all-or-nothing

The old instant "quick check" (a confident selfie alone, approved in
seconds, no human involved) is gone — you asked for every submission to
require both a photo and a document. `api/verify-document.js` and
`api/verify-selfie.js` are the old single-image endpoints this replaces.

I didn't just stop calling them from the client — I stubbed them to
return `410 Gone`. Leaving them live and simply unused would have been a
real hole: anyone who'd ever inspected the network tab could still POST
straight to the old endpoints and get the old, weaker instant-approval
behavior, completely bypassing the new "always reviewed" policy. You can
delete both files whenever convenient; the stub is a safety net for
between now and whenever that happens, not a replacement for actually
deleting them.

## Image storage — the tradeoff you explicitly chose

Every piece of verification built before this deliberately stored no
images anywhere. That's reversed here, on your call: `verificationImages/
{uid}` holds both photos, base64-encoded, in Firestore — NOT Firebase
Storage, which would need the paid Blaze plan this project has avoided
everywhere else. Firestore itself is already free at this scale.

The real constraint that comes with that choice: a Firestore document
caps out at 1 MiB. Both images are compressed client-side to stay well
under a combined budget (`MAX_COMBINED_BYTES = 700_000` bytes as a
server-side backstop, on top of tighter client-side compression than the
old document-only flow used), and the server rejects an oversized pair
with a clear "please retake" message rather than letting a raw write fail.

Deletion is aggressive on purpose: the moment a decision exists — yours
or the AI's — the images are deleted in that same operation. A 48-hour
sweep in the escalation job is a backstop for anything that somehow stays
undecided that long (a Groq outage spanning many hours, say), not the
normal path.

Worth being direct about: this is a materially bigger privacy/legal
surface than anything else in Aura, even temporarily. I can't tell you
whether 48 hours is the right retention window for wherever your users
are — that's worth a real check against Zambia's Data Protection Act and
anywhere else your users are, not something I can rule on.

## What quietly also changed

- **OCR.space is no longer used anywhere.** The old flow ran it alongside
  Groq as a second, independent read of the printed date. The new
  escalation flow relies on Groq alone, now doing a richer job (reasoning
  about both images together, judging a face match) than either signal did
  alone before. `OCR_SPACE_API_KEY` is now unused — harmless to leave set,
  fine to remove whenever.
- **If `GROQ_API_KEY` isn't set**, the escalation job's AI step simply
  never resolves anything — every request wait­s for manual review
  indefinitely, with no automatic fallback. Not a crash, just a silent
  full-manual mode. Worth knowing if requests seem to pile up.
- Both compression budgets got tighter (ID photo: 1400px/0.85 quality →
  1100px/0.8; selfie: unchanged resolution, 0.85 → 0.8 quality) — needed
  headroom for two images to fit in one Firestore document where before
  there was only ever one.

## Files

| File | What it does |
|---|---|
| `api/verify-submission.js` | New — intake: validates, stores both images, creates the pending record, notifies admins. Decides nothing itself. |
| `api/escalate-verifications.js` | New — the hourly job: AI-decides anything a human hasn't in an hour, deletes images on any decision, 48h backstop sweep, notifies the applicant. |
| `api/verify-document.js` | Retired — stubbed to 410, was the old document-only instant-ish path |
| `api/verify-selfie.js` | Retired — stubbed to 410, was the old instant selfie-only fast path |
| `.github/workflows/verification-escalation.yml` | New — hourly trigger for the escalation endpoint, working around Vercel Hobby's once-a-day Cron Job limit |
| `firestore.indexes.json` | New — the composite index the escalation query needs |
| `firebase.json` | References the new indexes file |
| `firestore.rules` | New `verificationImages` collection — admin-read-only, no client write access at all, server (Admin SDK) only |
| `src/lib/verificationService.js` | `submitIdentityDocument`/`submitSelfieCheck` replaced with one `submitVerification` taking both images |
| `src/components/SelfieVerification.jsx` | Reworked from a self-contained submit-and-decide widget into pure camera capture — hands the frame back via `onCapture`, decides nothing |
| `src/pages/MatchFinder.jsx` | Gate now requires both a captured selfie and an ID file before the submit button enables |
| `src/pages/Login.jsx` | Same unified requirement in the verification step |
| `src/pages/AdminReports.jsx` | Pending queue now shows time-since-submission and an on-demand "View photos" button per request; approving/declining now deletes the images and notifies the applicant |
| `src/pages/AccountSettings.jsx` | Carried forward unchanged from the last patch (age/gender edit card) — included so this zip is complete on its own |
