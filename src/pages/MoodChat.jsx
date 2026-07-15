import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { collection, addDoc, query, orderBy, where, Timestamp, doc, onSnapshot } from 'firebase/firestore';
import { Send, Mic, Square } from 'lucide-react';
import { db } from '../firebase';
import { subscribe } from '../lib/subscribe';
import { MOODS } from '../constants/moods';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useBlockedUsers } from '../hooks/useBlockedUsers';
import { useSendCooldown } from '../hooks/useSendCooldown';
import { useRoomPresence } from '../hooks/useRoomPresence';
import TopBar from '../components/TopBar';
import PageSkeleton from '../components/PageSkeleton';
import Avatar from '../components/Avatar';
import ReportBlockMenu from '../components/ReportBlockMenu';
import { pushAuraNotification } from '../notifications/NotificationManager';
import { recordMoodActivity } from '../lib/moodActivity';
import { last24HoursTimestamp } from '../lib/rollingWindow';
import { todayKey } from '../constants/dailyQuestions';

// MediaRecorder's actual output codec depends entirely on what the browser
// supports — there is no universal default. The previous version hardcoded
// `new Blob(chunks, { type: 'audio/webm' })` regardless of what was really
// recorded, which silently mislabels the file on any browser that doesn't
// use webm/opus (notably Safari/iOS, which records audio/mp4). A mislabeled
// blob uploads fine but then fails to play back, because the browser trusts
// the declared type over the actual bytes. This picks the first type the
// browser actually supports and uses that same type consistently for the
// recorder, the blob, and the upload's Content-Type metadata.
const VOICE_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];
function pickSupportedMimeType() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  return VOICE_MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}
// Voice notes are stored directly inside the Firestore message document as
// base64 (no Firebase Storage — Storage now requires the paid Blaze plan
// even for free-tier usage as of Feb 2026, so it's off the table on Spark).
// Firestore hard-caps a document at 1MB, and base64 inflates raw audio by
// ~33%, so recording length needs a real ceiling rather than hoping it
// stays small. 60s is generous for a chat voice note and stays comfortably
// under the limit for every codec in VOICE_MIME_CANDIDATES.
const MAX_RECORDING_SECONDS = 60;

export default function MoodChat() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, userId, loading } = useCurrentUser();
  const blockedUsers = useBlockedUsers(userId);
  const { ready: sendReady, trigger: triggerCooldown } = useSendCooldown();
  const [mood, setMood] = useState('');
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [micError, setMicError] = useState('');
  const [chatError, setChatError] = useState('');
  const [moodActivityToday, setMoodActivityToday] = useState({});
  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const mimeRef = useRef('');
  const recTimerRef = useRef(null);
  const listRef = useRef(null);
  const lastSeenRef = useRef(0);

  // Genuine "who's actually in this room right now" — replaces the old
  // (incorrect) display of messages.length as if it were an online count.
  // Server-enforced via RTDB onDisconnect, so it stays accurate even if
  // someone's tab crashes rather than closes cleanly.
  const { count: onlineCount, error: presenceError } = useRoomPresence(
    mood ? `mood-${mood}` : null,
    userId,
    { color: user?.avatarColor },
  );

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'moodActivity', todayKey()),
      (snap) => setMoodActivityToday(snap.exists() ? snap.data() : {}),
      (err) => console.error('moodActivity read failed', err),
    );
    return unsub;
  }, []);

  useEffect(() => {
    if (!mood) { setMessages([]); lastSeenRef.current = 0; return undefined; }
    setChatError('');
    const q = query(
      collection(db, 'chats', mood, 'messages'),
      where('createdAt', '>=', last24HoursTimestamp()),
      orderBy('createdAt', 'asc'),
    );
    return subscribe(q, (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const newOnes = all.slice(lastSeenRef.current);
      newOnes.forEach((m) => {
        if (m.userId !== userId && lastSeenRef.current > 0) {
          pushAuraNotification(`Aura • ${mood}`, m.text ? m.text.slice(0, 80) : t('voice_note'));
        }
      });
      lastSeenRef.current = all.length;
      setMessages(all);
      requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; });
    }, () => setChatError('Messages could not be loaded. Check your connection and try reopening this mood.'), `mood chat (${mood})`);
  }, [mood, userId, t]);

  useEffect(() => () => clearInterval(recTimerRef.current), []);

  const send = async () => {
    if (!text.trim() || !mood || !userId || !sendReady) return;
    triggerCooldown();
    try {
      await addDoc(collection(db, 'chats', mood, 'messages'), {
        type: 'text', text: text.trim(), userId,
        userAge: user?.age, userGender: user?.gender, userColor: user?.avatarColor,
        createdAt: Timestamp.now(),
      });
      setText('');
      recordMoodActivity(mood);
    } catch (err) {
      setChatError(`Couldn't send that. (${err?.code || 'unknown'}: ${err?.message || err})`);
    }
  };

  const startRecording = async () => {
    setMicError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickSupportedMimeType();
      mimeRef.current = mimeType;
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        clearInterval(recTimerRef.current);
        setRecordSeconds(0);
        const actualType = rec.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: actualType });
        stream.getTracks().forEach((tr) => tr.stop());

        // Belt-and-suspenders: the 60s auto-stop should already keep this
        // under the limit, but codecs/bitrates vary by browser, so check
        // for real rather than assume the timer alone was enough.
        if (blob.size > 700 * 1024) {
          setMicError('That recording was too long to send — try one under a minute.');
          return;
        }
        try {
          const reader = new FileReader();
          const dataUrl = await new Promise((resolve, reject) => {
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
          await addDoc(collection(db, 'chats', mood, 'messages'), {
            type: 'voice', voiceUrl: dataUrl, voiceMime: actualType, userId,
            userAge: user?.age, userGender: user?.gender, userColor: user?.avatarColor,
            createdAt: Timestamp.now(),
          });
          recordMoodActivity(mood);
        } catch (err) {
          setMicError(`Couldn't send that voice note. (${err?.code || 'unknown'}: ${err?.message || err})`);
        }
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
      setRecordSeconds(0);
      recTimerRef.current = setInterval(() => {
        setRecordSeconds((s) => {
          if (s + 1 >= MAX_RECORDING_SECONDS) {
            stopRecording();
            return MAX_RECORDING_SECONDS;
          }
          return s + 1;
        });
      }, 1000);
    } catch (e) {
      console.error('mic permission failed', e);
      setMicError('Microphone access was blocked or unavailable. Check your browser/site permissions and try again.');
    }
  };

  const stopRecording = () => {
    clearInterval(recTimerRef.current);
    if (recRef.current) {
      recRef.current.stop();
      recRef.current = null;
    }
    setRecording(false);
  };

  if (loading || !user) return <PageSkeleton />;

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar title={t('mood_chat')} subtitle={mood ? `${mood} • ${presenceError ? t('presence_unavailable') : `${onlineCount} ${t('online_now')}`}` : t('pick_a_mood')} onBack={() => navigate(-1)} />

        {!mood ? (
          <div className="aura-card aura-section fade-in" data-testid="mood-picker">
            <h2 className="aura-title">{t('feeling_now')}</h2>
            <div className="aura-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
              {MOODS.map((m, i) => {
                const count = moodActivityToday[m.name] || 0;
                return (
                  <button
                    key={m.name}
                    type="button"
                    onClick={() => setMood(m.name)}
                    className={`aura-btn aura-btn-primary fade-in delay-${Math.min(i, 3)}`}
                    data-testid={`mood-${m.name.toLowerCase()}`}
                    style={{ padding: '1.2rem', background: m.color, justifyContent: 'center', flexDirection: 'column', gap: 4 }}
                  >
                    <span>{m.name}</span>
                    {count > 0 && (
                      <span style={{ fontSize: '0.72rem', fontWeight: 500, opacity: 0.85 }} data-testid={`mood-activity-${m.name.toLowerCase()}`}>
                        {count} {count === 1 ? 'message' : 'messages'} today
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="aura-card aura-section fade-in" data-testid="mood-chat-room">
            <div className="aura-row" style={{ justifyContent: 'space-between' }}>
              <div className="chip"><span className="dot dot--live" /> {mood} • {t('online_now')}: {presenceError ? '—' : onlineCount}</div>
              {presenceError && (
                <p className="aura-muted" style={{ fontSize: '0.78rem', margin: '4px 0 0' }} data-testid="presence-error">
                  {t('presence_unavailable')}
                </p>
              )}
              <button type="button" onClick={() => setMood('')} className="aura-btn aura-btn-secondary aura-btn-pill" data-testid="change-mood-btn">{t('change_mood')}</button>
            </div>

            <div ref={listRef} className="message-list" data-testid="message-list" style={{ background: 'var(--surface-2)', borderRadius: 14, padding: 12, border: '1px solid var(--border)' }}>
              {messages.filter((m) => !blockedUsers.has(m.userId)).length === 0 ? (
                <p className="aura-muted" style={{ textAlign: 'center', padding: '2rem' }}>{t('no_messages')}</p>
              ) : messages.filter((m) => !blockedUsers.has(m.userId)).map((m) => (
                <div key={m.id} className={`message${m.userId === userId ? ' message--mine' : ''}`} data-testid={`msg-${m.id}`}>
                  <div className="aura-row" style={{ gap: 8, justifyContent: 'space-between' }}>
                    <div className="aura-row" style={{ gap: 8 }}>
                      <Avatar color={m.userColor} size={24} />
                      <span className="message__meta">Person {m.userId?.slice(0, 6)} • {m.userAge} • {m.userGender}</span>
                    </div>
                    {m.userId !== userId && (
                      <ReportBlockMenu userId={userId} otherUserId={m.userId} blocked={blockedUsers.has(m.userId)} context="moodChat" contextId={mood} compact />
                    )}
                  </div>
                  <div className="message__bubble">
                    {m.type === 'voice' && m.voiceUrl ? (
                      <audio controls src={m.voiceUrl} style={{ maxWidth: 240 }} />
                    ) : (
                      <span>{m.text}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {chatError && <p className="aura-login-error" style={{ margin: '10px 0 0' }} data-testid="chat-error">{chatError}</p>}
            {micError && <p className="aura-login-error" style={{ margin: '10px 0 0' }}>{micError}</p>}

            <div className="aura-row">
              <input
                type="text"
                className="aura-input"
                placeholder={t('type_message')}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
                maxLength={3000}
                style={{ flex: '1 1 240px' }}
                data-testid="message-input"
              />
              {recording ? (
                <button type="button" className="aura-btn aura-btn-danger" onClick={stopRecording} data-testid="stop-record-btn"><Square size={16} /> {t('recording')} · {Math.max(0, MAX_RECORDING_SECONDS - recordSeconds)}s</button>
              ) : (
                <button type="button" className="aura-btn aura-btn-secondary" onClick={startRecording} aria-label={t('send_voice_note')} data-testid="record-btn"><Mic size={16} /></button>
              )}
              <button type="button" className="aura-btn aura-btn-primary" onClick={send} disabled={!text.trim() || !sendReady} data-testid="send-btn"><Send size={16} /> {t('send')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
