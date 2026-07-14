import { useCallback, useRef, useState } from 'react';

// A lightweight CLIENT-SIDE throttle for chat sends and posts — it stops
// accidental/casual spam (double-taps, holding Enter down) from a normal
// user of the app. It is NOT real rate limiting: anyone calling the
// Firestore SDK/REST API directly bypasses this entirely, since it's just
// local component state. Real enforcement needs either Firebase App Check
// (rejects traffic that isn't the real app, see firebase.js) or a Cloud
// Function that checks write frequency server-side — this is a stopgap
// until one of those is in place.
export function useSendCooldown(cooldownMs = 1200) {
  const [ready, setReady] = useState(true);
  const timeoutRef = useRef(null);

  const trigger = useCallback(() => {
    setReady(false);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setReady(true), cooldownMs);
  }, [cooldownMs]);

  return { ready, trigger };
}
