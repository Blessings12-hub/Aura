import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { doc, getDoc, collection, addDoc, onSnapshot, query, orderBy, Timestamp } from 'firebase/firestore';
import TopBar from '../components/TopBar';

export default function EventBuddy({ theme, setTheme }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [eventName, setEventName] = useState('');
  const [dateOption, setDateOption] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [timeOption, setTimeOption] = useState('');
  const [placeOption, setPlaceOption] = useState('');
  const [events, setEvents] = useState([]);

  useEffect(() => {
    const loadUser = async () => {
      const userId = localStorage.getItem('aura_userId');
      if (!userId) return navigate('/');
      const userDoc = await getDoc(doc(db, 'users', userId));
      if (userDoc.exists()) setUser(userDoc.data());
      else navigate('/');
    };
    loadUser();
  }, [navigate]);

  useEffect(() => {
    const qref = query(collection(db, 'eventBuddy'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(qref, (snap) => {
      setEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  const postEvent = async () => {
    const userId = localStorage.getItem('aura_userId');
    if (!userId || !eventName.trim() || !dateOption.trim() || !timeOption.trim() || !placeOption.trim()) {
      alert('Please fill all fields');
      return;
    }

    await addDoc(collection(db, 'eventBuddy'), {
      userId,
      userAge: user?.age,
      userGender: user?.gender,
      userColor: user?.avatarColor,
      eventName: eventName.trim(),
      dateOption: dateOption.trim(),
      selectedDate: selectedDate.trim(),
      timeOption: timeOption.trim(),
      placeOption: placeOption.trim(),
      createdAt: Timestamp.now()
    });

    setEventName('');
    setDateOption('');
    setSelectedDate('');
    setTimeOption('');
    setPlaceOption('');
  };

  if (!user) return <div className="aura-page"><div className="aura-shell"><div className="aura-card">Loading...</div></div></div>;

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar
          title="Event Buddy"
          subtitle="Find anonymous event partners. Join dates, concerts, trips, and more."
          onBack={() => navigate(-1)}
          theme={theme}
          setTheme={setTheme}
        />

        <div className="aura-card aura-section">
          <h2 style={{ color: 'var(--text)', marginBottom: '1rem' }}>Create Event</h2>
          <input className="aura-input" value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="Event name e.g., Concert, Dinner, Movie" style={{ marginBottom: 14 }} />

          <label style={{ color: 'var(--text)', fontWeight: 600, marginBottom: 8, display: 'block' }}>
            Select Date
            <input className="aura-input" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} type="date" style={{ marginTop: 8 }} />
          </label>

          <label style={{ color: 'var(--text)', fontWeight: 600, marginBottom: 8, display: 'block', marginTop: 14 }}>
            Time Option
            <input className="aura-input" value={timeOption} onChange={(e) => setTimeOption(e.target.value)} placeholder="e.g., 7:00 PM" type="time" style={{ marginTop: 8 }} />
          </label>

          <label style={{ color: 'var(--text)', fontWeight: 600, marginBottom: 8, display: 'block', marginTop: 14 }}>
            Location Option
            <input className="aura-input" value={placeOption} onChange={(e) => setPlaceOption(e.target.value)} placeholder="e.g., Central Park OR Coffee Shop Downtown" style={{ marginTop: 8 }} />
          </label>

          <button onClick={postEvent} className="aura-btn aura-btn-primary" style={{ marginTop: 24 }}>
            Post Event
          </button>
        </div>

        <div className="aura-section">
          <h2 style={{ color: 'var(--text)', marginBottom: '1rem' }}>Available Events ({events.length})</h2>
          {events.length === 0 ? (
            <div className="aura-card" style={{ textAlign: 'center' }}>
              <p className="aura-muted">No events yet. Create one!</p>
            </div>
          ) : (
            <div className="aura-grid">
              {events.map((event) => (
                <div key={event.id} className="aura-card-compact">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: event.userColor || '#ddd' }} />
                    <div>
                      <strong style={{ color: 'var(--text)' }}>Person {event.userId?.slice(0, 6)}</strong>
                      <span style={{ color: 'var(--muted)', marginLeft: 8 }}>
                        {event.userAge} • {event.userGender}
                      </span>
                    </div>
                  </div>
                  <h3 style={{ color: 'var(--primary)', marginBottom: '8px' }}>{event.eventName}</h3>
                  <div style={{ marginBottom: 8 }}><strong>Calendar Date:</strong> {event.selectedDate || 'Not set'}</div>
                  <div style={{ marginBottom: 8 }}><strong>Date Options:</strong> {event.dateOption}</div>
                  <div style={{ marginBottom: 8 }}><strong>Time:</strong> {event.timeOption}</div>
                  <div style={{ marginBottom: 12 }}><strong>Location:</strong> {event.placeOption}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}