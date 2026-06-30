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
import { Send, Mic } from 'lucide-react';
import { db } from '../firebase';
import { MOODS } from '../constants/moods';
import { useCurrentUser } from '../hooks/useCurrentUser';
import TopBar from '../components/TopBar';
import Avatar from '../components/Avatar';

export default function MoodChat() {
  const navigate = useNavigate();
  const { user, userId, loading } = useCurrentUser();
  const [mood, setMood] = useState('');
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');

  useEffect(() => {
    if (!mood) {
      setMessages([]);
      return undefined;
    }

    const q = query(
      collection(db, 'chats', mood, 'messages'),
      orderBy('createdAt', 'asc')
    );

    return onSnapshot(q, (snap) => {
      setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, [mood]);

  const send = async () => {
    if (!text.trim() || !mood || !userId) return;

    await addDoc(collection(db, 'chats', mood, 'messages'), {
      text: text.trim(),
      userId,
      userAge: user?.age,
      userGender: user?.gender,
      userColor: user?.avatarColor,
      createdAt: Timestamp.now()
    });

    setText('');
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
          title="Mood Chat"
          subtitle={`Anonymous chat • ${user.age}, ${user.gender}`}
          onBack={() => navigate(-1)}
        />

        <div className="aura-card aura-section">
          {!mood ? (
            <MoodPicker onPick={setMood} />
          ) : (
            <ChatView
              mood={mood}
              messages={messages}
              userId={userId}
              text={text}
              setText={setText}
              onSend={send}
              onChangeMood={() => setMood('')}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function MoodPicker({ onPick }) {
  return (
    <div>
      <h2 style={{ textAlign: 'center', color: 'var(--text)', marginTop: 0 }}>
        How are you feeling right now?
      </h2>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 12,
          marginTop: 20
        }}
      >
        {MOODS.map((m) => (
          <button
            key={m.name}
            type="button"
            onClick={() => onPick(m.name)}
            className="aura-btn"
            style={{
              padding: '1.2rem',
              background: m.color,
              color: '#fff'
            }}
          >
            {m.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChatView({ mood, messages, userId, text, setText, onSend, onChangeMood }) {
  return (
    <div>
      <div
        style={{
          background: 'var(--primary)',
          color: '#fff',
          padding: '1.25rem',
          borderRadius: 14,
          marginBottom: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap'
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '1.5rem' }}>{mood}</h2>
          <p style={{ margin: '4px 0 0', opacity: 0.85, fontSize: '0.9rem' }}>
            {messages.length} message{messages.length === 1 ? '' : 's'} • anonymous
          </p>
        </div>

        <button
          type="button"
          onClick={onChangeMood}
          className="aura-btn aura-btn-secondary"
        >
          Change mood
        </button>
      </div>

      <div
        className="aura-card-compact"
        style={{ marginBottom: 16, maxHeight: 500, overflowY: 'auto' }}
      >
        {messages.length === 0 ? (
          <p className="aura-muted" style={{ textAlign: 'center', padding: '2rem' }}>
            No messages yet. Be the first to say hi.
          </p>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`message${msg.userId === userId ? ' message--mine' : ''}`}
            >
              <div className="message__header">
                <Avatar color={msg.userColor} size={32} />
                <div style={{ minWidth: 0 }}>
                  <strong style={{ color: 'var(--text)', fontSize: '0.9rem' }}>
                    Person {msg.userId?.slice(0, 6)}
                  </strong>
                  <span style={{ color: 'var(--muted)', fontSize: '0.8rem', marginLeft: 6 }}>
                    {msg.userAge} • {msg.userGender}
                  </span>
                </div>
              </div>

              <p style={{ color: 'var(--text)', margin: 0, lineHeight: 1.5 }}>
                {msg.text}
              </p>
            </div>
          ))
        )}
      </div>

      <div className="aura-row">
        <input
          type="text"
          className="aura-input"
          placeholder="Type an anonymous message…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSend();
          }}
          style={{ flex: '1 1 280px' }}
        />

        <button
          type="button"
          className="aura-btn aura-btn-secondary"
          title="Voice notes — coming soon"
          disabled
          aria-label="Send voice note (coming soon)"
        >
          <Mic size={18} />
        </button>

        <button
          type="button"
          onClick={onSend}
          className="aura-btn aura-btn-primary"
          disabled={!text.trim()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Send size={16} /> Send
        </button>
      </div>
    </div>
  );
}