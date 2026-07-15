# Trust & safety: report/block from card listings

## What I found first
Your existing report/block system is genuinely solid — better than most
apps this size ship with:
- Blocking already filters that person's cards/messages everywhere at
  once (Mood Chat, Match Finder, Skill Swap, Event Buddy, Collab Studio,
  Daily Question) — confirmed, not just claimed in a comment
- Reports are write-only for the reporter (can't be read back, so a
  reported person can never learn who reported them) and only readable by
  an actual admin, gated by an `/admins/{uid}` doc that only you can
  create directly in Firebase Console — no self-service way to grant
  yourself admin from within the app, which is the right call
- `AdminReports.jsx` gives you a real review screen: mark reviewed,
  delete, see reason/context/who-reported-whom

## The one real gap
`ReportBlockMenu` only existed inside 1:1/group **chats** — Match Finder,
Skill Swap, and Event Buddy's card-browsing screens had no way to report
or block someone directly from their card. For Match Finder specifically,
this mattered most: reporting someone required a *mutual match* first,
which an offending user might simply never grant, making them
unreportable in practice.

## Fix
Added the same `ReportBlockMenu` (compact mode) directly to each card in
all three listing pages — Match Finder, Skill Swap, Event Buddy. No rules
changes needed, since `context`/`contextId` are just free-text fields your
existing `reports` rule already accepts. Blocking from a card removes it
from the list immediately, same as it already did from chats.

## Still open from the original list (not started)
- The "resets every 24 hours" promise still isn't real — data still just
  accumulates
- No content filtering (profanity/spam) exists anywhere yet
- Age is still self-reported at signup with no real verification
