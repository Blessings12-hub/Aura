# Aura — fix for the AbortError storm and "Missing or insufficient permissions"

Drop these 7 files into your repo, replacing the existing ones. Paths are
relative to the project root, and the folder structure in this zip already
matches, so you can extract it straight over `Aura-main/`.

## What was actually wrong

Both errors came from the same root cause: **nothing waited for Firebase
Auth**, so several parts of the app each tried to start their own anonymous
session at the same moment.

`src/context/AuthGate.jsx` contained `const [ready] = useState(true)` — a
leftover from the Appwrite migration. It rendered its children instantly and
never gated on anything. Meanwhile `ensureFirebaseSession()` checked
`auth.currentUser`, saw `null` (normal for the first few hundred milliseconds
while Firebase restores the saved session from IndexedDB), and called
`signInAnonymously()`. PresenceRoot, useCurrentUser, useOnlineCount, Login and
React StrictMode's double-mount all did this at once.

- **AbortError: The user aborted a request.** Each new sign-in cancels the
  in-flight auth/token requests from the previous one. Several racing callers
  produce a burst of aborted requests — one logged per cancelled call. The
  duplicate `getDoc` + `onSnapshot` on the same doc in `useCurrentUser` added
  more.
- **FirebaseError: Missing or insufficient permissions.** `firestore.rules`
  requires `request.auth != null` on essentially every collection. Reads that
  went out before auth landed (or signed with a uid the race had just thrown
  away) were rejected. `useOnlineCount` was the most visible one — it queried
  `presence` the instant Home mounted and retried every 30 seconds.

Your `firestore.rules` file is fine. It did not need changing.

## The files

| File | Change |
|---|---|
| `src/lib/firebaseClient.js` | `ensureFirebaseSession()` now waits for Firebase's own session restore first, only signs in anonymously if nobody is there, and caches the promise so every caller shares one sign-in. Also sets `browserLocalPersistence` so the anonymous uid survives a reload. |
| `src/context/AuthGate.jsx` | Actually gates now — shows the splash until the session resolves, then publishes the uid through React context. |
| `src/hooks/useAuthUid.js` | Reads the shared uid from that context instead of starting its own sign-in. |
| `src/hooks/useCurrentUser.js` | Takes the uid from context; one `onSnapshot` instead of `getDoc` + `onSnapshot`. Return shape unchanged, so no page needs editing. |
| `src/hooks/useOnlineCount.js` | Waits for a ready session before querying `presence`. Signature unchanged, so `Home.jsx` needs no edit. |
| `src/hooks/usePresence.js` | Fixes the unmount path, which previously never wrote "offline" (it bailed on its own `active` flag). Quieter about cancelled writes. |
| `src/lib/quietErrors.js` | **New file.** Narrow helper that recognises abort/cancellation only — permission-denied and other real errors still log loudly. |
| `src/main.jsx` | Suppresses unhandled-rejection noise from genuinely-aborted requests. Nothing else is filtered. |

No other file needs to change. No dependency changes. No rules redeploy.

## After you deploy

Expect the AbortError lines to stop entirely and the permission errors to
disappear on cold load. If a permission error survives this, it is a real rule
mismatch rather than a timing problem — note which collection it names and
that will point straight at the block in `firestore.rules`.

One thing I could not verify from the code alone: whether Anonymous sign-in is
actually enabled in your Firebase console (Authentication → Sign-in method).
If it is off, `signInAnonymously()` fails and you would now see the "could not
start a session" screen from AuthGate rather than a silent failure. Worth
confirming before assuming the patch is at fault.
