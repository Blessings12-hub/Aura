# Making "resets every 24 hours" actually true

## What was wrong
None of the browse/feed queries filtered by age at all — every mood
message, match card, skill swap offer, and canvas stroke ever posted
stayed visible forever. The README's core promise wasn't real.

## What changed
New `src/lib/rollingWindow.js` — a `last24HoursTimestamp()` helper used as
a `where('createdAt', '>=', ...)` clause. Applied to:
- **Mood Chat** — messages older than 24h no longer show
- **Match Finder** — the public browse feed (`matchProfiles`) ages out
  after 24h
- **Skill Swap** — same, for `skillSwaps` offers
- **Collab Studio** — both the canvas strokes and the chat next to it

**Event Buddy got different logic on purpose**, not the same 24h-since-posted
rule: an event 5 days out is still very joinable the day after it's
posted, so hiding it after 24h would actively hurt the feature. Instead it
now hides once the event's own date has passed — posted-today-for-next-Saturday
stays visible all week, right up until Saturday.

## What did NOT change (intentionally)
Active matches, pending requests, and existing chats (`matchPairs`,
`swapPairs`, `matchChats`, `swapChats`, `eventJoins`, `eventChats`) are
untouched — confirmed the "requests for you" / "pending" sections render
from that data directly, not from the aged-out browse list, so an active
conversation won't vanish just because the original card is now old.
Daily Question was already correctly scoped by day and needed no change.

## The honest limitation
This only **hides** old documents from these queries — it doesn't delete
them. Actually deleting on a schedule needs something server-side (Cloud
Function + Scheduler), which usually needs Blaze billing regardless of
usage, so it's not something achievable purely client-side right now.
At friends-testing scale this is a non-issue. If Aura grows, old documents
will keep quietly accumulating in Firestore's free 1 GiB storage quota
even though nobody sees them again — worth a real cleanup job eventually,
not urgent now.

## One thing to verify after deploying
Firestore needs an index for `where + orderBy` on the same field
(`createdAt`), but same-field range+order queries use Firestore's default
automatic index — no manual index setup should be needed. If you see a
"query requires an index" error with a Firebase Console link in it after
deploying, click that link (it auto-creates exactly what's missing) and
let me know if it happens, since that would mean I got this wrong.
