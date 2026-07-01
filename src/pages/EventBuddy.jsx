import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  collection, addDoc, doc, setDoc, getDoc, query, orderBy, onSnapshot, Timestamp, where, updateDoc,
} from 'firebase/firestore';
import { CalendarHeart, MessageCircle, Check } from 'lucide-react';
import { db } from '../firebase';
import { useCurrentUser } from '../hooks/useCurrentUser';
import TopBar from '../components/TopBar';
import Avatar from '../components/Avatar';

const pairId = (a, b) => [a, b].sort().join('_');

export default function EventBuddy() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, userId, loading } = useCurrentUser();
  const [eventName, setEventName] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [place, setPlace] = useState('');
  const [error, setError] = useState('');
  const [events, setEvents] = useState([]);
  const [joins, setJoins] = useState({});

  useEffect(() => {
    const q = query(collection(db, 'eventBuddy'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (s) => setEvents(s.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }, []);

  useEffect(() => {
    if (!userId) return undefined;
    return onSnapshot(query(collection(db, 'eventJoins'), where('userIds', 'array-contains', userId)), (s) => {
      const m = {}; s.docs.forEach((d) => { m[d.id] = d.data(); });
      setJoins(m);
    });
  }, [userId]);

  const post = async () => {
    setError('');
    if (!userId) return;
    if (!eventName.trim() || !date || !time || !place.trim()) { setError(t('fill_required')); return; }
    await addDoc(collection(db, 'eventBuddy'), {
      userId, userAge: user?.age, userGender: user?.gender, userColor: user?.avatarColor,
      eventName: eventName.trim(), date, time, place: place.trim(), createdAt: Timestamp.now(),
    });
    setEventName(''); setDate(''); setTime(''); setPlace('');
  };

  const joinEvent = async (ev) => {
    if (!userId || ev.userId === userId) return;
    const id = `${ev.id}_${userId}`;
    const ref = doc(db, 'eventJoins', id);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        eventId: ev.id, hostId: ev.userId, guestId: userId,
        userIds: [ev.userId, userId], status: 'pending', createdAt: Timestamp.now(),
      });
    }
  };

  const acceptJoin = async (joinId) => {
    await updateDoc(doc(db, 'eventJoins', joinId), { status: 'accepted', acceptedAt: Timestamp.now() });
  };

  if (loading || !user) return <div className=\"aura-page\"><div className=\"aura-shell\"><div className=\"aura-card\">{t('loading')}</div></div></div>;

  return (
    <div className=\"aura-page\">
      <div className=\"aura-shell\">
        <TopBar title={t('event_buddy')} subtitle={t('event_buddy_desc')} onBack={() => navigate(-1)} />

        <div className=\"aura-card aura-section fade-in\">
          <h2 className=\"aura-title\">{t('post_event')}</h2>
          <input className=\"aura-input\" value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder={t('event_name')} data-testid=\"event-name\" />
          <div className=\"aura-row\">
            <input type=\"date\" className=\"aura-input\" value={date} onChange={(e) => setDate(e.target.value)} style={{ flex: 1 }} data-testid=\"event-date\" />
            <input type=\"time\" className=\"aura-input\" value={time} onChange={(e) => setTime(e.target.value)} style={{ flex: 1 }} data-testid=\"event-time\" />
          </div>
          <input className=\"aura-input\" value={place} onChange={(e) => setPlace(e.target.value)} placeholder={t('event_location_ph')} data-testid=\"event-place\" />
          {error && <p className=\"aura-login-error\">{error}</p>}
          <button type=\"button\" onClick={post} className=\"aura-btn aura-btn-primary\" data-testid=\"event-post-btn\"><CalendarHeart size={16} /> {t('post_event')}</button>
        </div>

        <h2 className=\"aura-title\">{t('available_events')} ({events.length})</h2>
        {events.length === 0 ? (
          <div className=\"aura-card\" style={{ textAlign: 'center' }}><p className=\"aura-muted\">{t('empty_no_events')}</p></div>
        ) : (
          <div className=\"aura-grid\">
            {events.map((ev) => {
              const joinId = `${ev.id}_${userId}`;
              const join = joins[joinId];
              const accepted = join?.status === 'accepted';
              const pending = join?.status === 'pending';
              const isHost = ev.userId === userId;

              // Host view: incoming requests for this event
              const myEventRequests = Object.entries(joins)
                .filter(([, j]) => j.eventId === ev.id && j.hostId === userId && j.status === 'pending');

              return (
                <div key={ev.id} className=\"aura-card-compact fade-in\" data-testid={`event-${ev.id}`}>
                  <div className=\"aura-row\" style={{ marginBottom: 10 }}>
                    <Avatar color={ev.userColor} size={36} />
                    <div><strong>Person {ev.userId?.slice(0,6)}</strong><span className=\"aura-muted\" style={{ marginLeft: 6 }}>{ev.userAge} • {ev.userGender}</span></div>
                  </div>
                  <h3 style={{ color: 'var(--primary)', margin: '0 0 8px' }}>{ev.eventName}</h3>
                  <p style={{ margin: '4px 0' }}><strong>When:</strong> {ev.date} • {ev.time}</p>
                  <p style={{ margin: '4px 0 12px' }}><strong>Where:</strong> {ev.place}</p>

                  {isHost ? (
                    <>
                      {myEventRequests.length > 0 && (
                        <div className=\"aura-banner\" style={{ marginBottom: 8 }}>{myEventRequests.length} pending request(s)</div>
                      )}
                      {myEventRequests.map(([jid, j]) => (
                        <div key={jid} className=\"aura-row\" style={{ marginBottom: 6 }}>
                          <span className=\"chip\">Guest {j.guestId.slice(0, 6)}</span>
                          <button type=\"button\" onClick={() => acceptJoin(jid)} className=\"aura-btn aura-btn-primary aura-btn-pill\" data-testid={`accept-${jid}`}><Check size={12} /> {t('accept')}</button>
                        </div>
                      ))}
                    </>
                  ) : accepted ? (
                    <button type=\"button\" onClick={() => navigate(`/aura/event/chat/${joinId}`, { state: { event: ev } })} className=\"aura-btn aura-btn-primary\" data-testid={`event-chat-${ev.id}`}><MessageCircle size={14} /> {t('join_accepted')}</button>
                  ) : pending ? (
                    <button type=\"button\" disabled className=\"aura-btn aura-btn-secondary\">{t('join_pending')}</button>
                  ) : (
                    <button type=\"button\" onClick={() => joinEvent(ev)} className=\"aura-btn aura-btn-primary\" data-testid={`event-join-${ev.id}`}><CalendarHeart size={14} /> {t('join_event')}</button>
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