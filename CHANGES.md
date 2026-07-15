# Matched-but-invisible conversations, profile view/edit, video call polish, WhatsApp-style chat, mobile topbar overflow

## What changed

**The core bug:** in Match Finder and Skill Swap, "who can chat" was being
derived by scanning the public browse deck (`matchProfiles` / `skillSwaps`)
for a card belonging to your matched partner. If you posted a card and
someone found it, requested, and you accepted — but *that person* never
posted their own card — you had no way to ever see the match or open the
chat, even though they could see yours and could chat freely. This is why
"they can message me but I can't message them" only ever happened to
whoever accepted the request, not whoever sent it.

Fixed by adding a proper "Your matches" / "Your swaps" conversation list to
both pages, built directly from `matchPairs`/`swapPairs` — the pairing
itself — instead of from whichever public cards happen to still exist.
This also means chats stay reachable even if someone later deletes their
public card.

**Notifications:** `IncomingRequestWatcher` only ever watched for requests
waiting on *you*. It never told you when one of *your own* outgoing
requests got accepted, or when someone requested/accepted a skill-swap
video call, or when an event host accepted your join request. All three
now fire a notification.

**Match Finder profile view/edit:** the "Create your card" panel is now a
full profile editor (name, age, gender, avatar colour, an optional photo,
bio, hobbies, looking-for) that updates your existing card in place instead
of creating a new one every time you post. Matched partners can be tapped
(from the matches list, the browse deck, or the chat header) to open a
read-only profile card showing their photo/name/age/gender/bio/hobbies.

**Skill Swap video calls:** already had a real WebRTC implementation
(`SkillSwapCall.jsx`) — it just wasn't very reachable or very visible. An
incoming video invite now gets its own attention-grabbing banner in the
chat (not a small button buried in the topbar), and the call screen has
mute/camera toggle controls and a picture-in-picture layout instead of two
stacked video boxes.

**WhatsApp-style chat rooms:** Match Chat, Skill Swap Chat, and Event Chat
now render as a bounded panel with a wallpaper background, timestamps under
each message, and a pill-shaped input bar pinned to the bottom — instead of
a plain list that just grows the page.

**Mobile topbar overflow:** the "Welcome to Aura" bar (and every other
page's topbar) could overflow or squeeze unreadably on a narrow, locked-
portrait phone, because four pill buttons plus the title were forced onto
one unwrapped row. Below 520px wide, the title now takes its own row and
the action buttons wrap onto a second row, with the language switcher
collapsing to just its globe icon.

## New Firestore rule needed
`userIdentities/{uid}` now allows an optional `photoURL` field (a
client-resized base64 data URL — no Storage bucket involved), capped at
220,000 characters as a server-side backstop. Needs publishing like any
other rules change: Firestore Database → Rules → paste `firestore.rules` →
Publish.

## Natural next step, not built yet
Event Buddy could get the same "Your events" conversation-list treatment
as Match Finder/Skill Swap for consistency, though it wasn't affected by
the core bug (its browse list already shows every posted event regardless
of who's browsing).

---

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
