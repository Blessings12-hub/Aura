# Root cause found: matchPairs / swapPairs read rule

Confirmed by process of elimination:
- Match Finder error was specifically "Matches could not be loaded" (the
  `matchPairs` query) — NOT "Profiles could not be loaded" (`matchProfiles`,
  which works fine).
- Skill Swap error was specifically "Swap requests could not be loaded"
  (`swapPairs`) — NOT "Skill swaps could not be loaded" (`skillSwaps`,
  which works fine).

Both failing collections used a security rule that checks the **document
ID** (`isParticipantOfPairId`, which parses "uidA_uidB" out of the ID). But
the app queries both collections with `where('userA','==',uid)` and
`where('userB','==',uid)` — filtering on a **data field**. Firestore
requires the rule condition and the query filter to be checkable against
the same thing for a list query; an ID-based rule paired with a
field-based query gets denied outright, even though every real document
your app creates does satisfy both. It's not a bug in your data, your
deployment, or your auth — it's a mismatch between how the rule and the
query were each written.

## Fix
`matchPairs` and `swapPairs` now check `resource.data.userA` /
`resource.data.userB` for `read`, matching exactly what the app's `where()`
queries filter on. `create` and `update` still use the ID-based check (fine
there — those are single-document writes, not list queries, so there's no
mismatch).

## Deploy
Same as before — no code changes this time, only rules:
1. Firebase Console → Firestore Database → Rules
2. Replace with the attached `firestore.rules`
3. Publish

This should be the last piece — Collab Studio's chat/canvas/cursors all
use the same plain `signedIn()` pattern as Mood Chat (which already
works), so they weren't affected by this particular bug.
