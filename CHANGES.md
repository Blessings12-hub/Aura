# Stickers: custom shapes + live (looping video/GIF) stickers, for Mood Chat and Daily Question

## What's new
The sticker picker (shared by Mood Chat, Daily Question, and Match Chat)
now has two tabs:

- **Stickers** — making a sticker from a photo now offers a shape choice
  first: keep the original crop, or cut it to a square or circle, the way
  a real sticker maker would, instead of always just resizing the whole
  photo.
- **Live** (new) — short looping "live" stickers, TikTok-style:
  - **Record one** right here with your camera (up to 5 seconds, no
    audio, muted auto-looping playback everywhere it's used).
  - **Import** an animated GIF, animated WebP, or a short video file.
    Animated WhatsApp stickers exported via WhatsApp's own share/save
    sheet now stay animated when imported — the previous version routed
    every sticker through a canvas resize, which only ever captures one
    frame and silently flattened animation.
  - A live sticker renders as a small looping video wherever a sticker
    can go: the picker grid, the message bubble, and (in Mood Chat/Daily
    Question) the sticker lightbox.

**On "pulling directly from WhatsApp/TikTok":** neither app exposes a
public API for a third-party site to reach into someone's sticker pack
and pull content out directly — there's no legitimate way around that
from a web app, and this app doesn't try to fake it. What's built instead
is what actually works: export the sticker/clip from WhatsApp or TikTok's
own share/save sheet, then import that file here in a couple of taps —
now with animation intact.

Firestore rules for `userStickers/{uid}/items` updated to allow the new
`type`/`mime` fields and a larger size cap for the unresizable
animated/video sticker types (still well under Firestore's 1 MiB
document limit).

---

# Daily Question: now exactly like Mood Chat (voice notes, stickers, replies, receipts)

## What's new
Daily Question's room now shares the exact same chat experience as Mood
Chat — same `.chat-card` shell, same message list, same input bar.

- **Voice notes** and **stickers** can now be sent as answers, not just
  text — same sticker picker and recorder as Mood Chat.
- **Long-press / right-click an answer** for reply or delete (your own
  only); **swipe left/right** to reply, same gesture and thresholds as
  Mood Chat.
- **Delivered/seen receipts** on your latest answer, tracked the same
  group-chat way (`deliveredBy`/`seenBy` maps) as Mood Chat.
- **Tap a sticker** to view it full-size in a lightbox.
- Firestore rules for `dailyQuestions/{day}/answers` updated to match
  `chats/{mood}/messages`: voice/sticker fields are now allowed on
  create, and the two receipt fields may be updated post-create under
  the same restrictions.

---

# Mood Chat: bigger WhatsApp-style room, swipe/long-press actions, stickers, live stats

## What's new
Mood Chat now shares the same polished chat-room shell as Match Chat /
Skill Swap Chat / Event Chat (`.chat-card`), instead of a plain scrolling
list — a taller, bounded panel with a soft wallpaper behind the messages
and a pinned input bar, so it reads as an actual room rather than a page
that just keeps growing.

- **Long-press a message** to open an action sheet: reply, or delete (your
  own messages only). Right-click does the same on desktop.
- **Swipe a message left or right** to reply to it — same gesture as
  WhatsApp. A small drag-and-release past a short threshold opens the
  reply composer with a quote of the original; swiping either direction
  works, and a light drag that doesn't cross the threshold just snaps
  back.
- **Stickers** — a new sticker button next to the input opens a personal
  sticker pack (shared component with Match Chat, `StickerPicker.jsx`).
  Add a sticker from any photo, or import one exported out of WhatsApp's
  own share/save sheet (WhatsApp has no public export API, so "share/save
  as image, then pick it here" is the real-world equivalent of "import
  from WhatsApp" a web app can do). Tap a sent sticker to view it full-size.
- **Live room stats** in the header: online count (unchanged, genuine RTDB
  presence), plus a running "X messages today" chip for the room. Your own
  latest message also shows "Delivered to N • Seen by M" underneath it —
  group-chat read receipts, tracked per-message as small `deliveredBy`/
  `seenBy` maps (who has received/seen it) rather than the single
  delivered/seen pair a 1:1 thread uses. "Seen" only counts while someone's
  tab is actually visible, same distinction Match Chat's receipts make.

## Rules changes
`chats/{mood}/messages` in `firestore.rules`:
- `create` now also allows (and caps) `fileUrl`/`fileMime`, so a sticker
  message can ship the same way a voice note already does.
- `update` went from fully locked (`allow update: if false`) to allowing
  exactly one thing: someone other than the sender adding *their own* uid
  to `deliveredBy` or `seenBy` — every other field, and every other
  person's receipt entry, stays immutable.
- `delete` is unchanged — deleting your own message already worked
  server-side; long-press just exposes it in the UI.

# Match Chat: send photos, audio files, and general files (plus voice notes)

## What's new
Match Chat's input bar now has three ways to send something other than
text, alongside the existing call-request banners:
- **Mic button** — record a voice note (same press-to-record flow as Mood
  Chat), sent as a playable inline clip.
- **Image button** — pick a photo from the gallery/camera roll; it's
  resized client-side and sent as an inline photo bubble. Tapping it opens
  a full-size lightbox.
- **Paperclip button** — pick anything from the file manager. Audio files
  get an inline player (same as a voice note); everything else becomes a
  file card with the name, size, and a tap-to-download link.

## Why everything is a base64 data URL, not a Storage upload
This project has no Firebase Storage bucket wired up (Storage now needs
the paid Blaze plan even for free-tier usage as of Feb 2026 — see the
existing comment in `firebase.js`). Mood Chat already worked around this
for voice notes by embedding the recording directly on the Firestore
message doc as base64; this extends the same approach to photos, audio
files, and general files rather than introducing a Storage dependency
that isn't available on this plan.

New shared helper: `src/lib/chatMedia.js`
- Photos are resized (max 1280px, JPEG) before sending — this keeps a
  normal phone photo well under the size ceiling and still legible full-
  size in the conversation. If a busy/high-res image is still too big
  after resizing, quality steps down automatically before giving up.
- Audio files and general files can't be compressed, so they're checked
  against a hard 650KB raw-size ceiling *before* being read, so an
  oversized pick fails fast with a clear message instead of stalling.
- Every attachment field is also capped server-side in `firestore.rules`
  (`voiceUrl`/`fileUrl` at 900,000 chars — the same cap Mood Chat's
  voiceUrl already used), so a doc can never blow past Firestore's 1 MiB
  limit regardless of what the client sends.

## Known limit worth knowing about
There's no way around the ~650KB-per-attachment ceiling without a real
Storage bucket — it's a hard tradeoff of storing attachments inline on
Spark's free tier. If large-file sharing becomes important, upgrading to
Blaze and switching these to real Storage uploads (with just a download
URL on the message doc, not the bytes themselves) is the natural next
step and wouldn't require reworking the message schema — just swapping
what fileUrl points to.

---

# Content filtering for public surfaces

## Where it's applied, and why only there
New `src/lib/contentFilter.js`, wired into the fully-public places where a
stranger can post something everyone sees with no match or mutual consent
first:
- Mood Chat (text messages)
- Daily Question (answers)
- Match Finder (bio / hobbies / looking-for / name, on save)
- Skill Swap (skill / want, on post)
- Event Buddy (event name / location, on post)

**Deliberately NOT applied to private 1:1 chats** (Match Chat, Skill Swap
Chat, Event Chat) — those are between two people who already matched by
mutual consent, and scanning private conversations crosses a real privacy
line. Report/Block (which you already have, and which I extended to cards
last time) is the right tool for private-chat misbehavior instead.

## What it catches
- A short common-profanity list (not slurs — deliberately kept small and
  visible in the source rather than sprawling, so it's easy to see exactly
  what's checked; extend it yourself if you want stricter coverage)
- Links (`http://`, `www.`) — blocked in public spaces specifically,
  since that's the classic phishing/scam vector in anonymous chat; still
  fine to share once you're actually 1:1 with a match
- Obvious spam patterns: 10+ repeated characters in a row, 15+ consecutive
  capital letters

Basic normalization handles simple evasion (fuuuuck → fuck, common
leetspeak substitutions), but this is genuinely a soft first line, not a
serious defense — said directly in the file's own comments. A determined
person can still get around a word list. If Aura grows past
friends-testing, a real moderation API (Google's Perspective API, or a
paid service) running server-side would be the actual next step.

## Also fixed while I was in these files
`SkillSwap.jsx` and `EventBuddy.jsx`'s own `post()` functions had no error
handling at all — a leftover gap from the earlier reliability pass, which
covered join/request actions and chat sends but missed these two specific
card-posting functions. Both now show a real error if the write fails,
consistent with everywhere else.

## Last item from the original list
Age verification — still just self-reported at signup, no real check.
Want to look at that next?
