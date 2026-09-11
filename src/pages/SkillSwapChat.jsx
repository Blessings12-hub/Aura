import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  collection, addDoc, doc, query, orderBy, updateDoc, Timestamp, getDoc,
} from 'firebase/firestore';
import { Send, Video, X, PhoneIncoming } from 'lucide-react';
import { db } from '../firebase';
import { subscribe } from '../lib/subscribe';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useBlockedUsers } from '../hooks/useBlockedUsers';
import { useSendCooldown } from '../hooks/useSendCooldown';
import TopBar from '../components/TopBar';
import PageSkeleton from '../components/PageSkeleton';
import ReportBlockMenu from '../components/ReportBlockMenu';

const formatTime = (ts) => {
  const d = ts?.toDate?.();
  if (!d) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export default function SkillSwapChat() {
  const navigate = useNavigate();
  const { swapId } = useParams();
  const { user, userId, loading } = useCurrentUser();
  const blockedUsers = useBlockedUsers(userId);
  const { ready: sendReady, trigger: triggerCooldown } = useSendCooldown();
  const { t } = useTranslation();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [pair, setPair] = useState(null);
  const [chatError, setChatError] = useState('');

  useEffect(() => {
    if (!swapId) return undefined;
    const unsubMsg = subscribe(
      query(collection(db, 'swapChats', swapId, 'messages'), orderBy('createdAt', 'asc')),
      (s) => setMessages(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setChatError('Messages could not be loaded. Check your connection and try again.'),
      `swap chat (${swapId})`,
    );
    const unsubPair = subscribe(
      doc(db, 'swapPairs', swapId),
      (s) => setPair(s.data() || null),
      () => setChatError('Could not load this swap. Check your connection and try again.'),
      `swap pair (${swapId})`,
    );
    return () => { unsubMsg(); unsubPair(); };
  }, [swapId]);

  // Was a batched write pairing with a server-enforced cooldown in
  // firestore.rules — removed after repeatedly causing real send
  // failures in practice. Back to a plain write.
  const send = async () => {
    if (!text.trim() || !userId || !sendReady) return;
    triggerCooldown();
    try {
      await addDoc(collection(db, 'swapChats', swapId, 'messages'), {
        text: text.trim(), userId, userColor: user?.avatarColor, createdAt: Timestamp.now(),
      });
      setText('');
    } catch (err) {
      setChatError(`Couldn't send that. (${err?.code || 'unknown'}: ${err?.message || err})`);
    }
  };

  const toggleVideoRequest = async (accept) => {
    if (!userId || !swapId) return;
    try {
      const ref = doc(db, 'swapPairs', swapId);
      const snap = await getDoc(ref);
      const data = snap.data() || {};
      const isA = data.userA === userId;
      const otherAlreadyAccepted = isA ? data.videoB : data.videoA;
      const upd = isA
        ? { videoA: accept, videoRequestedAt: data.videoRequestedAt || Timestamp.now() }
        : { videoB: accept, videoRequestedAt: data.videoRequestedAt || Timestamp.now() };
      if (accept && otherAlreadyAccepted) {
        // Both sides have now agreed — mint a brand-new call session so the
        // call page never reuses a previous attempt's stale offer/answer.
        upd.callSessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      } else if (!accept) {
        // Declining/cancelling clears the session too, so a stale id can
        // never accidentally be reused by a future call.
        upd.callSessionId = null;
      }
      await updateDoc(ref, upd);
    } catch (err) {
      setChatError(`Couldn't update the video call request. (${err?.code || 'unknown'}: ${err?.message || err})`);
    }
  };

  const videoBothAccepted = pair?.videoA && pair?.videoB;
  const iAccepted = pair && (pair.userA === userId ? pair.videoA : pair.videoB);
  const theyAccepted = pair && (pair.userA === userId ? pair.videoB : pair.videoA);
  const theirUid = pair ? (pair.userA === userId ? pair.userB : pair.userA) : null;
  const isBlocked = theirUid && blockedUsers.has(theirUid);
  // An active incoming invite: they've requested/accepted video and I
  // haven't responded yet — this is the state that gets its own banner
  // instead of a small button buried in the topbar, so a live call
  // invitation actually reads as one.
  const incomingInvite = theyAccepted && !iAccepted;

  if (loading) return <PageSkeleton />;

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar
          title={t('skill_swap')}
          subtitle={t('anonymous_profile')}
          onBack={() => navigate(-1)}
          right={<ReportBlockMenu userId={userId} otherUserId={theirUid} blocked={isBlocked} context="swapChat" contextId={swapId} />}
        />

        {isBlocked ? (
          <div className="aura-card aura-section fade-in" style={{ textAlign: 'center' }} data-testid="swap-chat-blocked">
            <p className="aura-muted">{t('you_blocked_this_person')}</p>
          </div>
        ) : (
          <>
            {videoBothAccepted ? (
              <div className="video-call-banner fade-in" data-testid="video-ready-banner">
                <div className="video-call-banner__label">
                  <span className="video-call-banner__icon"><Video size={16} /></span>
                  {t('connected')}
                </div>
                <button type="button" onClick={() => navigate(`/aura/swap/call/${swapId}`)} className="aura-btn aura-btn-primary aura-btn-pill" data-testid="start-video-btn"><Video size={14} /> {t('start_video')}</button>
              </div>
            ) : incomingInvite ? (
              <div className="video-call-banner fade-in" data-testid="incoming-video-banner">
                <div className="video-call-banner__label">
                  <span className="video-call-banner__icon"><PhoneIncoming size={16} /></span>
                  {t('incoming_video_call')}
                </div>
                <div className="aura-row" style={{ gap: 8 }}>
                  <button type="button" onClick={() => toggleVideoRequest(true)} className="aura-btn aura-btn-primary aura-btn-pill" data-testid="accept-video-btn"><Video size={14} /> {t('accept')}</button>
                  <button type="button" onClick={() => toggleVideoRequest(false)} className="aura-btn aura-btn-secondary aura-btn-pill" data-testid="decline-video-btn"><X size={14} /> {t('decline')}</button>
                </div>
              </div>
            ) : iAccepted ? (
              <div className="video-call-banner fade-in" data-testid="waiting-video-banner">
                <div className="video-call-banner__label">
                  <span className="video-call-banner__icon"><Video size={16} /></span>
                  {t('video_pending')}
                </div>
                <button type="button" onClick={() => toggleVideoRequest(false)} className="aura-btn aura-btn-secondary aura-btn-pill" data-testid="cancel-video-btn"><X size={14} /> Cancel</button>
              </div>
            ) : (
              <div className="aura-row" style={{ justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => toggleVideoRequest(true)} className="aura-btn aura-btn-secondary aura-btn-pill" data-testid="request-video-btn"><Video size={14} /> {t('request_video')}</button>
              </div>
            )}

            <div className="aura-card chat-card fade-in">
              <div className="message-list" data-testid="swap-messages">
                {messages.length === 0 && <p className="chat-empty-state">{t('empty_no_messages')}</p>}
                {messages.map((m) => (
                  <div key={m.id} className={`message${m.userId === userId ? ' message--mine' : ''}`}>
                    <div className="message__bubble">{m.text}</div>
                    <span className="message__time">{formatTime(m.createdAt)}</span>
                  </div>
                ))}
              </div>
              {chatError && <p className="chat-card__error aura-login-error" data-testid="swap-chat-error">{chatError}</p>}
              <div className="chat-input-bar">
                <input className="aura-input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder={t('type_message')} maxLength={3000} style={{ flex: 1 }} data-testid="swap-chat-input" />
                <button type="button" onClick={send} disabled={!text.trim() || !sendReady} className="aura-btn aura-btn-primary" aria-label={t('send')} data-testid="swap-chat-send"><Send size={16} /></button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
