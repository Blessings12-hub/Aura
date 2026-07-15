# Mood picker activity badges (the empty-room fix)

## What changed
Mood Chat's picker screen now shows "X messages today" under each mood,
pulled from a lightweight daily counter (`moodActivity/{day}`, one field
per mood). It updates in real time as people post.

This is a deliberately different approach from "fix the empty room after
you're in it" — the goal is steering people toward rooms that already have
life in them *before* they commit to one, so fewer people ever land in a
silent room and bounce. A mood with "12 messages today" next to it is a much
stronger invitation than a bare, unlabeled button, even if nobody's online
in that mood right this second.

## New Firestore rule needed
`moodActivity/{day}` — deliberately simple and permissive (any signed-in
user can read/write). It's not user data and not sensitive: worst case
someone inflates a vanity counter, which isn't a real security concern.
Needs publishing like the others: Firestore Database → Rules → paste →
Publish.

## Cost note
This adds one extra write per message sent (the increment), and one extra
document read per Mood Chat visit (the picker subscription). At friends-group
scale this is nowhere near Firestore's free daily quota (50K reads / 20K
writes) — not something to worry about yet, just flagging since it's a real
(if tiny) addition to your Firestore usage.

## Natural next step, not built yet
Same idea could extend to Skill Swap and Event Buddy's listing pages
("X offers posted today" / "X events this week") — didn't want to build
three more collections and rules blindly without confirming this pattern
actually helps first. Say the word if you want it extended.
