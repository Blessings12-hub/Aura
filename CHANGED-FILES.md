# Aura — Mood Chat & Daily Question: minors and adults never share a room

3 files. Redeploy the app and `firestore.rules` together — the client
routing and the rules enforcement depend on each other; deploying one
without the other either does nothing (rules alone, nobody's routed
differently) or breaks the room entirely (client alone, before rules
allow the new room keys — though in this specific case the existing
wildcard `{mood}`/`{day}` rule pattern already matches any string, so
client-only deployment wouldn't break anything, it just wouldn't be
enforced server-side yet. Ship both together anyway — no reason not to.)

## How it works

Every room — a mood, or a day's question — already lives at a Firestore
path keyed by that mood or date (`chats/happy/messages`,
`dailyQuestions/2026-09-25/answers`). A minor's account (age 16-17) now
gets routed to a parallel path with `-teen` appended
(`chats/happy-teen/messages`) — a completely separate collection, not a
filtered view of the same one. Adults see no change at all: same paths
as before, same rooms, same everyone who was already there.

This is invisible by design right now — no "you're in the under-18 room"
label anywhere. That was a scope call, not an oversight: you asked for
separation, not necessarily disclosure of it, and a label risks feeling
like a callout. Easy to add if you want one later.

## Why this is enforced in `firestore.rules`, not just the app's routing

The app choosing the right room for someone is a UX nicety, not a safety
boundary on its own — anyone can skip your actual web app and call the
Firestore SDK directly with whatever room key they want. The scenario
this specifically has to stop is an adult doing exactly that: querying or
writing straight into a `-teen` room to reach minors, bypassing the app
entirely. So the real enforcement is `inOwnAgeTierRoom()` in
`firestore.rules` — it reads the room key someone's trying to access,
reads their own account's age from Firestore (not anything the client
claims about itself in the request, which could be spoofed), and denies
the request outright if those two don't match. This applies to reading a
room, not just writing to one — an adult silently reading a minors-only
room without ever sending a message is still a real problem, so both are
checked identically.

## What this does not cover

**Scoped to exactly what you asked for: Mood Chat and Daily Question.**
Skill Swap, Event Buddy, and Letters weren't touched, and I don't think
they should be assumed to need the identical fix without a separate look
— those work through a matching step before any conversation starts,
which is a different exposure pattern (a minor could still end up
one-on-one with a stranger through matching, not just in an open room)
and deserves its own explicit decision rather than being silently bundled
in here.

**The public daily activity counts stay combined** (e.g. "42 messages
today in Happy" mixes both rooms) — that's just an aggregate number with
no message content or identity in it, so splitting it felt like scope
creep for something this touches only cosmetically. Report context now
correctly shows which room a report came from (`happy-teen` vs `happy`),
which matters more for actually reviewing something.

## Files

| File | |
|---|---|
| `firestore.rules` | New `isTeenRoom()` / `accountIsTeen()` / `inOwnAgeTierRoom()`, applied to both `chats` and `dailyQuestions` read/create/update |
| `src/pages/MoodChat.jsx` | Computes and routes through the age-tier room key |
| `src/pages/DailyQuestion.jsx` | Same, for the daily question |
