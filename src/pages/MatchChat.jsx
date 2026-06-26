import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { doc, getDoc, collection, addDoc, onSnapshot, query, orderBy, Timestamp, setDoc } from 'firebase/firestore';
import TopBar from '../components/TopBar';

export default function MatchChat({ theme, setTheme }) {
  const navigate = useNavigate();
  const location = useLocation();
  const profile = location.state?.profile;
  const [userId, setUserId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const uid = localStorage.getItem('aura_userId');
    if (!uid) return navigate('/');
    setUserId(uid);
  }, [navigate]);

  useEffect(() => {
    if (!profile || !userId) return;
    const chatId = [userId, profile.userId].sort().join('_');
    const chatRef = doc(db, 'matchChats', chatId);

    const init = async () => {
      const snap = await getDoc(chatRef);
      if (!snap.exists()) {
        await setDoc(chatRef, {
          userA: userId,
          userB: profile.userId,
          createdAt: Timestamp.now()
        });
      }
    };

    init();

    const qref = query(collection(db, 'matchChats', chatId, 'messages'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(qref, (snap) => setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return () => unsub();
  }, [profile, userId]);

  const sendMessage = async () => {
    if (!message.trim() || !profile || !userId) return;
    const chatId = [userId, profile.userId].sort().join('_');

    await addDoc(collection(db, 'matchChats', chatId, 'messages'), {
      text: message.trim(),
      userId,
      createdAt: Timestamp.now()
    });

    setMessage('');
  };

  if (!profile) return <div className="aura-page"><div className="aura-shell"><div className="aura-card">No match selected.</div></div></div>;
  if (!userId) return <div className="aura-page"><div className="aura-shell"><div className="aura-card">Loading...</div></div></div>;

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar
          title="Match Chat"
          subtitle="Private chat with your match."
          onBack={() => navigate(-1)}
          theme={theme}
          setTheme={setTheme}
        />

        <div className="aura-card aura-section">
          <div className="aura-grid">
            {messages.map((msg) => (
              <div key={msg.id} className="aura-card-compact" style={{ background: msg.userId === userId ? 'rgba(79,70,229,0.08)' : 'var(--surface-2)' }}>
                <p style={{ margin: 0, color: 'var(--text)' }}>{msg.text}</p>
              </div>
            ))}
          </div>

          <div className="aura-row" style={{ marginTop: 16 }}>
            <input
              className="aura-input"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type a message..."
              style={{ flex: '1 1 300px' }}
            />
            <button onClick={sendMessage} className="aura-btn aura-btn-primary">
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}