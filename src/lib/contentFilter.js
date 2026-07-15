// Lightweight, client-side content moderation for PUBLIC surfaces only
// (Mood Chat, Daily Question, and card bios/listings in Match Finder /
// Skill Swap / Event Buddy) — anywhere a stranger can post something
// visible to everyone before any match or mutual consent exists.
//
// Deliberately NOT used in private 1:1 chats (Match Chat, Skill Swap Chat,
// Event Chat) — those are between two people who've already matched, and
// scanning private conversations is a real privacy line worth respecting.
// Report/Block is the right tool there instead.
//
// Honest limitation, worth being upfront about: this is a word-list and
// pattern filter running in the browser. It catches casual cases and
// makes bad behavior slightly more effort than none — it is NOT a serious
// defense against a determined bad actor, who can trivially bypass it
// with spacing, unicode look-alikes, or leetspeak variants beyond what's
// normalized below. If Aura grows past a friends-testing phase, a real
// moderation service (e.g. Google's Perspective API, or a paid service
// like Sightengine) run server-side would be the actual next step — this
// is a reasonable first line, not a final answer.

// Deliberately a short, common-profanity list — not slurs, not an
// exhaustive list. Extend this yourself if you want stricter coverage;
// keeping it short and clearly-labeled here rather than sprawling makes
// it easy to see exactly what's being checked for.
const PROFANITY = [
  'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'dick', 'piss', 'cunt',
  'whore', 'slut', 'faggot', 'retard',
];

/** lowercase, collapse repeated letters (fuuuuck -> fuck), strip common leetspeak */
function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[0@]/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/[3]/g, 'e')
    .replace(/[$5]/g, 's')
    .replace(/[4]/g, 'a')
    .replace(/(.)\1{2,}/g, '$1') // "aaaa" -> "a"
    .replace(/[^a-z0-9\s]/g, '');
}

export function containsProfanity(text) {
  const norm = normalize(text);
  return PROFANITY.some((word) => norm.includes(word));
}

const URL_PATTERN = /(https?:\/\/|www\.)\S+/i;
const REPEATED_CHAR_SPAM = /(.)\1{9,}/; // same char 10+ times in a row
const EXCESSIVE_CAPS = /[A-Z]{15,}/; // 15+ consecutive capital letters

export function containsSpamPattern(text) {
  if (URL_PATTERN.test(text)) return 'link';
  if (REPEATED_CHAR_SPAM.test(text)) return 'repeated_characters';
  if (EXCESSIVE_CAPS.test(text)) return 'excessive_caps';
  return null;
}

/**
 * Combined check for public-surface text. Returns null if the text is
 * fine, or a short reason string if it should be blocked client-side
 * before ever reaching Firestore.
 */
export function moderateText(text) {
  if (!text || !text.trim()) return null;
  if (containsProfanity(text)) return 'profanity';
  const spam = containsSpamPattern(text);
  if (spam) return spam;
  return null;
}

export const MODERATION_MESSAGES = {
  profanity: "That message doesn't fit Aura's tone — try rewording it.",
  link: 'Links are blocked in public spaces on Aura for everyone\u2019s safety. If you\u2019re chatting 1:1 with a match, you can share links there instead.',
  repeated_characters: 'That message looks like spam — try sending it again without the repeated characters.',
  excessive_caps: 'Try turning off caps lock — all-caps messages get blocked here.',
};
