import { useEffect, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  collection, doc, query, orderBy, Timestamp, writeBatch, serverTimestamp,
} from 'firebase/firestore';
import { Send } from 'lucide-react';
import { db } from '../firebase';
import { subscribe } from '../lib/subscribe';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useBlockedUsers } from '../hooks/useBlockedUsers';
import { useSendCooldown } from '../hooks/useSendCooldown';
import TopBar from '../components/TopBar';
import PageSkeleton from '../components/PageSkeleton';
import Avatar from '../components/Avatar';
import ReportBlockMenu from '../components/ReportBlockMenu';

const formatTime = (ts) => {
  const d = ts?.toDate?.();
  if (!d) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export default function EventChat() {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const { state } = useLocation();
  const ev = state?.event;
  const { user, userId, loading } = useCurrentUser();
  const blockedUsers = useBlockedUsers(userId);
  const { ready: sendReady, trigger: triggerCooldown } = useSendCooldown();
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

  // Same pattern as the other activities — bumps the SAME shared
  // users/{uid}.lastMessageAt field in the same atomic batch as the
  // message, which is what firestore.rules checks now.
  const send = async () => {
    if (!text.trim() || !userId || !sendReady) return;
    triggerCooldown();
    try {
      const batch = writeBatch(db);
      const msgRef = doc(collection(db, 'eventChats', eventId, 'messages'));
      batch.set(msgRef, { text: text.trim(), userId, userColor: user?.avatarColor, createdAt: Timestamp.now() });
      batch.update(doc(db, 'users', userId), { lastMessageAt: serverTimestamp() });
      await batch.commit();
      setText('');
    } catch (err) {
      setChatError(`Couldn't send that. (${err?.code || 'unknown'}: ${err?.message || err})`);
    }
  };

  if (loading) return <PageSkeleton />;

  const visibleMessages = messages.filter((m) => !blockedUsers.has(m.userId));

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar title={ev?.eventName || t('event_buddy')} subtitle={ev ? `${ev.date} • ${ev.time} • ${ev.place}` : ''} onBack={() => navigate(-1)} />
        <div className="aura-card chat-card fade-in">
          <div className="message-list" data-testid="event-messages">
            {visibleMessages.length === 0 && <p className="chat-empty-state">{t('empty_no_messages')}</p>}
            {visibleMessages.map((m) => (
              <div key={m.id} className={`message${m.userId === userId ? ' message--mine' : ''}`}>
                {m.userId !== userId && (
                  <div className="aura-row" style={{ gap: 8, justifyContent: 'space-between' }}>
                    <div className="aura-row" style={{ gap: 8 }}>
                      <Avatar color={m.userColor} size={20} />
                      <span className="message__meta">Person {m.userId?.slice(0, 6)}</span>
                    </div>
                    <ReportBlockMenu userId={userId} otherUserId={m.userId} blocked={blockedUsers.has(m.userId)} context="eventChat" contextId={eventId} compact />
                  </div>
                )}
                <div className="message__bubble">{m.text}</div>
                <span className="message__time">{formatTime(m.createdAt)}</span>
              </div>
            ))}
          </div>
          {chatError && <p className="chat-card__error aura-login-error" data-testid="event-chat-error">{chatError}</p>}
          <div className="chat-input-bar">
            <input className="aura-input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder={t('type_message')} maxLength={3000} style={{ flex: 1 }} data-testid="event-chat-input" />
            <button type="button" onClick={send} disabled={!text.trim() || !sendReady} className="aura-btn aura-btn-primary" aria-label={t('send')} data-testid="event-chat-send"><Send size={16} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
