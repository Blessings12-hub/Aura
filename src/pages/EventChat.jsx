import { useEffect, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  collection, addDoc, query, orderBy, onSnapshot, Timestamp,
} from 'firebase/firestore';
import { Send } from 'lucide-react';
import { db } from '../firebase';
import { useCurrentUser } from '../hooks/useCurrentUser';
import TopBar from '../components/TopBar';

export default function EventChat() {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const { state } = useLocation();
  const ev = state?.event;
  const { user, userId, loading } = useCurrentUser();
  const { t } = useTranslation();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');

  useEffect(() => {
    if (!eventId) return undefined;
    return onSnapshot(query(collection(db, 'eventChats', eventId, 'messages'), orderBy('createdAt', 'asc')),
      (s) => setMessages(s.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }, [eventId]);

  const send = async () => {
    if (!text.trim() || !userId) return;
    await addDoc(collection(db, 'eventChats', eventId, 'messages'), {
      text: text.trim(), userId, userColor: user?.avatarColor, createdAt: Timestamp.now(),
    });
    setText('');
  };

  return (
    <div className=\"aura-page\">
      <div className=\"aura-shell\">
        <TopBar title={ev?.eventName || t('event_buddy')} subtitle={ev ? `${ev.date} • ${ev.time} • ${ev.place}` : ''} onBack={() => navigate(-1)} />
        <div className=\"aura-card aura-section fade-in\">
          <div className=\"message-list\" data-testid=\"event-messages\">
            {messages.map((m) => (
              <div key={m.id} className={`message${m.userId === userId ? ' message--mine' : ''}`}>
                <div className=\"message__bubble\">{m.text}</div>
              </div>
            ))}
            {messages.length === 0 && <p className=\"aura-muted\" style={{ textAlign: 'center', padding: '1.5rem' }}>{t('empty_no_messages')}</p>}
          </div>
          <div className=\"aura-row\">
            <input className=\"aura-input\" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder={t('type_message')} style={{ flex: '1 1 240px' }} data-testid=\"event-chat-input\" />
            <button type=\"button\" onClick={send} disabled={!text.trim()} className=\"aura-btn aura-btn-primary\" data-testid=\"event-chat-send\"><Send size={16} /> {t('send')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}