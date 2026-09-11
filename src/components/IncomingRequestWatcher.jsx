import { useEffect, useRef } from 'react';
import { collection, onSnapshot, query, where } from '../lib/appwriteFirestoreCompat';
import { db } from '../firebase';
import { useIncomingRequests } from '../hooks/useIncomingRequests';
import { pushAuraNotification } from '../notifications/NotificationManager';

// Mounted once, globally, in App.jsx (via PresenceRoot). Has no UI of its
// own — it just watches for activity that needs a notification, no matter
// which page you're currently on:
//   1. a brand NEW incoming match/swap/event request (useIncomingRequests)
//   2. one of MY OWN outgoing requests getting accepted — this was the
//      actual gap that made it look like "I sent a request, they accepted
//      it, and I never heard anything about it": useIncomingRequests only
//      ever tracked requests waiting on ME, never the flip side.
//   3. a skill swap video call being requested or accepted by the other
//      participant.
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

  // ------------------------------------------------------------------
  // My own pairs reaching 'matched' (either side — I may have been the
  // initiator OR the accepter, it doesn't matter here) and skill-swap
  // video call state changes. Two straight `where` queries per collection
  // (userA==me / userB==me) since Firestore can't OR across fields in one
  // query, same pattern used by MatchFinder/SkillSwap themselves.
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!userId) return undefined;

    // All plain closure state, scoped to this effect run (reset whenever
    // userId changes, which only happens on login/logout).
    const seenMatched = new Set();
    const seenVideoState = {}; // pairId -> 'requested' | 'accepted'
    const firstSnapDone = { matchA: false, matchB: false, swapA: false, swapB: false };

    const handlePairSnapshot = (snap, kind, label, firstKey) => {
      const isFirst = !firstSnapDone[firstKey];
      snap.docChanges().forEach((change) => {
        const data = change.doc.data();
        const id = change.doc.id;

        if (data.status === 'matched') {
          if (isFirst) {
            seenMatched.add(id);
          } else if (!seenMatched.has(id)) {
            seenMatched.add(id);
            pushAuraNotification(
              `Aura • ${label}`,
              kind === 'match' ? 'Someone accepted your match request — you can chat now!' : 'Someone accepted your swap request — you can chat now!',
            );
          }
        }

        // Skill swap video call requests/acceptances — only relevant for
        // swapPairs, tracked via the videoA/videoB consent flags.
        if (kind === 'swap') {
          const isA = data.userA === userId;
          const myFlag = isA ? data.videoA : data.videoB;
          const theirFlag = isA ? data.videoB : data.videoA;
          if (isFirst) {
            if (theirFlag && myFlag) seenVideoState[id] = 'accepted';
            else if (theirFlag) seenVideoState[id] = 'requested';
            return;
          }
          const prevState = seenVideoState[id];
          if (theirFlag && !myFlag && prevState !== 'requested') {
            seenVideoState[id] = 'requested';
            pushAuraNotification('Aura • Skill Swap', 'Someone wants a video call with you.');
          } else if (theirFlag && myFlag && prevState !== 'accepted') {
            seenVideoState[id] = 'accepted';
            pushAuraNotification('Aura • Skill Swap', 'Your video call request was accepted — you can start the call!');
          } else if (!theirFlag && prevState) {
            // Cancelled/reset — clear so a future request can notify again.
            delete seenVideoState[id];
          }
        }
      });
      firstSnapDone[firstKey] = true;
    };

    const unsubMatchA = onSnapshot(
      query(collection(db, 'matchPairs'), where('userA', '==', userId)),
      (snap) => handlePairSnapshot(snap, 'match', 'Match Finder', 'matchA'),
      () => {},
    );
    const unsubMatchB = onSnapshot(
      query(collection(db, 'matchPairs'), where('userB', '==', userId)),
      (snap) => handlePairSnapshot(snap, 'match', 'Match Finder', 'matchB'),
      () => {},
    );
    const unsubSwapA = onSnapshot(
      query(collection(db, 'swapPairs'), where('userA', '==', userId)),
      (snap) => handlePairSnapshot(snap, 'swap', 'Skill Swap', 'swapA'),
      () => {},
    );
    const unsubSwapB = onSnapshot(
      query(collection(db, 'swapPairs'), where('userB', '==', userId)),
      (snap) => handlePairSnapshot(snap, 'swap', 'Skill Swap', 'swapB'),
      () => {},
    );

    // Guest-side: my own eventJoins reaching 'accepted' (the host-side
    // "pending requests for my event" case is already covered above by
    // useIncomingRequests, which watches eventJoins from the host's view).
    const seenEventAccepted = new Set();
    let firstEventSnap = true;
    const unsubEventGuest = onSnapshot(
      query(collection(db, 'eventJoins'), where('guestId', '==', userId)),
      (snap) => {
        if (firstEventSnap) {
          snap.docs.forEach((d) => { if (d.data().status === 'accepted') seenEventAccepted.add(d.id); });
          firstEventSnap = false;
          return;
        }
        snap.docChanges().forEach((change) => {
          const data = change.doc.data();
          if (data.status === 'accepted' && !seenEventAccepted.has(change.doc.id)) {
            seenEventAccepted.add(change.doc.id);
            pushAuraNotification('Aura • Event Buddy', 'The host accepted your request to join — you can chat now!');
          }
        });
      },
      () => {},
    );

    return () => { unsubMatchA(); unsubMatchB(); unsubSwapA(); unsubSwapB(); unsubEventGuest(); };
  }, [userId]);

  return null;
}
