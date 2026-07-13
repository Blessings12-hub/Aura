# Reliability pass — phase 1 of "make it professional"

Same fix as the last batch (Match Finder / Skill Swap / Event Buddy),
extended to every remaining write in the app. Audited every `addDoc` /
`setDoc` / `updateDoc` / `deleteDoc` call across all 12 pages — these were
the ones with no error handling, now fixed:

- **Daily Question** — submitting an answer
- **Event Chat, Match Chat, Skill Swap Chat** — sending a message
- **Skill Swap Chat** — accepting/declining a video call request
- **Collab Studio** — sending a chat message, saving a stroke, clearing
  the canvas, undoing your last stroke
- **Mood Chat** — sending a text message (voice notes already had this)

The Collab Studio stroke-save one is worth calling out specifically: before
this fix, if that write failed, your drawing would just visually vanish the
moment you lifted your finger, with no explanation at all — about as
"broken demo" as a bug gets. Now it says so.

All of these reuse an error state/banner that already existed on each page
(`chatError` or `loadError`), so no new UI pattern was introduced — just
consistently wired up everywhere it was missing.

## What's next (phases 2 and 3, not started)
You said priority order is reliability → visual polish → missing basics
(Terms/Privacy, onboarding, age verification). This batch is reliability.
Let me know when you want to move to phase 2 (visual polish) or phase 3
(the legal/onboarding basics) and I'll scope those the same way — audit
first, then fix, rather than guessing at what "professional" means.
