# What was actually wrong, and what's fixed

## 1. "Buttons don't work" — real bug, fixed
`requestMatch` (Match Finder), `requestSwap` (Skill Swap), and
`joinEvent`/`acceptJoin` (Event Buddy) had **zero error handling and zero
loading feedback**. If the Firestore write failed for any reason, or was
just slow, the button appeared to do nothing — no spinner, no error, no
disabled state. That's not a rules or deployment problem, it's a missing
piece of UI code. Fixed in all three: buttons now show a loading state,
disable themselves mid-request (no more double-tap spam), and show a real
error message if something actually fails.

## 2. "Online is fake" — root cause found
Realtime Database (which powers presence) has its **own separate security
rules**, completely independent from Firestore's. You published Firestore's
rules a while back — Realtime Database's rules (`database.rules.json`) have
likely never been published, so every presence read/write has been silently
denied this whole time. The presence *code* itself (`usePresence.js`,
`useRoomPresence.js`) is correct — genuine server-enforced online/offline
detection, not a fake client-side guess — it just never had permission to
run.

### To fix, publish `database.rules.json`:
1. Firebase Console → **Realtime Database** (separate section from
   Firestore Database, usually just below it in the sidebar)
2. If you've never opened this before, you may need to click **Create
   Database** first — choose a location, start in **locked mode**
3. Tab along the top → **Rules**
4. Replace the contents with the attached `database.rules.json`
5. **Publish**

I also added error logging to both presence hooks (console.error, with a
note pointing at "check Realtime Database rules"), so if this ever breaks
again it'll say so instead of silently doing nothing.

## 3. Cleanup — regressions from the last upload
A few things I'd already fixed had reverted in this upload — worth knowing
in case this keeps happening from however you're syncing your local copy
to GitHub:
- `src/firebase.js` was back to hardcoded API keys instead of reading
  `.env` — reverted again to env vars.
- `src/App.css`, `src/index.css`, `src/components/Canvas.jsx`,
  `public/manifest.webmanifest` had all reappeared (dead Vite-template
  files) — removed again.
- A `backend/` folder appeared containing a Python FastAPI + MongoDB
  server unrelated to Aura's actual Firebase architecture (looks like
  scaffold from whatever tool originally generated the repo). Removed —
  Aura doesn't use a custom backend, everything runs through Firebase
  directly from the client, by design.

If you're not sure why files keep reverting: check whether you have more
than one local copy of the repo, or are ever pulling instead of always
pushing your latest edits — a stale local folder getting pushed on top of
newer GitHub changes would explain exactly this pattern.
