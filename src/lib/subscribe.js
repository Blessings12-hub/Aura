import { onSnapshot as fsOnSnapshot } from 'firebase/firestore';

export function subscribe(query, onData, onError, label = 'firestore subscription') {
  return fsOnSnapshot(
    query,
    onData,
    (err) => {
      console.error(`${label} failed:`, err);
      onError?.(err);
    },
  );
}
