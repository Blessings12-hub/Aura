import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  collection, addDoc, doc, setDoc, getDoc, query, orderBy, onSnapshot, Timestamp, where, updateDoc, deleteDoc, limit,
} from 'firebase/firestore';
import { CalendarHeart, MessageCircle, Check, X } from 'lucide-react';
import { db } from '../firebase';
import { sendNotification } from '../lib/sendNotification';
import { subscribe } from '../lib/subscribe';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useBlockedUsers } from '../hooks/useBlockedUsers';
import { todayKey } from '../constants/dailyQuestions';
import { moderateText, MODERATION_MESSAGES } from '../lib/contentFilter';
import TopBar from '../components/TopBar';
import PageSkeleton from '../components/PageSkeleton';
import Avatar from '../components/Avatar';
import ReportBlockMenu from '../components/ReportBlockMenu';

const pairId = (a, b) => [a, b].sort().join('_');

export default function EventBuddy() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, userId, loading } = useCurrentUser();
  const blockedUsers = useBlockedUsers(userId);
  const [eventName, setEventName] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [place, setPlace] = useState('');
  const [error, setError] = useState('');
  const [events, setEvents] = useState([]);
  const [joins, setJoins] = useState({});
  const [loadError, setLoadError] = useState('');
  const [pendingActions, setPendingActions] = useState({});

  useEffect(() => {
    // Previously this subscribed to every event ever posted, all-time, with
    // no time bound and no cap — the "hide past events" step happened only
    // client-side, after downloading the entire history. This now filters
    // server-side to events whose date hasn't passed yet, sorted soonest
    // first (a more useful order for an events list than "most recently
    // posted"), with a limit() as a safety cap in case the upcoming list
    // ever gets very large. The where()+orderBy() both target `date`,
    // which Firestore allows on its automatic single-field index — no
    // manual composite index needed in the console for this one.
    const q = query(
      collection(db, 'eventBuddy'),
      where('date', '>=', todayKey()),
      orderBy('date', 'asc'),
      limit(200),
    );
    return subscribe(
      q,
      (s) => setEvents(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setLoadError('Events could not be loaded. Check your connection and try again.'),
      'event buddy',
    );
  }, []);

  useEffect(() => {
    if (!userId) return undefined;
    return subscribe(
      query(collection(db, 'eventJoins'), where('userIds', 'array-contains', userId)),
      (s) => {
        const m = {}; s.docs.forEach((d) => { m[d.id] = d.data(); });
        setJoins(m);
      },
      () => setLoadError('Event requests could not be loaded. Check your connection and try again.'),
      'event joins',
    );
  }, [userId]);

  const post = async () => {
    setError('');
    if (!userId) return;
    if (!eventName.trim() || !date || !time || !place.trim()) { setError(t('fill_required')); return; }
    const moderationReason = moderateText(`${eventName} ${place}`);
    if (moderationReason) {
      setError(MODERATION_MESSAGES[moderationReason]);
      return;
    }
    try {
      // Anonymous by design (matches Aura's "just presence" model, and
      // firestore.rules reject age/gender fields here) — no identity data
      // on the public card.
      await addDoc(collection(db, 'eventBuddy'), {
        userId, userColor: user?.avatarColor,
        eventName: eventName.trim(), date, time, place: place.trim(), createdAt: Timestamp.now(),
      });
      setEventName(''); setDate(''); setTime(''); setPlace('');
    } catch (err) {
      setError(`Couldn't post that. (${err?.code || 'unknown'}: ${err?.message || err})`);
    }
  };

  const joinEvent = async (ev) => {
    if (!userId || ev.userId === userId) return;
    const id = `${ev.id}_${userId}`;
    if (pendingActions[id]) return;
    setError('');
    setPendingActions((prev) => ({ ...prev, [id]: true }));
    try {
      const ref = doc(db, 'eventJoins', id);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, {
          eventId: ev.id, hostId: ev.userId, guestId: userId,
          userIds: [ev.userId, userId], status: 'pending', createdAt: Timestamp.now(),
        });
        sendNotification({
          uid: ev.userId,
          title: 'Aura • Event Buddy',
          body: 'Someone wants to join your event.',
          path: '/aura/event',
        });
      }
    } catch (err) {
      setError(`Couldn't send that request. (${err?.code || 'unknown'}: ${err?.message || err})`);
    } finally {
      setPendingActions((prev) => { const next = { ...prev }; delete next[id]; return next; });
    }
  };

  const acceptJoin = async (joinId) => {
    if (pendingActions[joinId]) return;
    setError('');
    setPendingActions((prev) => ({ ...prev, [joinId]: true }));
    try {
      const snap = await getDoc(doc(db, 'eventJoins', joinId));
      await updateDoc(doc(db, 'eventJoins', joinId), { status: 'accepted', acceptedAt: Timestamp.now() });
      const data = snap.data();
      if (data?.guestId) {
        sendNotification({
          uid: data.guestId,
          title: 'Aura • Event Buddy',
          body: 'Your join request was accepted!',
          path: `/aura/event/chat/${joinId}`,
        });
      }
    } catch (err) {
      setError(`Couldn't accept that request. (${err?.code || 'unknown'}: ${err?.message || err})`);
    } finally {
      setPendingActions((prev) => { const next = { ...prev }; delete next[joinId]; return next; });
    }
  };

  // Reject (host declining a guest) or cancel (guest withdrawing their own
  // pending request) — same action either way, since both just mean "this
  // pending join shouldn't exist". Deletes rather than marking 'rejected'
  // for the same reason as matchPairs/swapPairs: no lingering "declined"
  // signal visible to the other person.
  const rejectJoin = async (joinId) => {
    if (pendingActions[joinId]) return;
    setError('');
    setPendingActions((prev) => ({ ...prev, [joinId]: true }));
    try {
      await deleteDoc(doc(db, 'eventJoins', joinId));
    } catch (err) {
      setError(`Couldn't do that. (${err?.code || 'unknown'}: ${err?.message || err})`);
    } finally {
      setPendingActions((prev) => { const next = { ...prev }; delete next[joinId]; return next; });
    }
  };

  if (loading || !user) return <PageSkeleton />;

  // The query itself now only fetches upcoming events (see the where()
  // above), so this date check is just a defensive backup for any old
  // event docs missing a `date` field — the real filtering already
  // happened server-side instead of downloading the full history first.
  const visibleEvents = events.filter((ev) => !blockedUsers.has(ev.userId) && (!ev.date || ev.date >= todayKey()));

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar title={t('event_buddy')} subtitle={t('event_buddy_desc')} onBack={() => navigate(-1)} />

        <div className="aura-card aura-section fade-in">
          <h2 className="aura-title">{t('post_event')}</h2>
          <input className="aura-input" value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder={t('event_name')} maxLength={150} data-testid="event-name" />
          <div className="aura-row">
            <input type="date" className="aura-input" value={date} onChange={(e) => setDate(e.target.value)} style={{ flex: 1 }} data-testid="event-date" />
            <input type="time" className="aura-input" value={time} onChange={(e) => setTime(e.target.value)} style={{ flex: 1 }} data-testid="event-time" />
          </div>
          <input className="aura-input" value={place} onChange={(e) => setPlace(e.target.value)} placeholder={t('event_location_ph')} maxLength={200} data-testid="event-place" />
          <p className="aura-muted" style={{ fontSize: '0.8rem', margin: '8px 0' }} data-testid="event-safety-note">
            🛡️ {t('event_safety_note')}
          </p>
          {error && <p className="aura-login-error">{error}</p>}
          <button type="button" onClick={post} className="aura-btn aura-btn-primary" data-testid="event-post-btn"><CalendarHeart size={16} /> {t('post_event')}</button>
        </div>

        <h2 className="aura-title">{t('available_events')} ({visibleEvents.length})</h2>
        {loadError && <p className="aura-login-error" data-testid="event-load-error">{loadError}</p>}
        {visibleEvents.length === 0 ? (
          <div className="aura-card" style={{ textAlign: 'center' }}><p className="aura-muted">{t('empty_no_events')}</p></div>
        ) : (
          <div className="aura-grid">
            {visibleEvents.map((ev) => {
              const joinId = `${ev.id}_${userId}`;
              const join = joins[joinId];
              const accepted = join?.status === 'accepted';
              const pending = join?.status === 'pending';
              const isHost = ev.userId === userId;

              // Host view: incoming requests for this event
              const myEventRequests = Object.entries(joins)
                .filter(([, j]) => j.eventId === ev.id && j.hostId === userId && j.status === 'pending');

              return (
                <div key={ev.id} className="aura-card-compact fade-in" data-testid={`event-${ev.id}`}>
                  <div className="aura-row" style={{ marginBottom: 10, justifyContent: 'space-between' }}>
                    <div className="aura-row">
                      <Avatar color={ev.userColor} size={36} />
                      <div><strong>Person {ev.userId?.slice(0, 6)}</strong></div>
                    </div>
                    <ReportBlockMenu
                      userId={userId}
                      otherUserId={ev.userId}
                      blocked={blockedUsers.has(ev.userId)}
                      context="eventBuddy"
                      contextId={ev.id}
                      compact
                    />
                  </div>
                  <h3 style={{ color: 'var(--primary)', margin: '0 0 8px' }}>{ev.eventName}</h3>
                  <p style={{ margin: '4px 0' }}><strong>When:</strong> {ev.date} • {ev.time}</p>
                  <p style={{ margin: '4px 0 12px' }}><strong>Where:</strong> {ev.place}</p>

                  {isHost ? (
                    <>
                      {myEventRequests.length > 0 && (
                        <div className="aura-banner" style={{ marginBottom: 8 }}>{myEventRequests.length} pending request(s)</div>
                      )}
                      {myEventRequests.map(([jid, j]) => (
                        <div key={jid} className="aura-row" style={{ marginBottom: 6 }}>
                          <span className="chip">Guest {j.guestId.slice(0, 6)}</span>
                          <button type="button" onClick={() => acceptJoin(jid)} disabled={!!pendingActions[jid]} className="aura-btn aura-btn-primary aura-btn-pill" data-testid={`accept-${jid}`}><Check size={12} /> {pendingActions[jid] ? t('loading') : t('accept')}</button>
                          <button type="button" onClick={() => rejectJoin(jid)} disabled={!!pendingActions[jid]} className="aura-btn aura-btn-secondary aura-btn-pill" data-testid={`decline-${jid}`}><X size={12} /> {t('decline')}</button>
                        </div>
                      ))}
                    </>
                  ) : accepted ? (
                    <button type="button" onClick={() => navigate(`/aura/event/chat/${joinId}`, { state: { event: ev } })} className="aura-btn aura-btn-primary" data-testid={`event-chat-${ev.id}`}><MessageCircle size={14} /> {t('join_accepted')}</button>
                  ) : pending ? (
                    <>
                      <button type="button" disabled className="aura-btn aura-btn-secondary">{t('join_pending')}</button>
                      <button type="button" onClick={() => rejectJoin(joinId)} disabled={!!pendingActions[joinId]} className="aura-btn aura-btn-secondary" data-testid={`event-cancel-${ev.id}`}><X size={14} /> {t('cancel_request')}</button>
                    </>
                  ) : (
                    <button type="button" onClick={() => joinEvent(ev)} disabled={!!pendingActions[`${ev.id}_${userId}`]} className="aura-btn aura-btn-primary" data-testid={`event-join-${ev.id}`}><CalendarHeart size={14} /> {pendingActions[`${ev.id}_${userId}`] ? t('loading') : t('join_event')}</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
