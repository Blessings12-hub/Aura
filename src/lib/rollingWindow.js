import { Timestamp } from './appwriteFirestoreCompat';

/**
 * Firestore Timestamp for "24 hours ago from right now" — used as a
 * where('createdAt', '>=', ...) clause so browse feeds (Mood Chat,
 * Match Finder, Skill Swap, Event Buddy, Collab Studio) only ever show
 * the last day's worth of content, matching the "everything resets every
 * 24 hours" promise in the README.
 *
 * Deliberately a ROLLING window (exactly 24h from this moment), not a
 * midnight-to-midnight reset — simpler, and avoids timezone edge cases
 * across users in different regions.
 *
 * Important limitation to know: this only HIDES old documents from these
 * queries. It doesn't delete them — actually deleting on a schedule needs
 * something server-side (a Cloud Function + Scheduler), which usually
 * requires Blaze billing regardless of usage, so it's not something this
 * app can do purely client-side. At friends-testing scale this is a
 * non-issue; if Aura grows, old documents will keep accumulating in
 * Firestore's storage quota even though nobody ever sees them again.
 */
export function last24HoursTimestamp() {
  return Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
}
