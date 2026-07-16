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
