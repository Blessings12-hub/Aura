# What was actually broken vs. already fixed

You asked me to look into whether the previous cleanup (README.md) landed.
Short answer: **most of the substantive bug fixes did land**, but several of
the files that session *wrote* — README.md, .gitignore, .env.example,
LICENSE, and CONTRIBUTING.md — got corrupted. Instead of clean file content,
they contain that session's own raw tool-call transcript (its "let me create
this file" narration, the literal `Action: file_editor create ... --file-text
"..."` command, and the `Observation: Overwrite successful` line), all saved
*as* the file itself. That's also why my very first fetch of your GitHub page
in this conversation looked like garbled/injected content — it wasn't an
injection, I was just looking at this same corrupted README.

## Already fixed (verified against your actual code, nothing to do)
- CollabStudio now saves every point of a stroke, not just the last one
- MoodChat voice notes do a real Firebase Storage upload (not a fake URL)
- DailyQuestion writes to a real date-scoped collection (`dailyQuestions/{date}/answers`)
- Login reuses the session via `onAuthStateChanged` instead of calling
  `signInAnonymously` on every visit (no more orphaned data)
- EventBuddy's dead `dateOption` field is gone
- `theme.css` has proper `[data-theme="dark"]` / `[data-theme="light"]` rules
- The duplicated per-page auth/user-loading code is centralized in
  `useCurrentUser` (used in 11 pages)
- No emoji-as-icons anywhere — all `lucide-react`
- `make_logo.py` is already in `scripts/`
- `firestore.rules` exists and is clean

## Fixed in this batch
1. **README.md, .gitignore, .env.example, LICENSE, CONTRIBUTING.md** —
   rewritten with clean content (README also corrected to match your *actual*
   Firestore collection names, since the original draft had already-stale
   ones like `users/{uid}` for match data instead of the real `userIdentities`).
2. **`firebase-messaging-sw.js` was in the repo root, not `public/`** — a real
   bug, not just cleanup. Vite only copies files from `public/` into the
   build, so the service worker 404'd in production and push notifications
   silently failed. Moved it to `public/firebase-messaging-sw.js`.
3. **Firebase API keys were hardcoded** in `src/firebase.js` (and still are,
   necessarily, in `public/firebase-messaging-sw.js` — see the note in the
   new README on why that one file can't use env vars). `src/firebase.js` now
   reads from `import.meta.env.VITE_FIREBASE_*` and throws a clear startup
   error if `.env` is missing, instead of failing later with a cryptic
   Firebase error.
4. **Dead files removed:** `src/App.css`, `src/index.css` (unused Vite
   template leftovers — confirmed not imported anywhere), `src/components/Canvas.jsx`
   (confirmed not imported anywhere), and `public/manifest.webmanifest` (a
   stale duplicate of `manifest.json` with an empty icon list — `index.html`
   only ever linked to `manifest.json`).

**A zip can't represent deletions or a file move — when you apply this,
manually:**
```bash
rm src/App.css src/index.css src/components/Canvas.jsx public/manifest.webmanifest
rm firebase-messaging-sw.js   # the one at repo root — the fixed copy is in public/
```

## You need to do this before your next `npm run dev` / deploy

Since `firebase.js` no longer has the keys hardcoded, create a local `.env`
(this file is gitignored, so it's fine to keep these values there) with the
values that used to be hardcoded in your repo:

```env
VITE_FIREBASE_API_KEY=AIzaSyD3SJuB_zajVYspjfXWccVHoENx6E-HXhk
VITE_FIREBASE_AUTH_DOMAIN=aura-5693e.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://aura-5693e-default-rtdb.firebaseio.com
VITE_FIREBASE_PROJECT_ID=aura-5693e
VITE_FIREBASE_STORAGE_BUCKET=aura-5693e.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=1028269030459
VITE_FIREBASE_APP_ID=1:1028269030459:web:43762becb2ccccb61c301e
VITE_FIREBASE_MEASUREMENT_ID=G-9PG36HYYR7
```

`VITE_FIREBASE_VAPID_KEY` wasn't in your old hardcoded config — grab that one
from Firebase Console → Project settings → Cloud Messaging → Web
configuration if you want push notifications working locally.

## Still worth doing, not done here (didn't want to touch this without you seeing it first)

- **Inline `style={{...}}` blocks** — still common across pages (I didn't do
  a full pass; this is a large, mostly-cosmetic refactor into `theme.css`
  classes, low risk but high effort/diff size). Happy to tackle one page at a
  time if you want it.
- **`useTranslation`/`t()` coverage** — I didn't audit this thoroughly this
  round; some strings may still be hardcoded English outside `en/translation.json`.
