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
