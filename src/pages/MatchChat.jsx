import {
  useCallback, useEffect, useRef, useState,
} from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  collection, addDoc, doc, deleteDoc, getDoc, updateDoc, writeBatch, onSnapshot, query, orderBy, where, limit, Timestamp,
} from 'firebase/firestore';
import {
  Send, Video, Phone, X, PhoneIncoming, Mic, Square, Paperclip, Download, FileText,
  Check, CheckCheck, Reply, Pin, Trash2,
} from 'lucide-react';
import { db } from '../firebase';
import { subscribe } from '../lib/subscribe';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useBlockedUsers } from '../hooks/useBlockedUsers';
import { useSendCooldown } from '../hooks/useSendCooldown';
import { useUserStatus } from '../hooks/usePresence';
import {
  pickSupportedVoiceMimeType, MAX_RECORDING_SECONDS, MAX_DATA_URL_CHARS,
  formatFileSize, readFileAsDataUrl, resizeChatImageToDataUrl,
} from '../lib/chatMedia';
import TopBar from '../components/TopBar';
import PageSkeleton from '../components/PageSkeleton';
import Avatar from '../components/Avatar';
import ReportBlockMenu from '../components/ReportBlockMenu';
import ProfileModal from '../components/ProfileModal';

const formatTime = (ts) => {
  const d = ts?.toDate?.();
  if (!d) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

// Shared "today at 2:34 PM" / "yesterday at 2:34 PM" / "Mon, 14 Jul at
// 2:34 PM" formatter — used for both the header's "Last seen" line and
// each message's "Seen …" receipt label, so both read the same way.
const formatDayTime = (d) => {
  if (!d) return '';
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `today at ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `yesterday at ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} at ${time}`;
};
const formatDayTimeFromTimestamp = (ts) => formatDayTime(ts?.toDate?.());
const formatDayTimeFromMillis = (ms) => formatDayTime(ms ? new Date(ms) : null);

// Short one-line preview used for reply quotes and the pinned-message
// banner — same shape as the server's messagePreview() in functions/index.js.
const buildPreview = (m) => {
  if (!m) return '';
  switch (m.type) {
    case 'voice': return '🎤 Voice note';
    case 'image': return '📷 Photo';
    case 'audio': return '🎵 Audio file';
    case 'file': return `📎 ${m.fileName || 'File'}`;
    default: {
      const text = (m.text || '').trim();
      return text.length > 120 ? `${text.slice(0, 117)}...` : text;
    }
  }
};

export default function MatchChat() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { matchId } = useParams();
  const { state } = useLocation();
  const { user, userId, loading } = useCurrentUser();
  const blockedUsers = useBlockedUsers(userId);
  const { ready: sendReady, trigger: triggerCooldown } = useSendCooldown();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [theirIdentity, setTheirIdentity] = useState(null);
  const [theirCard, setTheirCard] = useState(state?.profile || null);
  const [chatError, setChatError] = useState('');
  const [showProfile, setShowProfile] = useState(false);
  const [pair, setPair] = useState(null);

  // Attachment sending state: voice-note recording, and a busy flag for
  // the attach button (so it can show it's working through a
  // resize/read/upload instead of appearing to do nothing).
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [mediaError, setMediaError] = useState('');
  const [sendingAttachment, setSendingAttachment] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState('');

  // Long-press message actions: which message the action sheet is open
  // for, and which one (if any) I'm composing a reply to.
  const [actionsFor, setActionsFor] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const recTimerRef = useRef(null);
  const fileInputRef = useRef(null);
  const listRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const messageElsRef = useRef({});

  // matchId is "<uidA>_<uidB>" (sorted). The other participant is whichever
  // half isn't me.
  const theirUid = matchId?.split('_').find((id) => id !== userId);

  useEffect(() => {
    if (!matchId) return undefined;
    const q = query(collection(db, 'matchChats', matchId, 'messages'), orderBy('createdAt', 'asc'));
    return subscribe(
      q,
      (snap) => {
        setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; });
      },
      () => setChatError('Messages could not be loaded. Check your connection and try again.'),
      `match chat (${matchId})`,
    );
  }, [matchId]);

  // Now that we're matched, Firestore rules allow reading their identity
  // doc (age/gender/photo) directly — no need to pass it through router
  // state.
  useEffect(() => {
    if (!theirUid) return undefined;
    return onSnapshot(
      doc(db, 'userIdentities', theirUid),
      (snap) => setTheirIdentity(snap.exists() ? snap.data() : null),
      (err) => {
        console.error(`Could not load identity for ${theirUid}:`, err);
        // Realtime listener errored (e.g. a brief permission race right
        // after the match write commits) — fall back to a one-off read
        // instead of leaving the header stuck on the placeholder name.
        getDoc(doc(db, 'userIdentities', theirUid))
          .then((snap) => setTheirIdentity(snap.exists() ? snap.data() : null))
          .catch((e) => console.error(`Fallback identity fetch failed for ${theirUid}:`, e));
      },
    );
  }, [theirUid]);

  // Their public card (bio/hobbies/lookingFor) — passed via router state
  // when arriving from a fresh MatchFinder click, but re-fetched here too
  // so opening a matched conversation directly (a bookmark, a reload, or
  // tapping it from the "Your matches" roster) still has something to show
  // in the profile view, not just their identity.
  useEffect(() => {
    if (!theirUid || theirCard) return undefined;
    return subscribe(
      query(collection(db, 'matchProfiles'), where('userId', '==', theirUid), limit(1)),
      (snap) => { if (!snap.empty) setTheirCard({ id: snap.docs[0].id, ...snap.docs[0].data() }); },
      () => {},
      `their match card (${theirUid})`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theirUid]);

  // Pair doc — carries the video/audio call consent flags (videoA/videoB,
  // audioA/audioB), same request/accept pattern as Skill Swap's video
  // calls, just extended to cover a separate voice-only call type too.
  useEffect(() => {
    if (!matchId) return undefined;
    return subscribe(
      doc(db, 'matchPairs', matchId),
      (s) => setPair(s.data() || null),
      () => setChatError('Could not load this match. Check your connection and try again.'),
      `match pair (${matchId})`,
    );
  }, [matchId]);

  useEffect(() => () => { clearInterval(recTimerRef.current); clearTimeout(longPressTimerRef.current); }, []);

  // Genuine RTDB presence for the other participant — see hooks/usePresence.js.
  const [theirStatus, setTheirStatus] = useState(null);
  useUserStatus(theirUid, useCallback((s) => setTheirStatus(s), []));

  // Delivered/seen receipts. "Delivered" is stamped as soon as an incoming
  // message reaches me (this snapshot fired at all). "Seen" is stamped only
  // while this chat is the visible, focused tab — so switching away or
  // backgrounding the app correctly leaves a message as delivered-but-unseen
  // until I actually come back to look at it.
  const markReceipts = useCallback(() => {
    if (!matchId || !userId) return;
    const pending = messages.filter((m) => m.userId && m.userId !== userId && !m.seenAt);
    if (!pending.length) return;
    const isVisible = typeof document !== 'undefined' && document.visibilityState === 'visible';
    const batch = writeBatch(db);
    let dirty = false;
    pending.forEach((m) => {
      const patch = {};
      if (!m.deliveredAt) patch.deliveredAt = Timestamp.now();
      if (isVisible) patch.seenAt = Timestamp.now();
      if (Object.keys(patch).length) {
        batch.update(doc(db, 'matchChats', matchId, 'messages', m.id), patch);
        dirty = true;
      }
    });
    if (dirty) batch.commit().catch((err) => console.error('Could not update read receipts:', err));
  }, [messages, matchId, userId]);

  useEffect(() => { markReceipts(); }, [markReceipts]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') markReceipts(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [markReceipts]);

  // --- Long-press message actions (pin, delete, reply) ------------------
  // Two real-world bugs made this unreliable before:
  //  1. `onPointerLeave` was cancelling the press on the tiniest finger
  //     jitter, which happens constantly on touchscreens even when the
  //     person isn't trying to scroll — so the timer almost never survived
  //     long enough to fire. We now only cancel on genuine movement (more
  //     than a few px), same threshold browsers use to distinguish a tap
  //     from a scroll/drag.
  //  2. When the sheet DID open, the same touch's synthetic "click" (fired
  //     on release) landed on the backdrop that had just appeared under
  //     the finger and instantly closed it — so it looked like long-press
  //     "didn't work" when it actually opened-then-closed in one frame.
  //     `openedAtRef` makes the backdrop ignore any close-click that
  //     arrives within that same gesture.
  const LONG_PRESS_MS = 450;
  const MOVE_CANCEL_PX = 12;
  const pressOriginRef = useRef({ x: 0, y: 0 });
  const openedAtRef = useRef(0);

  const startLongPress = (m, e) => {
    clearTimeout(longPressTimerRef.current);
    pressOriginRef.current = { x: e.clientX, y: e.clientY };
    longPressTimerRef.current = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(10);
      openedAtRef.current = Date.now();
      setActionsFor(m);
    }, LONG_PRESS_MS);
  };
  const cancelLongPress = () => clearTimeout(longPressTimerRef.current);
  const moveLongPress = (e) => {
    const { x, y } = pressOriginRef.current;
    if (Math.abs(e.clientX - x) > MOVE_CANCEL_PX || Math.abs(e.clientY - y) > MOVE_CANCEL_PX) {
      cancelLongPress();
    }
  };
  const openActionsViaContextMenu = (e, m) => {
    e.preventDefault();
    openedAtRef.current = Date.now();
    setActionsFor(m);
  };
  // Swallows the trailing click from the gesture that just opened the
  // sheet; any later tap (a real "tap outside to dismiss") closes it as
  // normal.
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

  const handleTogglePin = async (m) => {
    setActionsFor(null);
    try {
      await updateDoc(doc(db, 'matchChats', matchId, 'messages', m.id), {
        pinned: !m.pinned,
        pinnedAt: !m.pinned ? Timestamp.now() : null,
      });
    } catch (err) {
      setChatError(`Couldn't update the pin. (${err?.code || 'unknown'}: ${err?.message || err})`);
    }
  };

  const handleDelete = async (m) => {
    setActionsFor(null);
    // eslint-disable-next-line no-alert
    if (!window.confirm(t('delete_message_confirm'))) return;
    try {
      await deleteDoc(doc(db, 'matchChats', matchId, 'messages', m.id));
    } catch (err) {
      setChatError(`Couldn't delete that message. (${err?.code || 'unknown'}: ${err?.message || err})`);
    }
  };

  // `kind` is 'video' or 'audio' — toggles the A/B consent flag for that
  // call type. Requesting and accepting are the same action (set my flag
  // true); declining/cancelling sets it back to false.
  const toggleCallRequest = async (kind, accept) => {
    if (!userId || !matchId) return;
    try {
      const ref = doc(db, 'matchPairs', matchId);
      const snap = await getDoc(ref);
      const data = snap.data() || {};
      const isA = data.userA === userId;
      const flagKey = isA ? `${kind}A` : `${kind}B`;
      const otherFlagKey = isA ? `${kind}B` : `${kind}A`;
      const otherAlreadyAccepted = data[otherFlagKey];
      const sessionKey = `${kind}CallSessionId`;
      const upd = { [flagKey]: accept, callRequestedAt: data.callRequestedAt || Timestamp.now() };
      if (accept && otherAlreadyAccepted) {
        // Both sides have now agreed — mint a brand-new call session so
        // the call page never reuses a previous attempt's stale
        // offer/answer/candidates.
        upd[sessionKey] = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      } else if (!accept) {
        // Declining/cancelling clears the session too, so a stale id can
        // never accidentally be reused by a future call.
        upd[sessionKey] = null;
      }
      await updateDoc(ref, upd);
    } catch (err) {
      setChatError(`Couldn't update the call request. (${err?.code || 'unknown'}: ${err?.message || err})`);
    }
  };

  // Per-call-type derived state (video and audio are independent) — used
  // to decide which banner (if any) to show for each.
  const callState = (kind) => {
    if (!pair) return {};
    const flagA = pair[`${kind}A`];
    const flagB = pair[`${kind}B`];
    const bothAccepted = !!(flagA && flagB);
    const iAccepted = pair.userA === userId ? flagA : flagB;
    const theyAccepted = pair.userA === userId ? flagB : flagA;
    return { bothAccepted, iAccepted, theyAccepted, incomingInvite: !!(theyAccepted && !iAccepted) };
  };
  const videoState = callState('video');
  const audioState = callState('audio');

  // Denormalized reply-quote metadata attached to a new message when I'm
  // replying to one — kept as a small preview snapshot (not a live
  // reference) so the quote still renders correctly even if the original
  // message is later deleted.
  const replyToField = () => (replyingTo
    ? { replyTo: { id: replyingTo.id, userId: replyingTo.userId, preview: buildPreview(replyingTo) } }
    : {});

  const send = async () => {
    if (!text.trim() || !userId || !sendReady) return;
    triggerCooldown();
    try {
      await addDoc(collection(db, 'matchChats', matchId, 'messages'), {
        type: 'text', text: text.trim(), userId, userColor: user?.avatarColor, createdAt: Timestamp.now(),
        ...replyToField(),
      });
      setText('');
      setReplyingTo(null);
    } catch (err) {
      setChatError(`Couldn't send that. (${err?.code || 'unknown'}: ${err?.message || err})`);
    }
  };

  // --- Voice notes -----------------------------------------------------
  // Same base64-in-Firestore-doc pattern as MoodChat.jsx (see chatMedia.js
  // for the shared reasoning): no Storage bucket, so the recording is
  // capped and embedded directly.
  const startRecording = async () => {
    setMediaError('');
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
        // under budget, but codecs/bitrates vary by browser, so verify for
        // real rather than assume the timer alone was enough.
        if (blob.size > 700 * 1024) {
          setMediaError('That recording was too long to send — try one under a minute.');
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
            setMediaError('That recording was too long to send — try one under a minute.');
            return;
          }
          await addDoc(collection(db, 'matchChats', matchId, 'messages'), {
            type: 'voice', voiceUrl: dataUrl, voiceMime: actualType, userId, userColor: user?.avatarColor, createdAt: Timestamp.now(),
            ...replyToField(),
          });
          setReplyingTo(null);
        } catch (err) {
          setMediaError(`Couldn't send that voice note. (${err?.code || 'unknown'}: ${err?.message || err})`);
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
      setMediaError('Microphone access was blocked or unavailable. Check your browser/site permissions and try again.');
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

  // --- Attachments: pictures, audio files, and everything else ----------
  // One picker now covers all of it. Images still get the same
  // resize/compress pass as before (so photo quality and size stay
  // sensible); audio picked from the file manager keeps its own type so
  // it renders with an inline player like a voice note; anything else
  // falls back to a generic file card with a download link.
  const handleAttachmentPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow picking the exact same file again later
    if (!file) return;
    setMediaError('');
    setSendingAttachment(true);
    try {
      const isImage = file.type?.startsWith('image/');
      const isAudio = file.type?.startsWith('audio/');
      if (isImage) {
        const dataUrl = await resizeChatImageToDataUrl(file);
        await addDoc(collection(db, 'matchChats', matchId, 'messages'), {
          type: 'image', fileUrl: dataUrl, fileMime: 'image/jpeg', fileName: file.name || 'photo.jpg', userId, userColor: user?.avatarColor, createdAt: Timestamp.now(),
          ...replyToField(),
        });
      } else {
        const dataUrl = await readFileAsDataUrl(file);
        await addDoc(collection(db, 'matchChats', matchId, 'messages'), {
          type: isAudio ? 'audio' : 'file',
          fileUrl: dataUrl,
          fileMime: file.type || 'application/octet-stream',
          fileName: file.name || (isAudio ? 'audio' : 'file'),
          fileSize: file.size,
          userId,
          userColor: user?.avatarColor,
          createdAt: Timestamp.now(),
          ...replyToField(),
        });
      }
      setReplyingTo(null);
    } catch (err) {
      setMediaError(err?.message || "Couldn't send that attachment.");
    } finally {
      setSendingAttachment(false);
    }
  };

  if (loading) return <PageSkeleton />;

  const displayName = theirIdentity?.displayName || `Person ${theirUid?.slice(0, 6)}`;
  const title = theirIdentity
    ? `${displayName} • ${theirIdentity.age} • ${theirIdentity.gender}`
    : t('match_finder');

  const isBlocked = theirUid && blockedUsers.has(theirUid);
  // WhatsApp-style: only the very last message I sent shows a "Delivered" /
  // "Seen …" caption underneath it, so the thread doesn't get cluttered
  // with a status line under every single bubble.
  const lastMineId = [...messages].reverse().find((m) => m.userId === userId)?.id;
  const isOnline = theirStatus?.state === 'online';
  const pinnedMessages = messages.filter((m) => m.pinned);
  const topPinned = pinnedMessages.length
    ? pinnedMessages.reduce((a, b) => ((b.pinnedAt?.toMillis?.() || 0) > (a.pinnedAt?.toMillis?.() || 0) ? b : a))
    : null;
  const presenceLabel = isOnline
    ? t('online')
    : theirStatus?.lastChanged
      ? t('last_seen_at', { time: formatDayTimeFromMillis(theirStatus.lastChanged) })
      : t('start_chat');

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar
          title={(
            <button type="button" className="chat-header-tap" onClick={() => setShowProfile(true)} data-testid="open-their-profile">
              <Avatar color={theirCard?.avatarColor} photoURL={theirIdentity?.photoURL} size={30} online={isOnline} />
              <span>{title}</span>
            </button>
          )}
          subtitle={<span className={isOnline ? 'chat-presence-online' : ''} data-testid="chat-presence">{presenceLabel}</span>}
          onBack={() => navigate(-1)}
          right={<ReportBlockMenu userId={userId} otherUserId={theirUid} blocked={isBlocked} context="matchChat" contextId={matchId} />}
        />
        {isBlocked ? (
          <div className="aura-card aura-section fade-in" style={{ textAlign: 'center' }} data-testid="match-chat-blocked">
            <p className="aura-muted">{t('you_blocked_this_person')}</p>
          </div>
        ) : (
          <>
            {[{ kind: 'video', icon: Video, label: t('request_video'), pendingLabel: t('video_pending'), startLabel: t('start_video') },
              { kind: 'audio', icon: Phone, label: t('request_audio'), pendingLabel: t('audio_pending'), startLabel: t('start_audio') }].map(({
              kind, icon: Icon, label, pendingLabel, startLabel,
            }) => {
              const cs = kind === 'video' ? videoState : audioState;
              if (!pair) return null;
              if (cs.bothAccepted) {
                return (
                  <div key={kind} className="video-call-banner fade-in" data-testid={`${kind}-ready-banner`}>
                    <div className="video-call-banner__label">
                      <span className="video-call-banner__icon"><Icon size={16} /></span>
                      {t('connected')}
                    </div>
                    <button type="button" onClick={() => navigate(`/aura/match/call/${matchId}?mode=${kind}`)} className="aura-btn aura-btn-primary aura-btn-pill" data-testid={`start-${kind}-btn`}><Icon size={14} /> {startLabel}</button>
                  </div>
                );
              }
              if (cs.incomingInvite) {
                return (
                  <div key={kind} className="video-call-banner fade-in" data-testid={`incoming-${kind}-banner`}>
                    <div className="video-call-banner__label">
                      <span className="video-call-banner__icon"><PhoneIncoming size={16} /></span>
                      {kind === 'video' ? t('incoming_video_call') : t('incoming_audio_call')}
                    </div>
                    <div className="aura-row" style={{ gap: 8 }}>
                      <button type="button" onClick={() => toggleCallRequest(kind, true)} className="aura-btn aura-btn-primary aura-btn-pill" data-testid={`accept-${kind}-btn`}><Icon size={14} /> {t('accept')}</button>
                      <button type="button" onClick={() => toggleCallRequest(kind, false)} className="aura-btn aura-btn-secondary aura-btn-pill" data-testid={`decline-${kind}-btn`}><X size={14} /> {t('decline')}</button>
                    </div>
                  </div>
                );
              }
              if (cs.iAccepted) {
                return (
                  <div key={kind} className="video-call-banner fade-in" data-testid={`waiting-${kind}-banner`}>
                    <div className="video-call-banner__label">
                      <span className="video-call-banner__icon"><Icon size={16} /></span>
                      {pendingLabel}
                    </div>
                    <button type="button" onClick={() => toggleCallRequest(kind, false)} className="aura-btn aura-btn-secondary aura-btn-pill" data-testid={`cancel-${kind}-btn`}><X size={14} /> Cancel</button>
                  </div>
                );
              }
              return (
                <div key={kind} className="aura-row" style={{ justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => toggleCallRequest(kind, true)} className="aura-btn aura-btn-secondary aura-btn-pill" data-testid={`request-${kind}-btn`}><Icon size={14} /> {label}</button>
                </div>
              );
            })}

            {topPinned && (
              <div className="pinned-banner fade-in" data-testid="pinned-message-banner" onClick={() => scrollToMessage(topPinned.id)}>
                <span className="pinned-banner__icon"><Pin size={14} /></span>
                <span className="pinned-banner__text">
                  {pinnedMessages.length > 1 ? `${t('pinned_message')} (${pinnedMessages.length})` : t('pinned_message')} · {buildPreview(topPinned)}
                </span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleTogglePin(topPinned); }}
                  className="aura-btn aura-btn-secondary aura-btn-pill"
                  aria-label={t('unpin_message')}
                  data-testid="unpin-btn"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            <div className="aura-card chat-card fade-in">
              <div className="message-list" ref={listRef} data-testid="match-message-list">
                {messages.length === 0 && <p className="chat-empty-state">{t('no_messages')}</p>}
                {messages.map((m) => (
                  <div
                    key={m.id}
                    ref={(el) => { messageElsRef.current[m.id] = el; }}
                    className={`message${m.userId === userId ? ' message--mine' : ''}`}
                    onPointerDown={(e) => startLongPress(m, e)}
                    onPointerMove={moveLongPress}
                    onPointerUp={cancelLongPress}
                    onPointerCancel={cancelLongPress}
                    onContextMenu={(e) => openActionsViaContextMenu(e, m)}
                    data-testid={`message-row-${m.id}`}
                  >
                    {m.userId !== userId && (
                      <div className="aura-row" style={{ gap: 8 }}><Avatar color={m.userColor} size={20} /><span className="message__meta">{displayName}</span></div>
                    )}
                    <div className="message__bubble">
                      {m.replyTo && (
                        <button
                          type="button"
                          className="message__reply-quote"
                          onClick={(e) => { e.stopPropagation(); scrollToMessage(m.replyTo.id); }}
                          data-testid={`reply-quote-${m.id}`}
                        >
                          <span className="message__reply-quote__name">{m.replyTo.userId === userId ? t('you') : displayName}</span>
                          <span className="message__reply-quote__text">{m.replyTo.preview}</span>
                        </button>
                      )}
                      {m.type === 'voice' && m.voiceUrl && (
                        <div className="message__voice">
                          <audio controls src={m.voiceUrl} style={{ maxWidth: 240 }} data-testid={`voice-msg-${m.id}`} />
                        </div>
                      )}
                      {m.type === 'image' && m.fileUrl && (
                        <button
                          type="button"
                          className="message__image-btn"
                          onClick={() => setLightboxUrl(m.fileUrl)}
                          data-testid={`image-msg-${m.id}`}
                        >
                          <img src={m.fileUrl} alt={m.fileName || 'Photo'} className="message__image" />
                        </button>
                      )}
                      {m.type === 'audio' && m.fileUrl && (
                        <div className="message__file-audio">
                          <audio controls src={m.fileUrl} style={{ maxWidth: 240 }} data-testid={`audio-msg-${m.id}`} />
                          {m.fileName && <span className="message__file-name">{m.fileName}</span>}
                        </div>
                      )}
                      {m.type === 'file' && m.fileUrl && (
                        <a
                          href={m.fileUrl}
                          download={m.fileName || 'file'}
                          className="message__file-card"
                          data-testid={`file-msg-${m.id}`}
                        >
                          <span className="message__file-icon"><FileText size={20} /></span>
                          <span className="message__file-info">
                            <span className="message__file-name">{m.fileName || 'File'}</span>
                            {!!m.fileSize && <span className="message__file-size">{formatFileSize(m.fileSize)}</span>}
                          </span>
                          <Download size={16} />
                        </a>
                      )}
                      {(!m.type || m.type === 'text') && <span>{m.text}</span>}
                    </div>
                    <span className="message__time-row">
                      <span className="message__time">{formatTime(m.createdAt)}</span>
                      {m.userId === userId && (
                        <span
                          className={`message__receipt${m.seenAt ? ' message__receipt--seen' : ''}`}
                          data-testid={`receipt-${m.id}`}
                          title={m.seenAt ? t('seen_at', { time: formatDayTimeFromTimestamp(m.seenAt) }) : m.deliveredAt ? t('delivered') : ''}
                        >
                          {m.seenAt || m.deliveredAt ? <CheckCheck size={13} /> : <Check size={13} />}
                        </span>
                      )}
                    </span>
                    {m.userId === userId && m.id === lastMineId && (m.seenAt || m.deliveredAt) && (
                      <span
                        className={`message__receipt-label${m.seenAt ? ' message__receipt-label--seen' : ''}`}
                        data-testid="last-message-receipt-label"
                      >
                        {m.seenAt ? t('seen_at', { time: formatDayTimeFromTimestamp(m.seenAt) }) : t('delivered')}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {chatError && <p className="chat-card__error aura-login-error" data-testid="match-chat-error">{chatError}</p>}
              {mediaError && <p className="chat-card__error aura-login-error" data-testid="match-media-error">{mediaError}</p>}
              {replyingTo && (
                <div className="reply-preview" data-testid="reply-preview-bar">
                  <div className="reply-preview__body">
                    <span className="reply-preview__name">{replyingTo.userId === userId ? t('you') : displayName}</span>
                    <span className="reply-preview__text">{buildPreview(replyingTo)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReplyingTo(null)}
                    className="aura-btn aura-btn-secondary aura-btn-pill"
                    aria-label={t('cancel_reply')}
                    data-testid="cancel-reply-btn"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
              <div className="chat-input-bar">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleAttachmentPick}
                  style={{ display: 'none' }}
                  data-testid="match-file-input"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sendingAttachment || recording}
                  className="aura-btn aura-btn-secondary"
                  aria-label={t('attach_file')}
                  data-testid="match-file-btn"
                >
                  <Paperclip size={16} />
                </button>
                <input className="aura-input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder={t('type_message')} maxLength={3000} style={{ flex: 1 }} data-testid="match-input" />
                {recording ? (
                  <button type="button" onClick={stopRecording} className="aura-btn aura-btn-danger" aria-label={t('recording')} data-testid="match-stop-record-btn">
                    <Square size={16} /> {Math.max(0, MAX_RECORDING_SECONDS - recordSeconds)}s
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={startRecording}
                    disabled={!!text.trim()}
                    className="aura-btn aura-btn-secondary"
                    aria-label={t('send_voice_note')}
                    data-testid="match-record-btn"
                  >
                    <Mic size={16} />
                  </button>
                )}
                <button type="button" onClick={send} disabled={!text.trim() || !sendReady} className="aura-btn aura-btn-primary" aria-label={t('send')} data-testid="match-send"><Send size={16} /></button>
              </div>
            </div>
          </>
        )}
      </div>

      {showProfile && (
        <ProfileModal
          photoURL={theirIdentity?.photoURL}
          color={theirCard?.avatarColor}
          name={displayName}
          age={theirIdentity?.age}
          gender={theirIdentity?.gender}
          bio={theirCard?.bio}
          hobbies={theirCard?.hobbies}
          lookingFor={theirCard?.lookingFor}
          onClose={() => setShowProfile(false)}
        />
      )}

      {lightboxUrl && (
        <div className="aura-modal-backdrop" onClick={() => setLightboxUrl('')} data-testid="image-lightbox">
          <button type="button" className="aura-btn aura-btn-secondary aura-btn-pill image-lightbox__close" onClick={() => setLightboxUrl('')} aria-label={t('close')}>
            <X size={16} />
          </button>
          <img src={lightboxUrl} alt="" className="image-lightbox__img" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      {actionsFor && (
        <div className="aura-modal-backdrop message-actions-backdrop" onClick={closeActions} data-testid="message-actions-sheet">
          <div className="message-actions-sheet" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="message-actions-sheet__item" onClick={() => handleReply(actionsFor)} data-testid="action-reply">
              <Reply size={16} /> {t('reply')}
            </button>
            <button type="button" className="message-actions-sheet__item" onClick={() => handleTogglePin(actionsFor)} data-testid="action-pin">
              <Pin size={16} /> {actionsFor.pinned ? t('unpin_message') : t('pin_message')}
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
