import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  collection, addDoc, query, orderBy, onSnapshot, Timestamp,
} from 'firebase/firestore';
import { Send } from 'lucide-react';
import { db } from '../firebase';
import { useCurrentUser } from '../hooks/useCurrentUser';
import TopBar from '../components/TopBar';
import Avatar from '../components/Avatar';

export default function MatchChat() {
  const navigate = useNavigate();
  const { matchId } = useParams();
  const { state } = useLocation();
  const profile = state?.profile;
  const { user, userId, loading } = useCurrentUser();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');

  useEffect(() => {
    if (!matchId) return undefined;
    const q = query(collection(db, 'matchChats', matchId, 'messages'), orderBy('createdAt', 'asc'));
    return onSnapshot(q, (snap) => setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }, [matchId]);

  const send = async () => {
    if (!text.trim() || !userId) return;
    await addDoc(collection(db, 'matchChats', matchId, 'messages'), {
      text: text.trim(), userId, userColor: user?.avatarColor, createdAt: Timestamp.now(),
    });
    setText('');
  };

  if (loading) return <div className=\"aura-page\"><div className=\"aura-shell\"><div className=\"aura-card\">{t='Loading…'}</div></div></div>;

  return (
    <div className=\"aura-page\">
      <div className=\"aura-shell\">
        <TopBar title={profile ? `${profile.age} • ${profile.gender}` : 'Match'} subtitle=\"Private chat\" onBack={() => navigate(-1)} />
        <div className=\"aura-card aura-section fade-in\">
          <div className=\"message-list\" data-testid=\"match-message-list\">
            {messages.map((m) => (
              <div key={m.id} className={`message${m.userId === userId ? ' message--mine' : ''}`}>
                <div className=\"aura-row\" style={{ gap: 8 }}><Avatar color={m.userColor} size={20} /><span className=\"message__meta\">Person {m.userId?.slice(0,6)}</span></div>
                <div className=\"message__bubble\">{m.text}</div>
              </div>
            ))}
            {messages.length === 0 && <p className=\"aura-muted\" style={{ textAlign: 'center', padding: '1.5rem' }}>Say hi to get started.</p>}
          </div>
          <div className=\"aura-row\">
            <input className=\"aura-input\" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder=\"Type a message…\" style={{ flex: '1 1 240px' }} data-testid=\"match-input\" />
            <button type=\"button\" onClick={send} disabled={!text.trim()} className=\"aura-btn aura-btn-primary\" data-testid=\"match-send\"><Send size={16} /> Send</button>
          </div>
        </div>
      </div>
    </div>
  );
}

Action: file_editor str_replace /app/frontend/src/pages/MatchChat.jsx --old-str "  if (loading) return <div className=\"aura-page\"><div className=\"aura-shell\"><div className=\"aura-card\">{t='Loading…'}</div></div></div>;" --new-str "  if (loading) return <div className=\"aura-page\"><div className=\"aura-shell\"><div className=\"aura-card\">Loading…</div></div></div>;"
Observation: Edit was successful.