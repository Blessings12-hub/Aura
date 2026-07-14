import { useEffect, useState } from 'react';
import {
  collection, query, where, onSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';

// Live view of every request that is genuinely waiting on ME to respond,
// across the three activities that use a request/accept flow. This is what
// backs the badges on Home.jsx and the notification in
// IncomingRequestWatcher — without it, the only way to discover "someone
// requested you" was to happen to reopen that exact activity and scroll
// past their card again, with no reason to think to do so.
//
// A pair only counts as "incoming" here, not "outgoing": the initiator is
// always stored as userA (and is auto-accepted at creation), so a doc only
// shows up for its userB, never its userA — that side already has the
// pending state reflected on their own outgoing request instead.
export function useIncomingRequests(userId) {
  const [matchRequests, setMatchRequests] = useState([]);
  const [swapRequests, setSwapRequests] = useState([]);
  const [eventRequests, setEventRequests] = useState([]);

  useEffect(() => {
    if (!userId) {
      setMatchRequests([]);
      setSwapRequests([]);
      setEventRequests([]);
      return undefined;
    }

    const unsubMatch = onSnapshot(
      query(collection(db, 'matchPairs'), where('userB', '==', userId)),
      (snap) => setMatchRequests(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((m) => m.status !== 'matched' && !m.userBAccepted),
      ),
      () => {},
    );

    const unsubSwap = onSnapshot(
      query(collection(db, 'swapPairs'), where('userB', '==', userId)),
      (snap) => setSwapRequests(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((s) => s.status !== 'matched' && !s.userBAccepted),
      ),
      () => {},
    );

    const unsubEvent = onSnapshot(
      query(collection(db, 'eventJoins'), where('hostId', '==', userId)),
      (snap) => setEventRequests(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((e) => e.status === 'pending'),
      ),
      () => {},
    );

    return () => { unsubMatch(); unsubSwap(); unsubEvent(); };
  }, [userId]);

  return {
    matchRequests,
    swapRequests,
    eventRequests,
    total: matchRequests.length + swapRequests.length + eventRequests.length,
  };
}
