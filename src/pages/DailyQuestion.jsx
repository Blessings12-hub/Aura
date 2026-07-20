import {
  useCallback, useEffect, useRef, useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  collection, addDoc, query, orderBy, Timestamp, doc, deleteDoc,
  onSnapshot, writeBatch, updateDoc, deleteField,
} from 'firebase/firestore';
import {
  Send, Mic, Square, Reply, Trash2, Sticker as StickerIcon, X, Heart,
} from 'lucide-react';
import { db } from '../firebase';
import { subscribe } from '../lib/subscribe';
import {
  DAILY_QUESTIONS, questionForDate, todayKey,
} from '../constants/dailyQuestions';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useBlockedUsers } from '../hooks/useBlockedUsers';
import { useSendCooldown } from '../hooks/useSendCooldown';
import { useRoomPresence } from '../hooks/useRoomPresence';
import {
  pickSupportedVoiceMimeType, MAX_RECORDING_SECONDS, MAX_DATA_URL_CHARS,
} from '../lib/chatMedia';
import TopBar from '../components/TopBar';
import PageSkeleton from '../components/PageSkeleton';
import Avatar from '../components/Avatar';
import ReportBlockMenu from '../components/ReportBlockMenu';
import StickerPicker from '../components/StickerPicker';
import { pushAuraNotification } from '../notifications/NotificationManager';
import { recordDailyAnswerStreak } from '../lib/streak';
import { moderateText, MODERATION_MESSAGES } from '../lib/contentFilter';

// Short one-line preview used for reply quotes — same shape as Mood Chat's
// buildPreview() (and Match/Skill Swap/Event Chat).
const buildPreview = (m, t) => {
  if (!m) return '';
  if (m.type === 'voice') return `🎤 ${t('voice_note')}`;
  if (m.type === 'sticker') return '🖼️ Sticker';
  const text = (m.text || '').trim();
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
};

// Same live-room pattern as Mood Chat, applied to the day's question: this
// used to be a "post once, see a static grid of everyone's answers" page.
// Now clicking the activity drops you straight into a group chat scoped to
// today's question, with real-time messages — including voice notes,
// stickers, replies, delivered/seen receipts and long-press actions, all
// exactly like Mood Chat — instead of a one-shot answer list.
export default function DailyQuestion() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, userId, loading } = useCurrentUser();
  const blockedUsers = useBlockedUsers(userId);
  const { ready: sendReady, trigger: triggerCooldown } = useSendCooldown();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [micError, setMicError] = useState('');
  const [chatError, setChatError] = useState('');
  const [showStickerPicker, setShowStickerPicker] = useState(false);
  const [lightbox, setLightbox] = useState(null); // { url, mime } | null

  // Long-press message actions (reply / delete-your-own) and swipe-to-reply.
  const [actionsFor, setActionsFor] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);

  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const recTimerRef = useRef(null);
  const listRef = useRef(null);
  const lastSeenRef = useRef(0);
  const longPressTimerRef = useRef(null);
  const openedAtRef = useRef(0);
  const messageElsRef = useRef({});
  const bubbleElsRef = useRef({});
  const dragStateRef = useRef(null);

  const day = todayKey();
  const question = questionForDate();
  const questionIndex = Math.max(DAILY_QUESTIONS.indexOf(question), 0);

  // Genuine "who's actually in this room right now" — server-enforced via
  // RTDB onDisconnect, same as Mood Chat.
  const { count: onlineCount, error: presenceError } = useRoomPresence(
    `daily-${day}`,
    userId,
    { color: user?.avatarColor },
  );

  useEffect(() => {
    setChatError('');
    const q = query(
      collection(db, 'dailyQuestions', day, 'answers'),
      orderBy('createdAt', 'asc'),
    );
    return subscribe(q, (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const newOnes = all.slice(lastSeenRef.current);
      newOnes.forEach((m) => {
        if (m.userId !== userId && lastSeenRef.current > 0) {
          pushAuraNotification(`Aura • ${t('daily_question')}`, m.text ? m.text.slice(0, 80) : t('voice_note'));
        }
      });
      lastSeenRef.current = all.length;
      setMessages(all);
      requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; });
    }, () => setChatError('Answers could not be loaded. Check your connection and try again.'), `daily question (${day})`);
  }, [day, userId, t]);

  useEffect(() => () => { clearInterval(recTimerRef.current); clearTimeout(longPressTimerRef.current); }, []);

  // --- Group delivered/seen receipts ------------------------------------
  // Same deliveredBy/seenBy map pattern as Mood Chat — a daily question
  // room can have many people in it at once, so this isn't a single
  // delivered/seen boolean.
  const markReceipts = useCallback(() => {
    if (!userId) return;
    const isVisible = typeof document !== 'undefined' && document.visibilityState === 'visible';
    const pending = messages.filter((m) => m.userId && m.userId !== userId
      && (!m.deliveredBy?.[userId] || (isVisible && !m.seenBy?.[userId])));
    if (!pending.length) return;
    const batch = writeBatch(db);
    pending.forEach((m) => {
      const patch = {};
      if (!m.deliveredBy?.[userId]) patch[`deliveredBy.${userId}`] = true;
      if (isVisible && !m.seenBy?.[userId]) patch[`seenBy.${userId}`] = true;
      if (Object.keys(patch).length) batch.update(doc(db, 'dailyQuestions', day, 'answers', m.id), patch);
    });
    batch.commit().catch((err) => console.error('Could not update read receipts:', err));
  }, [messages, day, userId]);

  useEffect(() => { markReceipts(); }, [markReceipts]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') markReceipts(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [markReceipts]);

  // --- Long-press (reply/delete) + swipe-left/right (reply) -------------
  // Same long-press timing/jitter-tolerance as Mood Chat, extended so a
  // horizontal drag is recognised as its own gesture (swipe-to-reply)
  // rather than just cancelling the long press.
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
      await deleteDoc(doc(db, 'dailyQuestions', day, 'answers', m.id));
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

  const send = async () => {
    if (!text.trim() || !userId || !sendReady) return;
    const moderationReason = moderateText(text);
    if (moderationReason) {
      setChatError(MODERATION_MESSAGES[moderationReason]);
      return;
    }
    triggerCooldown();
    try {
      await addDoc(collection(db, 'dailyQuestions', day, 'answers'), {
        type: 'text', text: text.trim(), userId,
        userAge: user?.age, userGender: user?.gender, userColor: user?.avatarColor,
        createdAt: Timestamp.now(),
        ...replyToField(),
      });
      setText('');
      setReplyingTo(null);
      // Fire-and-forget: the streak write is a separate document from the
      // answer itself, and shouldn't block the input from clearing or show
      // an error banner over what was actually a successful send. Real
      // failures here just mean the streak doesn't tick up this once,
      // which self-corrects tomorrow rather than blocking anything.
      recordDailyAnswerStreak(userId, day).catch((err) => console.error('streak update failed', err));
    } catch (err) {
      setChatError(`Couldn't send that. (${err?.code || 'unknown'}: ${err?.message || err})`);
    }
  };

  const handleSendSticker = async (sticker) => {
    setShowStickerPicker(false);
    if (!userId) return;
    try {
      await addDoc(collection(db, 'dailyQuestions', day, 'answers'), {
        type: 'sticker', fileUrl: sticker.dataUrl, fileMime: sticker.mime || 'image/png', userId,
        userAge: user?.age, userGender: user?.gender, userColor: user?.avatarColor,
        createdAt: Timestamp.now(),
        ...replyToField(),
      });
      setReplyingTo(null);
      recordDailyAnswerStreak(userId, day).catch((err) => console.error('streak update failed', err));
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
          if (dataUrl.length > MAX_DATA_URL_CHARS) {
            setMicError('That recording was too long to send — try one under a minute.');
            return;
          }
          await addDoc(collection(db, 'dailyQuestions', day, 'answers'), {
            type: 'voice', voiceUrl: dataUrl, voiceMime: actualType, userId,
            userAge: user?.age, userGender: user?.gender, userColor: user?.avatarColor,
            createdAt: Timestamp.now(),
            ...replyToField(),
          });
          setReplyingTo(null);
          recordDailyAnswerStreak(userId, day).catch((err) => console.error('streak update failed', err));
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

  // The one piece of this activity that Mood Chat structurally can't have:
  // Mood Chat is a live, ephemeral vibe — there's no "best" message, just
  // a stream. Daily Question is scoped to one shared prompt everyone in
  // the room is answering, which makes a shared favorite genuinely
  // meaningful. Only surfaced once someone's actually reacted, so an
  // empty room doesn't show an arbitrary "top answer" with zero votes.
  const topAnswer = visibleMessages.reduce((best, m) => {
    const count = Object.keys(m.reactions || {}).length;
    if (count === 0) return best;
    if (!best || count > Object.keys(best.reactions || {}).length) return m;
    return best;
  }, null);

  // Toggles the current user's own key in the reactions map — matches the
  // same "only your own key, hasOnly([uid])" pattern firestore.rules
  // already uses for deliveredBy/seenBy, just extended to a third field
  // anyone (including the answer's own author) can touch.
  const toggleReaction = async (m) => {
    if (!userId) return;
    const alreadyReacted = !!m.reactions?.[userId];
    try {
      await updateDoc(doc(db, 'dailyQuestions', day, 'answers', m.id), {
        [`reactions.${userId}`]: alreadyReacted ? deleteField() : true,
      });
    } catch (err) {
      setChatError(`Couldn't update that. (${err?.code || 'unknown'})`);
    }
  };
  const lastMineId = [...visibleMessages].reverse().find((m) => m.userId === userId)?.id;

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar
          title={t('daily_question')}
          subtitle={`${question} • ${presenceError ? t('presence_unavailable') : `${onlineCount} ${t('online_now')}`}`}
          onBack={() => navigate(-1)}
        />

        <div className="fade-in" data-testid="daily-question-room">
          <div className="aura-row" style={{ justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
            <div className="chip"><span className="dot dot--live" /> Question #{questionIndex + 1} • {day}</div>
            {user?.dailyStreak > 0 && (
              <div className="chip" data-testid="daily-streak-chip" title={user.dailyStreakBest > user.dailyStreak ? `Best: ${user.dailyStreakBest} days` : undefined}>
                🔥 {user.dailyStreak} {user.dailyStreak === 1 ? 'day' : 'days'}
              </div>
            )}
            <div className="chip" data-testid="messages-today-chip">{t('messages_today_count', { count: visibleMessages.length })}</div>
          </div>
          {presenceError && (
            <p className="aura-muted" style={{ fontSize: '0.78rem', margin: '0 0 8px' }} data-testid="presence-error">
              {t('presence_unavailable')}
            </p>
          )}

          <div className="aura-card chat-card fade-in">
            {topAnswer && (
              <button
                type="button"
                className="aura-card"
                style={{ width: '100%', textAlign: 'left', marginBottom: 10, borderColor: '#f59e0b' }}
                onClick={() => scrollToMessage(topAnswer.id)}
                data-testid="top-answer-card"
              >
                <p style={{ margin: '0 0 4px', fontSize: '0.75rem', fontWeight: 700, color: '#f59e0b' }}>
                  🏆 Today's top answer · {Object.keys(topAnswer.reactions || {}).length} {Object.keys(topAnswer.reactions || {}).length === 1 ? 'reaction' : 'reactions'}
                </p>
                <p className="aura-muted" style={{ margin: 0 }}>
                  {topAnswer.type === 'voice' ? '🎤 Voice note' : topAnswer.type === 'sticker' ? '🖼️ Sticker' : (topAnswer.text || '').slice(0, 140)}
                </p>
              </button>
            )}
            <div ref={listRef} className="message-list" data-testid="daily-message-list">
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
                  data-testid={`daily-msg-${m.id}`}
                >
                  <div className="aura-row" style={{ gap: 8, justifyContent: 'space-between' }}>
                    <div className="aura-row" style={{ gap: 8 }}>
                      <Avatar color={m.userColor} size={24} />
                      <span className="message__meta">Person {m.userId?.slice(0, 6)} • {m.userAge} • {m.userGender}</span>
                    </div>
                    {m.userId !== userId && (
                      <ReportBlockMenu userId={userId} otherUserId={m.userId} blocked={blockedUsers.has(m.userId)} context="dailyQuestion" contextId={day} compact />
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
                  <button
                    type="button"
                    className={`message__reaction-btn${m.reactions?.[userId] ? ' message__reaction-btn--active' : ''}`}
                    onClick={(e) => { e.stopPropagation(); toggleReaction(m); }}
                    data-testid={`react-btn-${m.id}`}
                    aria-label="React to this answer"
                  >
                    <Heart size={14} fill={m.reactions?.[userId] ? 'currentColor' : 'none'} />
                    {Object.keys(m.reactions || {}).length > 0 && (
                      <span style={{ marginLeft: 4, fontSize: '0.75rem' }}>{Object.keys(m.reactions || {}).length}</span>
                    )}
                  </button>
                  {m.userId === userId && m.id === lastMineId && (Object.keys(m.deliveredBy || {}).length > 0 || Object.keys(m.seenBy || {}).length > 0) && (
                    <span className="message__receipt-label" data-testid="last-message-receipt-label">
                      {t('delivered_to', { count: Object.keys(m.deliveredBy || {}).length })}
                      {Object.keys(m.seenBy || {}).length > 0 && ` • ${t('seen_by', { count: Object.keys(m.seenBy || {}).length })}`}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {chatError && <p className="chat-card__error aura-login-error" data-testid="daily-chat-error">{chatError}</p>}
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
                data-testid="daily-sticker-btn"
              >
                <StickerIcon size={16} />
              </button>
              <input
                type="text"
                className="aura-input"
                placeholder={t('write_answer')}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
                maxLength={3000}
                style={{ flex: '1 1 240px' }}
                data-testid="daily-input"
              />
              {recording ? (
                <button type="button" className="aura-btn aura-btn-danger" onClick={stopRecording} data-testid="daily-stop-record-btn"><Square size={16} /> {Math.max(0, MAX_RECORDING_SECONDS - recordSeconds)}s</button>
              ) : (
                <button type="button" className="aura-btn aura-btn-secondary" onClick={startRecording} disabled={!!text.trim()} aria-label={t('send_voice_note')} data-testid="daily-record-btn"><Mic size={16} /></button>
              )}
              <button type="button" className="aura-btn aura-btn-primary" onClick={send} disabled={!text.trim() || !sendReady} data-testid="daily-submit-btn"><Send size={16} /></button>
            </div>
          </div>
        </div>
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
