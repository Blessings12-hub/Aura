import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  Timestamp
} from 'firebase/firestore';
import { Send } from 'lucide-react';
import { db } from '../firebase';
import { useCurrentUser } from '../hooks/useCurrentUser';
import TopBar from '../components/TopBar';

const pairId = (a, b) => [a, b].sort().join('_');

export default function MatchChat() {
  const navigate = useNavigate();
  const location = useLocation();
  const profile = location.state?.profile;
  const { userId, loading } = useCurrentUser();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');

  useEffect(() => {
    if (!profile || !userId) return undefined;

    const chatId = pairId(userId, profile.userId);
    const chatRef = doc(db, 'matchChats', chatId);

    getDoc(chatRef).then((snap) => {
      if (!snap.exists()) {
        setDoc(chatRef, {
          userA: userId,
          userB: profile.userId,
          createdAt: Timestamp.now()
        });
      }
    });

    const q = query(
      collection(db, 'matchChats', chatId, 'messages'),
      orderBy('createdAt', 'asc')
    );

    return onSnapshot(q, (snap) => {
      setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, [profile, userId]);

  const send = async () => {
    if (!text.trim() || !profile || !userId) return;

    const chatId = pairId(userId, profile.userId);

    await addDoc(collection(db, 'matchChats', chatId, 'messages'), {
      text: text.trim(),
      userId,
      createdAt: Timestamp.now()
    });

    setText('');
  };

  if (!profile) {
    return (
      <div className="aura-page">
        <div className="aura-shell">
          <div className="aura-card">
            <p>No match selected.</p>
            <button
              type="button"
              onClick={() => navigate('/aura/match')}
              className="aura-btn aura-btn-primary"
              style={{ marginTop: 12 }}
            >
              Back to Match Finder
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
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
          title="Match Chat"
          subtitle="A private chat with your match."
          onBack={() => navigate(-1)}
        />

        <div className="aura-card aura-section">
          <div style={{ display: 'grid', gap: 8, maxHeight: 480, overflowY: 'auto' }}>
            {messages.map((m) => (
              <div
                key={m.id}
                className={`message${m.userId === userId ? ' message--mine' : ''}`}
                style={{
                  maxWidth: '85%',
                  alignSelf: m.userId === userId ? 'flex-end' : 'flex-start'
                }}
              >
                <p style={{ color: 'var(--text)', margin: 0 }}>{m.text}</p>
              </div>
            ))}

            {messages.length === 0 && (
              <p className="aura-muted" style={{ textAlign: 'center', padding: '1.5rem' }}>
                Say hi to get the conversation started.
              </p>
            )}
          </div>

          <div className="aura-row" style={{ marginTop: 16 }}>
            <input
              className="aura-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') send();
              }}
              placeholder="Type a message…"
              style={{ flex: '1 1 280px' }}
            />

            <button
              type="button"
              onClick={send}
              disabled={!text.trim()}
              className="aura-btn aura-btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Send size={16} /> Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}