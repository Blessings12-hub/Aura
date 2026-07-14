import { useEffect, useRef } from 'react';
import { useIncomingRequests } from '../hooks/useIncomingRequests';
import { pushAuraNotification } from '../notifications/NotificationManager';

// Mounted once, globally, in App.jsx (like OfflineBanner). Has no UI of its
// own — it just watches for NEW incoming match/swap/event requests and
// fires a browser notification the moment one shows up, no matter which
// page you're currently on.
//
// IMPORTANT LIMITATION: this only works while the app is open in a tab
// somewhere on this device — it's the browser Notification API, not a true
// push. If the person has fully closed the browser/tab, nothing fires.
// Real cross-device delivery (phone locked, app closed) needs a server-side
// trigger — see functions/index.js and the README section on deploying it.
export default function IncomingRequestWatcher({ userId }) {
  const { matchRequests, swapRequests, eventRequests } = useIncomingRequests(userId);
  const seenIds = useRef(new Set());
  const isFirstRun = useRef(true);

  useEffect(() => {
    const all = [
      ...matchRequests.map((r) => ({ ...r, kind: 'match' })),
      ...swapRequests.map((r) => ({ ...r, kind: 'swap' })),
      ...eventRequests.map((r) => ({ ...r, kind: 'event' })),
    ];

    // On the very first snapshot after mount/login, just record what's
    // already pending without notifying — otherwise every existing
    // request would re-fire a notification on every app open/reload.
    if (isFirstRun.current) {
      all.forEach((r) => seenIds.current.add(r.id));
      isFirstRun.current = false;
      return;
    }

    all.forEach((r) => {
      if (seenIds.current.has(r.id)) return;
      seenIds.current.add(r.id);
      if (r.kind === 'match') {
        pushAuraNotification('Aura • Match Finder', 'Someone wants to match with you.');
      } else if (r.kind === 'swap') {
        pushAuraNotification('Aura • Skill Swap', 'Someone wants to swap skills with you.');
      } else {
        pushAuraNotification('Aura • Event Buddy', 'Someone wants to join your event.');
      }
    });
  }, [matchRequests, swapRequests, eventRequests]);

  return null;
}
