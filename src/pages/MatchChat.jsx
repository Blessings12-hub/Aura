import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  collection, addDoc, doc, onSnapshot, query, orderBy, Timestamp,
} from 'firebase/firestore';
import { Send } from 'lucide-react';
import { db } from '../firebase';
import { subscribe } from '../lib/subscribe';
import { useCurrentUser } from '../hooks/useCurrentUser';
import TopBar from '../components/TopBar';
import Avatar from '../components/Avatar';

export default function MatchChat() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { matchId } = useParams();
  const { user, userId, loading } = useCurrentUser();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [theirIdentity, setTheirIdentity] = useState(null);
  const [chatError, setChatError] = useState('');

  // matchId is "<uidA>_<uidB>" (sorted). The other participant is whichever
  // half isn't me.
  const theirUid = matchId?.split('_').find((id) => id !== userId);

  useEffect(() => {
    if (!matchId) return undefined;
    const q = query(collection(db, 'matchChats', matchId, 'messages'), orderBy('createdAt', 'asc'));
    return subscribe(
      q,
      (snap) => setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setChatError('Messages could not be loaded. Check your connection and try again.'),
      `match chat (${matchId})`,
    );
  }, [matchId]);

  // Now that we're matched, Firestore rules allow reading their identity
  // doc (age/gender) directly — no need to pass it through router state.
  useEffect(() => {
    if (!theirUid) return undefined;
    return onSnapshot(
      doc(db, 'userIdentities', theirUid),
      (snap) => setTheirIdentity(snap.exists() ? snap.data() : null),
      () => setTheirIdentity(null),
    );
  }, [theirUid]);

  const send = async () => {
    if (!text.trim() || !userId) return;
    try {
      await addDoc(collection(db, 'matchChats', matchId, 'messages'), {
        text: text.trim(), userId, userColor: user?.avatarColor, createdAt: Timestamp.now(),
      });
      setText('');
    } catch (err) {
      setChatError(`Couldn't send that. (${err?.code || 'unknown'}: ${err?.message || err})`);
    }
  };

  if (loading) return <div className="aura-page"><div className="aura-shell"><div className="aura-card">{t('loading')}</div></div></div>;

  const title = theirIdentity
    ? `${theirIdentity.displayName || 'Person ' + theirUid?.slice(0, 6)} • ${theirIdentity.age} • ${theirIdentity.gender}`
    : t('match_finder');

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar title={title} subtitle={t('start_chat')} onBack={() => navigate(-1)} />
        <div className="aura-card aura-section fade-in">
          <div className="message-list" data-testid="match-message-list">
            {messages.map((m) => (
              <div key={m.id} className={`message${m.userId === userId ? ' message--mine' : ''}`}>
                <div className="aura-row" style={{ gap: 8 }}><Avatar color={m.userColor} size={20} /><span className="message__meta">Person {m.userId?.slice(0, 6)}</span></div>
                <div className="message__bubble">{m.text}</div>
              </div>
            ))}
            {messages.length === 0 && <p className="aura-muted" style={{ textAlign: 'center', padding: '1.5rem' }}>{t('no_messages')}</p>}
          </div>
          {chatError && <p className="aura-login-error" style={{ margin: '10px 0 0' }} data-testid="match-chat-error">{chatError}</p>}
          <div className="aura-row">
            <input className="aura-input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder={t('type_message')} style={{ flex: '1 1 240px' }} data-testid="match-input" />
            <button type="button" onClick={send} disabled={!text.trim()} className="aura-btn aura-btn-primary" data-testid="match-send"><Send size={16} /> {t('send')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
