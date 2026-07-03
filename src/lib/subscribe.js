import { onSnapshot as fsOnSnapshot } from 'firebase/firestore';

/**
 * Thin wrapper around Firestore's onSnapshot that guarantees an error
 * handler is always attached. Firestore listeners that error out with no
 * error callback fail silently — the UI just never updates again, with no
 * indication anything went wrong. That exact pattern (missing error
 * handler + a race that could legitimately produce an error) is what
 * caused the app-wide "stuck on loading" bug fixed in useCurrentUser/AuthGate.
 * This exists so any *future* failure (temporary network loss, a rules
 * change that's stricter than expected, etc.) logs clearly instead of
 * disappearing the same way.
 *
 * @param query Firestore query or doc reference
 * @param onData success callback, same as vanilla onSnapshot
 * @param onError optional extra error callback (e.g. to set UI error state)
 * @param label optional string included in the console.error for tracing
 *   which subscription failed
 */
export function subscribe(query, onData, onError, label = 'firestore subscription') {
  return fsOnSnapshot(
    query,
    onData,
    (err) => {
      console.error(`${label} failed:`, err);
      if (onError) onError(err);
    },
  );
}
