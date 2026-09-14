import { doc, increment, setDoc } from './firestoreClient';
import { db } from './firestoreClient';
import { todayKey } from '../constants/dailyQuestions';

/**
 * Lightweight daily activity counter, one doc per day: moodActivity/{day}
 * with a field per mood name holding a message count. This exists purely
 * so the mood PICKER can show "X messages today" before someone commits to
 * a mood — the actual goal is steering people toward rooms that already
 * have life in them, rather than fixing the empty-room feeling after the
 * fact. Deliberately NOT per-user or per-message data — just a running
 * total, so it's cheap to read (one doc) and low-stakes to write (a
 * strictly-additive increment, not any real user data).
 */
export async function recordMoodActivity(mood, day = todayKey()) {
  try {
    await setDoc(doc(db, 'moodActivity', day), { [mood]: increment(1) }, { merge: true });
  } catch (err) {
    // Never worth blocking or erroring the actual message send over a
    // vanity counter failing to update.
    console.error('moodActivity increment failed', err);
  }
}
