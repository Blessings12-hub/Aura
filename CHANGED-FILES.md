# Aura — four fixes: gender-sync bug, language switcher, safe area, settings cleanup

7 files. Redeploy both the app and `firestore.rules`.

---

## 1. "Couldn't save your profile" (permission-denied)

Found it. `validMatchAge()` in `firestore.rules` requires the gender on
a Match Finder card to exactly equal `verifiedSex` on the account. Every
approval path (`AdminReports.jsx`, `api/admin-panel.js`,
`api/escalate-verifications.js`) was writing `verifiedSex` but never
syncing the account's base `gender` field to match. Match Finder's
profile editor prefills its gender picker from that base field, not from
`verifiedSex` — so anyone verified with a different gender than whatever
was already on their account (picked something different at the
verification screen, or edited it afterward in the Account Settings
editor from a few patches back) would pass verification cleanly, then
hit permission-denied on every single save attempt, with an error
message that gives no hint the real cause is a gender field mismatch.

Fixed in all three approval paths: `gender` and `age` now get written
alongside `verifiedSex` on approval, so the account's base fields always
match whatever was actually verified. `firestore.rules` also needed
`gender`/`age` added to the admin's allowed-field list — the two
server-side paths use the Admin SDK and aren't affected by rules at all,
but `AdminReports.jsx` writes from the client and would have hit the
exact same permission-denied error on this new field otherwise.

**This only prevents the mismatch going forward — it doesn't retroactively
fix an account already stuck on it**, including whichever one is in your
screenshot. Simplest fix for that: submit verification again now that
this is deployed — the new approval will correctly sync it. If you'd
rather not resubmit, you can manually set that account's `gender` field
in Firebase Console to match its `verifiedSex` value directly.

## 2. Language switcher cut off at the screen edge

The dropdown was `position: absolute; right: 0`, anchored purely in CSS
relative to its own trigger button. That's fine when the trigger sits
deep inside a wide, padded card (like on Login) — but the same component
renders `compact` inside every page's TopBar icon row too, where the
trigger sits much closer to the actual screen edge. `body` already has
`overflow-x: hidden` set globally (to stop unwanted horizontal scroll
elsewhere) — so on a narrow phone, whatever part of that 180px-wide
dropdown computed past the edge of the viewport wasn't just spilling
over visually, it was being clipped and made invisible. That's "half
hides in the phone's sides."

Fixed by computing the dropdown's position in JavaScript from the
trigger's actual on-screen location, then clamping both edges to stay
within the viewport (minus a small margin) — works the same everywhere
it's used now, regardless of how close to the edge the trigger sits.

## 3. Content overlapping the phone's status bar

`index.html` already had `viewport-fit=cover` set (needed for
`env(safe-area-inset-*)` to be non-zero at all), and `.aura-page`'s
bottom padding already accounted for `env(safe-area-inset-bottom)` — but
its TOP padding was a flat `20px` with no safe-area consideration.
`.aura-topbar` is `position: sticky`, which sticks relative to that
padding, not the raw viewport — so on any notch/Dynamic-Island/status-bar
device, both page content and the sticky header started rendering right
under, or behind, the system status bar.

Two places needed the fix, not one: `.aura-page` itself, and separately
`.aura-login-page` — Login uses both classes together
(`className="aura-page aura-login-page"`), and since `.aura-login-page`
is defined later in the stylesheet, its own flat `padding: 24px` was
winning the cascade and silently overriding `.aura-page`'s fix entirely
on the one screen that renders before anyone's even signed in.

## 4. Account ID card removed from Settings

Gone, per request. If you need your account ID again later (for the
Firebase Console admin setup, or anything else), "Export my data" in
Account Settings still downloads a file named
`aura-account-data-<your-id>.json` — the ID is right there in the
filename, or you already have it saved from when you set up admin access
the first time.

---

## Files

| File | |
|---|---|
| `api/escalate-verifications.js` | Syncs gender/age on AI approval |
| `api/admin-panel.js` | Syncs gender/age on standalone-panel approval |
| `src/pages/AdminReports.jsx` | Syncs gender/age on in-app manual approval |
| `firestore.rules` | Admin allowlist now includes gender/age |
| `src/components/LanguageSwitcher.jsx` | Viewport-clamped fixed positioning |
| `src/styles/theme.css` | Safe-area-aware top padding, both `.aura-page` and `.aura-login-page` |
| `src/pages/AccountSettings.jsx` | Account ID card removed |
