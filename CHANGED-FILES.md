# Aura — fix for "Could not sign you in. Please try again."

Four files. Paths are relative to the project root and the structure in this
zip already matches, so you can extract it straight over `Aura-main/`.

**`firestore.rules` is in here too — you need to redeploy it**, e.g.
`firebase deploy --only firestore:rules`. The client changes alone will not
fix the ID-upload path without it.

## Are the rules correct?

Mostly yes. The structure is sound — default-deny at the bottom, owner checks
everywhere, admin gated behind a console-only `/admins/{uid}` doc, list
queries written against the same fields the client filters on. I found three
problems, only one of which is a real hole in the rules themselves; the other
two were the client sending payloads the rules were right to reject.

### 1. `age` type mismatch — rules were right, client was wrong

`validAge()` required `data.age is int`. Login wrote `String(Number(age))`.
Every sign-up was rejected.

`MatchFinder.jsx:340` already writes `age: numericAge` (a number) to the same
document, so a number is the correct shape and Login was the odd one out. I
changed Login to write a number.

I also widened `validAge()` to accept a numeric string as well. That is
deliberate, not laziness: an update sends the **full resulting document** to
the rules, so once the client switched to numbers, any existing account still
holding a string age would have started failing this check on every later
write — including the streak counters that run on app open. Accepting both
shapes fixes new sign-ups without stranding accounts already in your database.
The 16+ minimum is still enforced on both branches.

### 2. Login sent admin-only fields — rules were right, client was wrong

The payload included `verificationStatus: 'pending'` and `verified: false`,
but the `users/{uid}` create rule explicitly requires both to be **absent**;
they are admin-written only, by `AdminReports.reviewVerification`. Removed
from the Login payload.

Worth knowing for the future: `setDoc(..., { merge: true })` on a document
that does not exist yet is still evaluated as a **create** by security rules.
The merge flag does not get you onto the update branch.

Nothing is lost by dropping `'pending'` here — the `verificationRequests/{uid}`
document written on the very next line already carries `status: 'pending'`,
which is where both the admin review queue and the pending banner read it.
I repointed Login's pending banner at that document, since
`users/{uid}.verificationStatus` could never have been `'pending'`.

### 3. The OCR write-back was genuinely missing from the rules

This one is a real gap. `submitIdentityDocument()` writes `ocrStatus`,
`ocrDateOfBirth` and `ocrConfidence` back to `verificationRequests/{uid}`, but
the owner's update rule had:

```
.hasOnly(['uid', 'age', 'gender', 'status', 'submittedAt', 'reviewedAt', 'reviewerId'])
```

None of the three `ocr*` keys were in that list, so **every ID upload died
with permission-denied** — and since it runs inside Login's single try/catch,
it showed up as the same generic sign-in banner instead of a verification
error. I added the three keys. They're safe for the owner to set: they are the
OCR *result*, and `status` is still pinned to `'pending'` on that branch, so a
client still cannot approve itself. Only the `isAdmin()` branch can move status
to approved or declined.

The client write also now sends `uid` and `status` alongside, so it works
whether the request document already exists or not.

### 4. A smaller one, defensive

`validMatchAge()` defaulted `verificationExpiresAt` to the integer `0` and
compared it with `request.time`, a timestamp. That is a type error rather than
a clean `false`. AdminReports writes the field as a `Timestamp`, so I changed
the default to `request.time`, which denies cleanly when the field is missing.
Same outcome, easier to read in the rules playground.

## Also fixed in the client

- **Login's "already verified, skip to Match Finder" redirect never fired.**
  It read `firebaseAuth.currentUser` directly, which is normally `null` on a
  cold load, and bailed out. It now awaits the session.
- **The same check compared a Firestore `Timestamp` using `Number(...)`,**
  which gives `NaN`, and `NaN > Date.now()` is always false — so even an
  approved account failed it. Now uses `toMillis()`.
- **The error banner now includes the Firebase error code.** The generic
  message hid which step failed, which is painful to debug from a phone.
- **`submitIdentityDocument` no longer throws just because auth hasn't
  finished restoring,** and reports what `/api/verify-document` actually said
  instead of one flat message.

## Two things I could not verify from the code

- Whether Anonymous sign-in is enabled in your Firebase console
  (Authentication → Sign-in method), and whether your deployed domain is in
  the authorised domains list. If either is off, `ensureFirebaseSession()`
  throws before Firestore is touched. With the new error code in the banner
  you'd see something like `auth/operation-not-allowed` or
  `auth/unauthorized-domain`, which tells you immediately.
- Whether `OCR_SPACE_API_KEY` is set in your Vercel environment. Without it
  `/api/verify-document` returns 500, which now surfaces as "OCR verification
  is not configured yet" rather than a sign-in failure.

Apply this on top of the earlier auth-race patch, not instead of it — they fix
different things.
