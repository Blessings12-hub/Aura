import { doc, getDoc, setDoc } from './appwriteFirestoreCompat';
import { db } from './appwriteFirestoreCompat';
import { todayKey } from '../constants/dailyQuestions';

/** Same YYYY-MM-DD format as todayKey, for the day before `date`. */
export function yesterdayKey(date = new Date()) {
  const y = new Date(date);
  y.setDate(y.getDate() - 1);
  return todayKey(y);
}

/**
 * Call this once when a user answers today's Daily Question — NOT on every
 * message they send (Daily Question is a live chat, someone could post
 * several times in one sitting; the streak should only move once per day).
 *
 * Logic:
 *  - already recorded today  -> no-op
 *  - last recorded yesterday -> streak + 1
 *  - anything else (gap, or first time ever) -> streak resets to 1
 *
 * Returns the resulting { dailyStreak, dailyStreakBest } so the caller can
 * show immediate feedback without waiting on the onSnapshot round-trip,
 * though `useCurrentUser`'s real-time subscription will also pick it up.
 */
export async function recordDailyAnswerStreak(userId, day = todayKey()) {
  const ref = doc(db, 'users', userId);
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() : {};
  const lastDate = data.dailyStreakLastDate;

  if (lastDate === day) {
    // Already answered today — streak doesn't change on a 2nd/3rd message.
    return { dailyStreak: data.dailyStreak || 1, dailyStreakBest: data.dailyStreakBest || 1 };
  }

  const isConsecutive = lastDate === yesterdayKey(new Date(`${day}T00:00:00`));
  const dailyStreak = isConsecutive ? (data.dailyStreak || 0) + 1 : 1;
  const dailyStreakBest = Math.max(dailyStreak, data.dailyStreakBest || 0);

  try {
    await setDoc(ref, { dailyStreak, dailyStreakBest, dailyStreakLastDate: day }, { merge: true });
  } catch (error) {
    if (error?.code === 401 || error?.type === 'user_unauthorized') {
      console.warn('[v0] Daily streak skipped: users document is not writable by this account.');
      return { dailyStreak: data.dailyStreak || 1, dailyStreakBest: data.dailyStreakBest || 1 };
    }
    throw error;
  }
  return { dailyStreak, dailyStreakBest };
}

/**
 * A second, SEPARATE streak from the Daily-Question-specific one above.
 * That one only moves when someone answers today's question; this one
 * moves on any day the person opens Aura at all, regardless of which
 * activity (or none) they actually use. Kept as entirely separate fields
 * (appStreak / appStreakBest / appStreakLastDate) rather than reusing
 * dailyStreak*, so DailyQuestionNudge and the Daily Question page's own
 * streak chip keep working exactly as before — nothing about this touches
 * their logic.
 *
 * Called from PresenceRoot, which already mounts once per authenticated
 * session app-wide, so this doesn't need wiring into every activity page
 * individually. Same once-per-day dedupe pattern as recordDailyAnswerStreak.
 */
export async function recordAppStreak(userId, day = todayKey()) {
  const ref = doc(db, 'users', userId);
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() : {};
  const lastDate = data.appStreakLastDate;

  if (lastDate === day) {
    return { appStreak: data.appStreak || 1, appStreakBest: data.appStreakBest || 1 };
  }

  const isConsecutive = lastDate === yesterdayKey(new Date(`${day}T00:00:00`));
  const appStreak = isConsecutive ? (data.appStreak || 0) + 1 : 1;
  const appStreakBest = Math.max(appStreak, data.appStreakBest || 0);

  try {
    await setDoc(ref, { appStreak, appStreakBest, appStreakLastDate: day }, { merge: true });
  } catch (error) {
    if (error?.code === 401 || error?.type === 'user_unauthorized') {
      console.warn('[v0] App streak skipped: users document is not writable by this account.');
      return { appStreak: data.appStreak || 1, appStreakBest: data.appStreakBest || 1 };
    }
    throw error;
  }
  return { appStreak, appStreakBest };
}
