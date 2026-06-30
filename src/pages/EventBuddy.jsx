import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  Timestamp
} from 'firebase/firestore';
import { db } from '../firebase';
import { useCurrentUser } from '../hooks/useCurrentUser';
import TopBar from '../components/TopBar';
import Avatar from '../components/Avatar';

export default function EventBuddy() {
  const navigate = useNavigate();
  const { user, userId, loading } = useCurrentUser();
  const [eventName, setEventName] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [time, setTime] = useState('');
  const [place, setPlace] = useState('');
  const [error, setError] = useState('');
  const [events, setEvents] = useState([]);

  useEffect(() => {
    const q = query(collection(db, 'eventBuddy'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snap) => {
      setEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, []);

  const post = async () => {
    setError('');

    if (!userId) return;
    if (!eventName.trim() || !selectedDate || !time || !place.trim()) {
      setError('Please fill in every field.');
      return;
    }

    await addDoc(collection(db, 'eventBuddy'), {
      userId,
      userAge: user?.age,
      userGender: user?.gender,
      userColor: user?.avatarColor,
      eventName: eventName.trim(),
      date: selectedDate,
      time,
      place: place.trim(),
      createdAt: Timestamp.now()
    });

    setEventName('');
    setSelectedDate('');
    setTime('');
    setPlace('');
  };

  if (loading || !user) {
    return (
      <div className="aura-page">
        <div className="aura-shell">
          <div className="aura-card">Loading…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar
          title="Event Buddy"
          subtitle="Find someone to join you. Concerts, dinners, walks — anything."
          onBack={() => navigate(-1)}
        />

        <div className="aura-card aura-section">
          <h2 style={{ marginTop: 0, color: 'var(--text)' }}>Post an event</h2>

          <input
            className="aura-input"
            value={eventName}
            onChange={(e) => setEventName(e.target.value)}
            placeholder="Event name (concert, dinner, movie…)"
            style={{ marginBottom: 12 }}
          />

          <Field label="Date">
            <input
              className="aura-input"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </Field>

          <Field label="Time">
            <input
              className="aura-input"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </Field>

          <Field label="Location">
            <input
              className="aura-input"
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              placeholder="e.g. Central Park, the coffee shop downtown"
            />
          </Field>

          {error && (
            <p
              role="alert"
              style={{
                color: 'var(--danger)',
                fontSize: '0.9rem',
                margin: '0 0 12px'
              }}
            >
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={post}
            className="aura-btn aura-btn-primary"
          >
            Post event
          </button>
        </div>

        <div className="aura-section">
          <h2 style={{ color: 'var(--text)', marginBottom: 12 }}>
            Available events ({events.length})
          </h2>

          {events.length === 0 ? (
            <div className="aura-card" style={{ textAlign: 'center' }}>
              <p className="aura-muted">No events yet. Create one.</p>
            </div>
          ) : (
            <div className="aura-grid">
              {events.map((event) => (
                <div key={event.id} className="aura-card-compact">
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      marginBottom: 12
                    }}
                  >
                    <Avatar color={event.userColor} size={36} />
                    <div>
                      <strong style={{ color: 'var(--text)' }}>
                        Person {event.userId?.slice(0, 6)}
                      </strong>
                      <span className="aura-muted" style={{ fontSize: '0.85rem', marginLeft: 6 }}>
                        {event.userAge} • {event.userGender}
                      </span>
                    </div>
                  </div>

                  <h3 style={{ color: 'var(--primary)', margin: '0 0 8px' }}>
                    {event.eventName}
                  </h3>

                  <p style={{ margin: '4px 0', color: 'var(--text)' }}>
                    <strong>Date:</strong> {event.date || 'TBD'} • {event.time || 'TBD'}
                  </p>

                  <p style={{ margin: '4px 0', color: 'var(--text)' }}>
                    <strong>Where:</strong> {event.place}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'block', marginBottom: 12, color: 'var(--text)' }}>
      <span style={{ fontWeight: 600, display: 'block', marginBottom: 6 }}>
        {label}
      </span>
      {children}
    </label>
  );
}