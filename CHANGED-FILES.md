# Aura — login review: 2 bugs fixed, 1 gap closed

Two files. Extract over `Aura-main/`, on top of everything already applied.
No rules or env changes.

## 1. Legacy accounts' age silently wouldn't prefill (Login.jsx)

The bootstrap check did `if (typeof profile.age === 'number') setAge(...)`.
Any account created before an earlier patch fixed Login writing age as a
string still has it stored that way. For those accounts the type check
failed silently — age never prefilled — and the selfie widget then told
them to "enter your age above," except the verification step has no age
field on it at all. Dead end.

Fixed: checks that the value is present at all, not a specific type, so it
reads both the old string shape and the new number shape.

## 2. Signup form flashed on every visit (Login.jsx)

`showVerificationStep` starts `false`, so the blank signup form rendered
immediately on mount, *then* flipped to the verification step (or
redirected to `/aura`) once the async bootstrap check resolved a moment
later. A returning user — verified or not — saw their own blank signup
form flash for a beat on every single visit.

Fixed with a `bootstrapping` state that gates render behind a
`<PageSkeleton />` until that check has actually finished. A brand-new
visitor with no account resolves this near-instantly.

## 3. No way to fix a typo, anywhere (AccountSettings.jsx)

There was genuinely no way to correct age or gender once submitted at
signup — not on the verification screen (display-only, no editable
fields), not in Account Settings (export/delete/link-Google only, nothing
about the profile itself). A typo, or just turning 18 after signing up as
17, had no recovery path short of deleting the account and starting over.

Added a "Profile info" card, first thing on the page: age input, gender
selector, save button. Writes straight to `users/{uid}` — `firestore.rules`
already allows the owner to change age/gender freely (only
verified/verificationStatus/verifiedSex/verificationExpiresAt are locked),
so no rules change was needed.

Deliberately does **not** touch verification status. Changing age doesn't
revoke it — the age confirmed by a real ID or selfie check is the actual
ground truth; this field is a display/input value, not the source of
truth. Changing gender doesn't revoke it either, but Match Finder's own
save check already requires `gender === verifiedSex`, so a gender change
here naturally blocks re-saving a Match Finder card until they re-verify
with the new value — this screen shows a heads-up about that rather than
silently letting them save into a mismatched state.

Saving here also normalizes a legacy string-typed age into a real number,
so visiting this screen once is a natural way for an old account to
self-heal bug #1 above, independent of ever touching Login again.
