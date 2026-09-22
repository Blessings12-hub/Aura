# Aura — safety hardening + cron secret + admin setup

Answering your three follow-ups. Files below are the FULL updated set —
this supersedes the previous zip entirely, apply this one on its own
rather than layering it on top.

---

## 1. "Make it safe" — what actually changed

**Retention cut from 48h to 24h.** The backstop sweep (for anything that
somehow stays undecided across many hourly runs) now deletes images after
24 hours instead of 48. Normal operation never reaches this anyway — a
request is either decided within an hour or two (images deleted
immediately either way) or retried every hour until it is.

**Explicit informed consent, before anything is even captured.** Both
Login and Match Finder now show a checkbox — "I understand my selfie and
ID photo will be stored temporarily so they can be reviewed, and deleted
as soon as my request is decided" — and the camera/file picker don't even
appear until it's checked. This isn't just a submit-time disclaimer; the
consent gate sits before any capture happens at all.

**An access log — who looked at whose photos, and when.** New
`verificationImageAccessLog` collection: every time an admin clicks "View
photos" in Admin Reports, it's recorded (`adminId`, `subjectUid`,
`viewedAt`) — before the photos even finish loading, so the access
attempt itself is what's logged. Write-only from the app's side; nobody
reads it through the client, it's there for you to check directly in the
Firebase Console if you ever need to. Each admin can only write a record
of their own access and can never edit or delete an entry afterward, so
it can't be tampered with after the fact.

**Worth saying plainly: I can hurt harden the engineering, I can't rule on
the legal question.** These changes reduce the exposure window and add
accountability, which is what's actually in my control. Whether 24 hours,
this consent language, and this access log actually satisfy Zambia's Data
Protection Act (or wherever else your users are) is a real legal
question — genuinely worth a real check, not something I can certify from
here.

---

## 2. Where to get the cron secret

I generated one — cryptographically random, nothing to design yourself:

```
ab52f37977dd9420cef8c4fb8b52d032038a8580be2c21eee4e84b133ba92101
```

Put this **exact same value** in two places:

1. **Vercel**: your project → Settings → Environment Variables → Add New
   → Name: `CRON_SECRET`, Value: the string above → Save → redeploy.
2. **GitHub**: your repo → Settings → Secrets and variables → Actions →
   New repository secret → Name: `CRON_SECRET`, Value: the same string →
   Add secret.

Both steps are plain web pages, no terminal needed. If you ever want a
fresh one later, any password generator's "64 random hex characters"
option works the same way — this isn't a one-time-use value tied to
anything else, it just needs to match in both places.

---

## 3. Setting yourself up as an admin

1. Open **Account Settings** in Aura (this patch adds a new "Your account
   ID" card at the top of that screen) and copy your account ID.
2. Go to **console.firebase.google.com** on your phone or computer →
   select the Aura project → **Firestore Database** → **Data** tab.
3. If there's no `admins` collection yet, click **Start collection**,
   name it exactly `admins`.
4. For the **Document ID**, paste your copied account ID — don't use
   "Auto-ID", it has to be exactly your ID.
5. Add any one field to the document — the content doesn't matter, only
   that the document exists (`firestore.rules`' `isAdmin()` just checks
   `exists(...)`). A field like `role` (string) = `owner` is fine.
6. Save. Reload Aura, go to `/aura/admin/reports` — you should now see
   the review queue.

**One real risk worth knowing before you rely on this:** Aura signs
people in anonymously — there's no email or password behind your account
ID, it's tied to this specific browser/device. If you ever clear this
browser's storage, or open Aura fresh on a different device, that account
(and the admin access tied to it) is gone with no recovery path — unless
you'd linked a Google account first. Account Settings already has a "link
Google account" option from earlier in this build; worth doing that
*before* you're depending on admin access, not after you've lost it.

---

## Files (complete set, all 15)

| File | |
|---|---|
| `api/verify-submission.js` | Intake — stores both images, notifies admins |
| `api/escalate-verifications.js` | Hourly AI fallback + 24h backstop sweep (was 48h) |
| `api/verify-document.js` | Retired, stubbed to 410 |
| `api/verify-selfie.js` | Retired, stubbed to 410 |
| `.github/workflows/verification-escalation.yml` | Hourly trigger |
| `firestore.indexes.json` | Composite index the escalation query needs |
| `firebase.json` | References the indexes file |
| `firestore.rules` | `verificationImages` + new `verificationImageAccessLog` |
| `src/lib/verificationService.js` | Unified `submitVerification` |
| `src/components/SelfieVerification.jsx` | Capture-only, no independent decide |
| `src/pages/MatchFinder.jsx` | Consent gate + unified selfie+ID submission |
| `src/pages/Login.jsx` | Same, in the verification step |
| `src/pages/AdminReports.jsx` | Photo review + access logging + notify-on-decision |
| `src/pages/AccountSettings.jsx` | New "Your account ID" card + prior age/gender editor |
