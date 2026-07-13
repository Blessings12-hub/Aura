import { useEffect, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  collection, addDoc, query, orderBy, Timestamp,
} from 'firebase/firestore';
import { Send } from 'lucide-react';
import { db } from '../firebase';
import { subscribe } from '../lib/subscribe';
import { useCurrentUser } from '../hooks/useCurrentUser';
import TopBar from '../components/TopBar';
import Avatar from '../components/Avatar';

export default function EventChat() {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const { state } = useLocation();
  const ev = state?.event;
  const { user, userId, loading } = useCurrentUser();
  const { t } = useTranslation();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [chatError, setChatError] = useState('');

  useEffect(() => {
    if (!eventId) return undefined;
    return subscribe(
      query(collection(db, 'eventChats', eventId, 'messages'), orderBy('createdAt', 'asc')),
      (s) => setMessages(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setChatError('Messages could not be loaded. Check your connection and try again.'),
      `event chat (${eventId})`,
    );
  }, [eventId]);

  const send = async () => {
    if (!text.trim() || !userId) return;
    try {
      await addDoc(collection(db, 'eventChats', eventId, 'messages'), {
        text: text.trim(), userId, userColor: user?.avatarColor, createdAt: Timestamp.now(),
      });
      setText('');
    } catch (err) {
      setChatError(`Couldn't send that. (${err?.code || 'unknown'}: ${err?.message || err})`);
    }
  };

  if (loading) return <div className="aura-page"><div className="aura-shell"><div className="aura-card">{t('loading')}</div></div></div>;

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar title={ev?.eventName || t('event_buddy')} subtitle={ev ? `${ev.date} • ${ev.time} • ${ev.place}` : ''} onBack={() => navigate(-1)} />
        <div className="aura-card aura-section fade-in">
          <div className="message-list" data-testid="event-messages">
            {messages.map((m) => (
              <div key={m.id} className={`message${m.userId === userId ? ' message--mine' : ''}`}>
                <div className="aura-row" style={{ gap: 8 }}>
                  <Avatar color={m.userColor} size={20} />
                  <span className="message__meta">Person {m.userId?.slice(0, 6)}</span>
                </div>
                <div className="message__bubble">{m.text}</div>
              </div>
            ))}
            {messages.length === 0 && <p className="aura-muted" style={{ textAlign: 'center', padding: '1.5rem' }}>{t('empty_no_messages')}</p>}
          </div>
          {chatError && <p className="aura-login-error" style={{ margin: '10px 0 0' }} data-testid="event-chat-error">{chatError}</p>}
          <div className="aura-row">
            <input className="aura-input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder={t('type_message')} style={{ flex: '1 1 240px' }} data-testid="event-chat-input" />
            <button type="button" onClick={send} disabled={!text.trim()} className="aura-btn aura-btn-primary" data-testid="event-chat-send"><Send size={16} /> {t('send')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
