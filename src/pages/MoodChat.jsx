import {
  useCallback, useEffect, useRef, useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  collection, addDoc, query, orderBy, where, Timestamp, doc, deleteDoc,
  onSnapshot, writeBatch, limit,
} from '../lib/appwriteFirestoreCompat';
import {
  Send, Mic, Square, Reply, Trash2, Sticker as StickerIcon, X,
} from 'lucide-react';
import { db } from '../firebase';
import { subscribe } from '../lib/subscribe';
import { MOODS } from '../constants/moods';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useBlockedUsers } from '../hooks/useBlockedUsers';
import { useSendCooldown } from '../hooks/useSendCooldown';
import { useRoomPresence } from '../hooks/useRoomPresence';
import {
  pickSupportedVoiceMimeType, MAX_RECORDING_SECONDS, uploadVoiceNote,
} from '../lib/chatMedia';
import TopBar from '../components/TopBar';
import PageSkeleton from '../components/PageSkeleton';
import Avatar from '../components/Avatar';
import ReportBlockMenu from '../components/ReportBlockMenu';
import StickerPicker from '../components/StickerPicker';
import { pushAuraNotification } from '../notifications/NotificationManager';
import { recordMoodActivity } from '../lib/moodActivity';
import { last24HoursTimestamp } from '../lib/rollingWindow';
import { moderateText, MODERATION_MESSAGES } from '../lib/contentFilter';
import { todayKey } from '../constants/dailyQuestions';

// The room is already bounded to a rolling 24h window (see
// last24HoursTimestamp), which self-prunes day to day — but a single busy
// day could still mean thousands of messages downloaded and live-subscribed
// to in one shot on first paint. This caps the LIVE view to the most recent
// N messages within that window; anything older than that just isn't shown
// (no "load more" yet — this is a safety cap, not full pagination).
const LIVE_MESSAGE_LIMIT = 150;

// Short one-line preview used for reply quotes — same shape as the other
// chats' buildPreview() (Match Chat, Skill Swap Chat, Event Chat).
const buildPreview = (m, t) => {
  if (!m) return '';
  if (m.type === 'voice') return `🎤 ${t('voice_note')}`;
  if (m.type === 'sticker') return '🖼️ Sticker';
  const text = (m.text || '').trim();
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
};

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
  const [showStickerPicker, setShowStickerPicker] = useState(false);
  const [lightbox, setLightbox] = useState(null); // { url, mime } | null

  // Long-press message actions (reply / delete-your-own) and swipe-to-reply.
  const [actionsFor, setActionsFor] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);

  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const recTimerRef = useRef(null);
  const listRef = useRef(null);
  // Was a positional counter (lastSeenRef = index up to which messages had
  // been "seen"), which only worked because the old query had no limit()
  // and could only ever grow by appending at the end. Once the query below
  // caps the live window, an old message can drop OUT of the results when
  // a new one arrives — so "new" now has to mean "id we haven't seen
  // before", not "past this index".
  const seenIdsRef = useRef(new Set());
  const initializedRef = useRef(false);
  const longPressTimerRef = useRef(null);
  const openedAtRef = useRef(0);
  const messageElsRef = useRef({});
  const bubbleElsRef = useRef({});
  const dragStateRef = useRef(null);

  // Genuine "who's actually in this room right now" — server-enforced via
  // RTDB onDisconnect, so it stays accurate even if someone's tab crashes
  // rather than closes cleanly.
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
    if (!mood) { setMessages([]); seenIdsRef.current = new Set(); initializedRef.current = false; return undefined; }
    setChatError('');
    // orderBy(desc) + limit() gives a live "most recent N" window — as a
    // new message arrives, the oldest one in view drops out once the cap
    // is exceeded. Reversed below so the UI still renders oldest-first.
    const q = query(
      collection(db, 'chats', mood, 'messages'),
      where('createdAt', '>=', last24HoursTimestamp()),
      orderBy('createdAt', 'desc'),
      limit(LIVE_MESSAGE_LIMIT),
    );
    return subscribe(q, (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() })).reverse();
      if (!initializedRef.current) {
        // First load for this mood — record what's already here, but
        // don't notify for any of it (matches the old lastSeenRef.current
        // > 0 guard's intent exactly).
        seenIdsRef.current = new Set(all.map((m) => m.id));
        initializedRef.current = true;
      } else {
        const newOnes = all.filter((m) => !seenIdsRef.current.has(m.id));
        newOnes.forEach((m) => {
          if (m.userId !== userId) {
            pushAuraNotification(`Aura • ${mood}`, m.text ? m.text.slice(0, 80) : t('voice_note'));
          }
        });
        seenIdsRef.current = new Set(all.map((m) => m.id));
      }
      setMessages(all);
      requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; });
    }, () => setChatError('Messages could not be loaded. Check your connection and try reopening this mood.'), `mood chat (${mood})`);
  }, [mood, userId, t]);

  useEffect(() => () => { clearInterval(recTimerRef.current); clearTimeout(longPressTimerRef.current); }, []);

  // --- Group delivered/seen receipts ------------------------------------
  // A mood room can have many people in it at once, so this isn't the
  // single delivered/seen boolean Match Chat uses for a 1:1 thread — it's
  // a small map of who has received/seen each message (deliveredBy/seenBy,
  // keyed by uid). "Delivered" is stamped the moment a message reaches my
  // snapshot listener; "seen" only while this tab is actually visible and
  // focused, same distinction Match Chat makes.
  const markReceipts = useCallback(() => {
    if (!mood || !userId) return;
    const isVisible = typeof document !== 'undefined' && document.visibilityState === 'visible';
    const pending = messages.filter((m) => m.userId && m.userId !== userId
      && (!m.deliveredBy?.[userId] || (isVisible && !m.seenBy?.[userId])));
    if (!pending.length) return;
    const batch = writeBatch(db);
    pending.forEach((m) => {
      const patch = {};
      if (!m.deliveredBy?.[userId]) patch[`deliveredBy.${userId}`] = true;
      if (isVisible && !m.seenBy?.[userId]) patch[`seenBy.${userId}`] = true;
      if (Object.keys(patch).length) batch.update(doc(db, 'chats', mood, 'messages', m.id), patch);
    });
    batch.commit().catch((err) => console.error('Could not update read receipts:', err));
  }, [messages, mood, userId]);

  useEffect(() => { markReceipts(); }, [markReceipts]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') markReceipts(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [markReceipts]);

  // --- Long-press (reply/delete) + swipe-left/right (reply) -------------
  // Same long-press timing/jitter-tolerance as Match Chat, extended so a
  // horizontal drag is recognised as its own gesture (swipe-to-reply)
  // rather than just cancelling the long press. The two are mutually
  // exclusive per-gesture: whichever direction the finger commits to first
  // (mostly horizontal vs. barely moving) wins.
  const LONG_PRESS_MS = 450;
  const AXIS_LOCK_PX = 10;
  const REPLY_TRIGGER_PX = 56;
  const REPLY_MAX_PX = 84;

  const resetBubbleTransform = (id, animate) => {
    const el = bubbleElsRef.current[id];
    if (!el) return;
    if (animate) {
      el.style.transition = 'transform 180ms ease';
      el.style.transform = 'translateX(0px)';
      setTimeout(() => { if (el) el.style.transition = ''; }, 200);
    } else {
      el.style.transition = '';
      el.style.transform = 'translateX(0px)';
    }
  };

  const cancelLongPress = () => clearTimeout(longPressTimerRef.current);

  const startPress = (m, e) => {
    clearTimeout(longPressTimerRef.current);
    dragStateRef.current = {
      id: m.id, startX: e.clientX, startY: e.clientY, axisLocked: null, dx: 0,
    };
    longPressTimerRef.current = setTimeout(() => {
      if (dragStateRef.current?.axisLocked === 'x') return; // mid-swipe, not a long-press
      if (navigator.vibrate) navigator.vibrate(10);
      openedAtRef.current = Date.now();
      setActionsFor(m);
    }, LONG_PRESS_MS);
  };

  const movePress = (m, e) => {
    const ds = dragStateRef.current;
    if (!ds || ds.id !== m.id) return;
    const dx = e.clientX - ds.startX;
    const dy = e.clientY - ds.startY;
    if (!ds.axisLocked) {
      if (Math.abs(dx) > AXIS_LOCK_PX || Math.abs(dy) > AXIS_LOCK_PX) {
        ds.axisLocked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        cancelLongPress();
      }
    }
    if (ds.axisLocked === 'x') {
      const clamped = Math.max(-REPLY_MAX_PX, Math.min(REPLY_MAX_PX, dx));
      ds.dx = clamped;
      const el = bubbleElsRef.current[m.id];
      if (el) { el.style.transition = ''; el.style.transform = `translateX(${clamped}px)`; }
    }
  };

  const endPress = (m) => {
    cancelLongPress();
    const ds = dragStateRef.current;
    dragStateRef.current = null;
    if (!ds || ds.id !== m.id) return;
    if (ds.axisLocked === 'x') {
      resetBubbleTransform(m.id, true);
      if (Math.abs(ds.dx) >= REPLY_TRIGGER_PX) {
        if (navigator.vibrate) navigator.vibrate(8);
        setReplyingTo(m);
      }
    }
  };

  const cancelPress = (m) => {
    cancelLongPress();
    dragStateRef.current = null;
    resetBubbleTransform(m.id, true);
  };

  const openActionsViaContextMenu = (e, m) => {
    e.preventDefault();
    openedAtRef.current = Date.now();
    setActionsFor(m);
  };
  const closeActions = () => {
    if (Date.now() - openedAtRef.current < 400) return;
    setActionsFor(null);
  };

  const scrollToMessage = (id) => {
    const el = messageElsRef.current[id];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('message--flash');
    setTimeout(() => el.classList.remove('message--flash'), 1200);
  };

  const handleReply = (m) => { setReplyingTo(m); setActionsFor(null); };

  const handleDelete = async (m) => {
    setActionsFor(null);
    // eslint-disable-next-line no-alert
    if (!window.confirm(t('delete_message_confirm'))) return;
    try {
      await deleteDoc(doc(db, 'chats', mood, 'messages', m.id));
    } catch (err) {
      setChatError(`Couldn't delete that message. (${err?.code || 'unknown'}: ${err?.message || err})`);
    }
  };

  // Denormalized reply-quote metadata, kept as a small preview snapshot
  // (not a live reference) so it still renders correctly even if the
  // original message is later deleted.
  const replyToField = () => (replyingTo
    ? { replyTo: { id: replyingTo.id, userId: replyingTo.userId, preview: buildPreview(replyingTo, t) } }
    : {});

  // Was a batched write bumping users/{uid}.lastMessageAt alongside the
  // message, to pair with a server-enforced cooldown in firestore.rules.
  // That rule was removed after repeatedly causing real send failures in
  // practice — see the comment in firestore.rules above where those
  // functions used to live for the full reasoning. This is back to a
  // plain write; useSendCooldown() below (a debounce on the send button)
  // is the only cooldown left, same as before that experiment.
  const sendWithCooldownBump = async (payload) => {
    await addDoc(collection(db, 'chats', mood, 'messages'), payload);
  };

  const send = async () => {
    if (!text.trim() || !mood || !userId || !sendReady) return;
    const moderationReason = moderateText(text);
    if (moderationReason) {
      setChatError(MODERATION_MESSAGES[moderationReason]);
      return;
    }
    triggerCooldown();
    try {
      await sendWithCooldownBump({
        type: 'text', text: text.trim(), userId,
        userAge: user?.age, userGender: user?.gender, userColor: user?.avatarColor,
        createdAt: Timestamp.now(),
        ...replyToField(),
      });
      setText('');
      setReplyingTo(null);
      recordMoodActivity(mood);
    } catch (err) {
      setChatError(`Couldn't send that. (${err?.code || 'unknown'}: ${err?.message || err})`);
    }
  };

  const handleSendSticker = async (sticker) => {
    setShowStickerPicker(false);
    if (!mood || !userId) return;
    try {
      await sendWithCooldownBump({
        type: 'sticker', fileUrl: sticker.dataUrl, fileMime: sticker.mime || 'image/png', userId,
        userAge: user?.age, userGender: user?.gender, userColor: user?.avatarColor,
        createdAt: Timestamp.now(),
        ...replyToField(),
      });
      setReplyingTo(null);
      recordMoodActivity(mood);
    } catch (err) {
      setChatError(`Couldn't send that sticker. (${err?.code || 'unknown'}: ${err?.message || err})`);
    }
  };

  const startRecording = async () => {
    setMicError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickSupportedVoiceMimeType();
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        clearInterval(recTimerRef.current);
        setRecordSeconds(0);
        const actualType = rec.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: actualType });
        stream.getTracks().forEach((tr) => tr.stop());

        try {
          const voiceUrl = await uploadVoiceNote(blob, actualType, userId);
          await sendWithCooldownBump({
            type: 'voice', voiceUrl, voiceMime: actualType, userId,
            userAge: user?.age, userGender: user?.gender, userColor: user?.avatarColor,
            createdAt: Timestamp.now(),
            ...replyToField(),
          });
          setReplyingTo(null);
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

  const visibleMessages = messages.filter((m) => !blockedUsers.has(m.userId));
  const lastMineId = [...visibleMessages].reverse().find((m) => m.userId === userId)?.id;
  const messagesToday = moodActivityToday[mood] || 0;

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
          <div className="fade-in" data-testid="mood-chat-room">
            <div className="aura-row" style={{ justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
              <div className="chip"><span className="dot dot--live" /> {mood} • {t('online_now')}: {presenceError ? '—' : onlineCount}</div>
              <div className="chip" data-testid="messages-today-chip">{t('messages_today_count', { count: messagesToday })}</div>
              <button type="button" onClick={() => setMood('')} className="aura-btn aura-btn-secondary aura-btn-pill" data-testid="change-mood-btn">{t('change_mood')}</button>
            </div>
            {presenceError && (
              <p className="aura-muted" style={{ fontSize: '0.78rem', margin: '0 0 8px' }} data-testid="presence-error">
                {t('presence_unavailable')}
              </p>
            )}

            <div className="aura-card chat-card fade-in">
              <div ref={listRef} className="message-list" data-testid="message-list">
                {visibleMessages.length === 0 ? (
                  <p className="chat-empty-state">{t('no_messages')}</p>
                ) : visibleMessages.map((m) => (
                  <div
                    key={m.id}
                    ref={(el) => { messageElsRef.current[m.id] = el; }}
                    className={`message${m.userId === userId ? ' message--mine' : ''}${m.type === 'sticker' ? ' message--sticker' : ''}`}
                    onPointerDown={(e) => startPress(m, e)}
                    onPointerMove={(e) => movePress(m, e)}
                    onPointerUp={() => endPress(m)}
                    onPointerCancel={() => cancelPress(m)}
                    onContextMenu={(e) => openActionsViaContextMenu(e, m)}
                    data-testid={`msg-${m.id}`}
                  >
                    <div className="aura-row" style={{ gap: 8, justifyContent: 'space-between' }}>
                      <div className="aura-row" style={{ gap: 8 }}>
                        <Avatar color={m.userColor} size={24} />
                        <span className="message__meta">Person {m.userId?.slice(0, 6)} • {m.userAge} • {m.userGender}</span>
                      </div>
                      {m.userId !== userId && (
                        <ReportBlockMenu userId={userId} otherUserId={m.userId} blocked={blockedUsers.has(m.userId)} context="moodChat" contextId={mood} compact />
                      )}
                    </div>
                    <div className="message__bubble" ref={(el) => { bubbleElsRef.current[m.id] = el; }}>
                      {m.replyTo && (
                        <button
                          type="button"
                          className="message__reply-quote"
                          onClick={(e) => { e.stopPropagation(); scrollToMessage(m.replyTo.id); }}
                          data-testid={`reply-quote-${m.id}`}
                        >
                          <span className="message__reply-quote__name">{m.replyTo.userId === userId ? t('you') : `Person ${m.replyTo.userId?.slice(0, 6)}`}</span>
                          <span className="message__reply-quote__text">{m.replyTo.preview}</span>
                        </button>
                      )}
                      {m.type === 'voice' && m.voiceUrl ? (
                        <audio controls src={m.voiceUrl} style={{ maxWidth: 240 }} data-testid={`voice-msg-${m.id}`} />
                      ) : m.type === 'sticker' && m.fileUrl ? (
                        <button type="button" className="message__sticker-btn" onClick={() => setLightbox({ url: m.fileUrl, mime: m.fileMime })} data-testid={`sticker-msg-${m.id}`}>
                          {m.fileMime?.startsWith('video/') ? (
                            <video src={m.fileUrl} className="message__sticker" muted autoPlay loop playsInline />
                          ) : (
                            <img src={m.fileUrl} alt="Sticker" className="message__sticker" />
                          )}
                        </button>
                      ) : (
                        <span>{m.text}</span>
                      )}
                    </div>
                    {m.userId === userId && m.id === lastMineId && (Object.keys(m.deliveredBy || {}).length > 0 || Object.keys(m.seenBy || {}).length > 0) && (
                      <span className="message__receipt-label" data-testid="last-message-receipt-label">
                        {t('delivered_to', { count: Object.keys(m.deliveredBy || {}).length })}
                        {Object.keys(m.seenBy || {}).length > 0 && ` • ${t('seen_by', { count: Object.keys(m.seenBy || {}).length })}`}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {chatError && <p className="chat-card__error aura-login-error" data-testid="chat-error">{chatError}</p>}
              {micError && <p className="chat-card__error aura-login-error">{micError}</p>}
              {replyingTo && (
                <div className="reply-preview" data-testid="reply-preview-bar">
                  <div className="reply-preview__body">
                    <span className="reply-preview__name">{replyingTo.userId === userId ? t('you') : `Person ${replyingTo.userId?.slice(0, 6)}`}</span>
                    <span className="reply-preview__text">{buildPreview(replyingTo, t)}</span>
                  </div>
                  <button type="button" onClick={() => setReplyingTo(null)} className="aura-btn aura-btn-secondary aura-btn-pill" aria-label={t('cancel_reply')} data-testid="cancel-reply-btn">
                    <X size={14} />
                  </button>
                </div>
              )}

              <div className="chat-input-bar">
                <button
                  type="button"
                  onClick={() => setShowStickerPicker(true)}
                  disabled={recording}
                  className="aura-btn aura-btn-secondary"
                  aria-label={t('send_sticker')}
                  data-testid="mood-sticker-btn"
                >
                  <StickerIcon size={16} />
                </button>
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
                  <button type="button" className="aura-btn aura-btn-danger" onClick={stopRecording} data-testid="stop-record-btn"><Square size={16} /> {Math.max(0, MAX_RECORDING_SECONDS - recordSeconds)}s</button>
                ) : (
                  <button type="button" className="aura-btn aura-btn-secondary" onClick={startRecording} disabled={!!text.trim()} aria-label={t('send_voice_note')} data-testid="record-btn"><Mic size={16} /></button>
                )}
                <button type="button" className="aura-btn aura-btn-primary" onClick={send} disabled={!text.trim() || !sendReady} data-testid="send-btn"><Send size={16} /></button>
              </div>
            </div>
          </div>
        )}
      </div>

      {showStickerPicker && (
        <StickerPicker userId={userId} onSelect={handleSendSticker} onClose={() => setShowStickerPicker(false)} />
      )}

      {lightbox && (
        <div className="aura-modal-backdrop" onClick={() => setLightbox(null)} data-testid="image-lightbox">
          <button type="button" className="aura-btn aura-btn-secondary aura-btn-pill image-lightbox__close" onClick={() => setLightbox(null)} aria-label={t('close')}>
            <X size={16} />
          </button>
          {lightbox.mime?.startsWith('video/') ? (
            <video src={lightbox.url} className="image-lightbox__img" controls autoPlay loop onClick={(e) => e.stopPropagation()} />
          ) : (
            <img src={lightbox.url} alt="" className="image-lightbox__img" onClick={(e) => e.stopPropagation()} />
          )}
        </div>
      )}

      {actionsFor && (
        <div className="aura-modal-backdrop message-actions-backdrop" onClick={closeActions} data-testid="message-actions-sheet">
          <div className="message-actions-sheet" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="message-actions-sheet__item" onClick={() => handleReply(actionsFor)} data-testid="action-reply">
              <Reply size={16} /> {t('reply')}
            </button>
            {actionsFor.userId === userId && (
              <button type="button" className="message-actions-sheet__item message-actions-sheet__item--danger" onClick={() => handleDelete(actionsFor)} data-testid="action-delete">
                <Trash2 size={16} /> {t('delete_message')}
              </button>
            )}
            <button type="button" className="message-actions-sheet__item message-actions-sheet__item--cancel" onClick={() => setActionsFor(null)} data-testid="action-cancel">
              {t('cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
