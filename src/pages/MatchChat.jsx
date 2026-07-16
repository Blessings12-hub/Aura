import { useEffect, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  collection, addDoc, doc, getDoc, updateDoc, onSnapshot, query, orderBy, where, limit, Timestamp,
} from 'firebase/firestore';
import {
  Send, Video, Phone, X, PhoneIncoming,
} from 'lucide-react';
import { db } from '../firebase';
import { subscribe } from '../lib/subscribe';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useBlockedUsers } from '../hooks/useBlockedUsers';
import { useSendCooldown } from '../hooks/useSendCooldown';
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

  const send = async () => {
    if (!text.trim() || !userId || !sendReady) return;
    triggerCooldown();
    try {
      await addDoc(collection(db, 'matchChats', matchId, 'messages'), {
        text: text.trim(), userId, userColor: user?.avatarColor, createdAt: Timestamp.now(),
      });
      setText('');
    } catch (err) {
      setChatError(`Couldn't send that. (${err?.code || 'unknown'}: ${err?.message || err})`);
    }
  };

  if (loading) return <PageSkeleton />;

  const displayName = theirIdentity?.displayName || `Person ${theirUid?.slice(0, 6)}`;
  const title = theirIdentity
    ? `${displayName} • ${theirIdentity.age} • ${theirIdentity.gender}`
    : t('match_finder');

  const isBlocked = theirUid && blockedUsers.has(theirUid);

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar
          title={(
            <button type="button" className="chat-header-tap" onClick={() => setShowProfile(true)} data-testid="open-their-profile">
              <Avatar color={theirCard?.avatarColor} photoURL={theirIdentity?.photoURL} size={30} />
              <span>{title}</span>
            </button>
          )}
          subtitle={t('start_chat')}
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

            <div className="aura-card chat-card fade-in">
              <div className="message-list" data-testid="match-message-list">
                {messages.length === 0 && <p className="chat-empty-state">{t('no_messages')}</p>}
                {messages.map((m) => (
                  <div key={m.id} className={`message${m.userId === userId ? ' message--mine' : ''}`}>
                    {m.userId !== userId && (
                      <div className="aura-row" style={{ gap: 8 }}><Avatar color={m.userColor} size={20} /><span className="message__meta">{displayName}</span></div>
                    )}
                    <div className="message__bubble">{m.text}</div>
                    <span className="message__time">{formatTime(m.createdAt)}</span>
                  </div>
                ))}
              </div>
              {chatError && <p className="chat-card__error aura-login-error" data-testid="match-chat-error">{chatError}</p>}
              <div className="chat-input-bar">
                <input className="aura-input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder={t('type_message')} maxLength={3000} style={{ flex: 1 }} data-testid="match-input" />
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
    </div>
  );
}
