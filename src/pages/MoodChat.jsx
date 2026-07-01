import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  collection, addDoc, query, orderBy, onSnapshot, Timestamp,
} from 'firebase/firestore';
import { ref as sref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Send, Mic, Square, Play } from 'lucide-react';
import { db, storage } from '../firebase';
import { MOODS } from '../constants/moods';
import { useCurrentUser } from '../hooks/useCurrentUser';
import TopBar from '../components/TopBar';
import Avatar from '../components/Avatar';
import { pushAuraNotification } from '../notifications/NotificationManager';

export default function MoodChat() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, userId, loading } = useCurrentUser();
  const [mood, setMood] = useState('');
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);
  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const listRef = useRef(null);
  const lastSeenRef = useRef(0);

  useEffect(() => {
    if (!mood) { setMessages([]); return undefined; }
    const q = query(collection(db, 'chats', mood, 'messages'), orderBy('createdAt', 'asc'));
    return onSnapshot(q, (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      // notify on incoming new messages from others
      const newOnes = all.slice(lastSeenRef.current);
      newOnes.forEach((m) => {
        if (m.userId !== userId && lastSeenRef.current > 0) {
          pushAuraNotification(`Aura • ${mood}`, m.text ? m.text.slice(0, 80) : t('voice_note'));
        }
      });
      lastSeenRef.current = all.length;
      setMessages(all);
      requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; });
    });
  }, [mood, userId, t]);

  const send = async () => {
    if (!text.trim() || !mood || !userId) return;
    await addDoc(collection(db, 'chats', mood, 'messages'), {
      type: 'text', text: text.trim(), userId,
      userAge: user?.age, userGender: user?.gender, userColor: user?.avatarColor,
      createdAt: Timestamp.now(),
    });
    setText('');
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach((tr) => tr.stop());
        try {
          const path = `voice/${mood}/${userId}-${Date.now()}.webm`;
          const r = sref(storage, path);
          await uploadBytes(r, blob);
          const url = await getDownloadURL(r);
          await addDoc(collection(db, 'chats', mood, 'messages'), {
            type: 'voice', voiceUrl: url, userId,
            userAge: user?.age, userGender: user?.gender, userColor: user?.avatarColor,
            createdAt: Timestamp.now(),
          });
        } catch (err) {
          console.error('voice upload failed', err);
          // fallback: store as a local data URL message
          const reader = new FileReader();
          reader.onload = async () => {
            await addDoc(collection(db, 'chats', mood, 'messages'), {
              type: 'voice', voiceUrl: reader.result, userId,
              userAge: user?.age, userGender: user?.gender, userColor: user?.avatarColor,
              createdAt: Timestamp.now(),
            });
          };
          reader.readAsDataURL(blob);
        }
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
    } catch (e) {
      console.error('mic permission failed', e);
      alert('Microphone permission is needed to send voice notes.');
    }
  };

  const stopRecording = () => {
    if (recRef.current) {
      recRef.current.stop();
      recRef.current = null;
    }
    setRecording(false);
  };

  if (loading || !user) return <div className=\"aura-page\"><div className=\"aura-shell\"><div className=\"aura-card\">{t('loading')}</div></div></div>;

  return (
    <div className=\"aura-page\">
      <div className=\"aura-shell\">
        <TopBar title={t('mood_chat')} subtitle={mood ? `${mood} • ${messages.length} ${t('online_now')}` : t('pick_a_mood')} onBack={() => navigate(-1)} />

        {!mood ? (
          <div className=\"aura-card aura-section fade-in\" data-testid=\"mood-picker\">
            <h2 className=\"aura-title\">{t('feeling_now')}</h2>
            <div className=\"aura-grid\" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
              {MOODS.map((m, i) => (
                <button
                  key={m.name}
                  type=\"button\"
                  onClick={() => setMood(m.name)}
                  className={`aura-btn aura-btn-primary fade-in delay-${Math.min(i, 3)}`}
                  data-testid={`mood-${m.name.toLowerCase()}`}
                  style={{ padding: '1.2rem', background: m.color, justifyContent: 'center' }}
                >{m.name}</button>
              ))}
            </div>
          </div>
        ) : (
          <div className=\"aura-card aura-section fade-in\" data-testid=\"mood-chat-room\">
            <div className=\"aura-row\" style={{ justifyContent: 'space-between' }}>
              <div className=\"chip\"><span className=\"dot dot--live\" /> {mood} • {t('online_now')}: {messages.length}</div>
              <button type=\"button\" onClick={() => setMood('')} className=\"aura-btn aura-btn-secondary aura-btn-pill\" data-testid=\"change-mood-btn\">{t('change_mood')}</button>
            </div>

            <div ref={listRef} className=\"message-list\" data-testid=\"message-list\" style={{ background: 'var(--surface-2)', borderRadius: 14, padding: 12, border: '1px solid var(--border)' }}>
              {messages.length === 0 ? (
                <p className=\"aura-muted\" style={{ textAlign: 'center', padding: '2rem' }}>{t('no_messages')}</p>
              ) : messages.map((m) => (
                <div key={m.id} className={`message${m.userId === userId ? ' message--mine' : ''}`} data-testid={`msg-${m.id}`}>
                  <div className=\"aura-row\" style={{ gap: 8 }}>
                    <Avatar color={m.userColor} size={24} />
                    <span className=\"message__meta\">Person {m.userId?.slice(0, 6)} • {m.userAge} • {m.userGender}</span>
                  </div>
                  <div className=\"message__bubble\">
                    {m.type === 'voice' && m.voiceUrl ? (
                      <audio controls src={m.voiceUrl} style={{ maxWidth: 240 }} />
                    ) : (
                      <span>{m.text}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className=\"aura-row\">
              <input
                type=\"text\"
                className=\"aura-input\"
                placeholder={t('type_message')}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
                style={{ flex: '1 1 240px' }}
                data-testid=\"message-input\"
              />
              {recording ? (
                <button type=\"button\" className=\"aura-btn aura-btn-danger\" onClick={stopRecording} data-testid=\"stop-record-btn\"><Square size={16} /> {t('recording')}</button>
              ) : (
                <button type=\"button\" className=\"aura-btn aura-btn-secondary\" onClick={startRecording} aria-label={t('send_voice_note')} data-testid=\"record-btn\"><Mic size={16} /></button>
              )}
              <button type=\"button\" className=\"aura-btn aura-btn-primary\" onClick={send} disabled={!text.trim()} data-testid=\"send-btn\"><Send size={16} /> {t('send')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}