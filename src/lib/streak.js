import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
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

  await updateDoc(ref, { dailyStreak, dailyStreakBest, dailyStreakLastDate: day });
  return { dailyStreak, dailyStreakBest };
}
