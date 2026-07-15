import { useEffect, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  collection, addDoc, doc, onSnapshot, query, orderBy, where, limit, Timestamp,
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
      () => setTheirIdentity(null),
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
