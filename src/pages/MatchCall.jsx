import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { doc, onSnapshot } from '../lib/appwriteFirestoreCompat';
import {
  PhoneOff, ShieldAlert, Mic, MicOff, Video, VideoOff, RefreshCw, Phone, User,
} from 'lucide-react';
import { db } from '../lib/appwriteFirestoreCompat';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useBlockedUsers } from '../hooks/useBlockedUsers';
import { useVideoCall } from '../hooks/useVideoCall';
import TopBar from '../components/TopBar';
import PageSkeleton from '../components/PageSkeleton';

export default function MatchCall() {
  const navigate = useNavigate();
  const { matchId } = useParams();
  const [searchParams] = useSearchParams();
  const mode = searchParams.get('mode') === 'audio' ? 'audio' : 'video';
  const isVideoMode = mode === 'video';
  const { userId, loading } = useCurrentUser();
  const blockedUsers = useBlockedUsers(userId);
  const { t } = useTranslation();
  // Three-state consent gate, same reasoning as Skill Swap's call page:
  // null = still checking, false = blocks camera/mic entirely, true = both
  // sides accepted THIS call type and we may proceed. Checked directly
  // against matchPairs — never inferred from navigation — so it can't be
  // bypassed by URL-typing or the back button.
  const [consented, setConsented] = useState(null);
  const [otherUid, setOtherUid] = useState(null);
  const [sessionId, setSessionId] = useState(null);

  useEffect(() => {
    if (!matchId || !userId) return undefined;
    const unsub = onSnapshot(doc(db, 'matchPairs', matchId), (snap) => {
      const data = snap.data();
      if (!data) { setConsented(false); return; }
      const isParticipant = data.userA === userId || data.userB === userId;
      const otherUidVal = data.userA === userId ? data.userB : data.userA;
      const isBlocked = otherUidVal && blockedUsers.has(otherUidVal);
      const flagA = isVideoMode ? data.videoA : data.audioA;
      const flagB = isVideoMode ? data.videoB : data.audioB;
      setOtherUid(otherUidVal || null);
      setSessionId(data[`${mode}CallSessionId`] || null);
      setConsented(Boolean(isParticipant && data.status === 'matched' && flagA && flagB && !isBlocked));
    }, () => setConsented(false));
    return () => unsub();
  }, [matchId, userId, blockedUsers, isVideoMode, mode]);

  const {
    localVideoRef, remoteVideoRef, status, micOn, camOn, toggleMic, toggleCamera, callFailed, retry, cleanupSession,
  } = useVideoCall({
    collectionName: 'matchCalls',
    pairId: matchId,
    sessionId,
    userId,
    otherUid,
    consented,
    withVideo: isVideoMode,
  });

  const endCall = () => {
    cleanupSession();
    navigate(-1);
  };

  // While consent is still being checked, or if it isn't there, never touch
  // the camera/mic — show a clear message instead of a blank/broken screen.
  if (loading || consented === null) {
    return <PageSkeleton />;
  }

  if (consented === false) {
    return (
      <div className="aura-page">
        <div className="aura-shell">
          <TopBar title={t('match_finder')} onBack={() => navigate(-1)} />
          <div className="aura-card aura-section fade-in" style={{ textAlign: 'center' }} data-testid="call-not-consented">
            <ShieldAlert size={28} style={{ marginBottom: 8, color: 'var(--warning)' }} />
            <p className="aura-muted">
              {isVideoMode ? 'This video call' : 'This voice call'} hasn't been accepted by both people yet. Go back to the chat and request — or accept — a call first.
            </p>
            <button type="button" onClick={() => navigate(`/aura/match/chat/${matchId}`)} className="aura-btn aura-btn-primary" style={{ marginTop: 10 }}>
              {t('open_chat')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar title={isVideoMode ? 'Video call' : 'Voice call'} subtitle={status} onBack={endCall} />
        <div className="aura-card aura-section fade-in">
          {isVideoMode ? (
            <div className="call-stage">
              <video ref={remoteVideoRef} autoPlay playsInline className="call-stage__remote" data-testid="remote-video" />
              <video ref={localVideoRef} autoPlay playsInline muted className="call-stage__local" data-testid="local-video" />
            </div>
          ) : (
            <div className="call-stage call-stage--audio" style={{ textAlign: 'center', padding: '40px 0' }} data-testid="audio-call-stage">
              {/* No visible <video> elements in voice mode — the hidden
                  ones below still carry the audio tracks through the same
                  refs the shared call hook attaches streams to. */}
              <div className="call-audio-avatar">
                <User size={48} />
              </div>
              <p className="aura-muted" style={{ marginTop: 10 }}>{status}</p>
              <video ref={remoteVideoRef} autoPlay playsInline style={{ display: 'none' }} data-testid="remote-audio" />
              <video ref={localVideoRef} autoPlay playsInline muted style={{ display: 'none' }} data-testid="local-audio" />
            </div>
          )}
          {callFailed && (
            <div className="aura-row" style={{ justifyContent: 'center', marginTop: 8 }}>
              <button type="button" onClick={retry} className="aura-btn aura-btn-secondary aura-btn-pill" data-testid="retry-call-btn">
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          )}
          <div className="call-controls">
            <button type="button" onClick={toggleMic} className={`aura-btn aura-btn-secondary${!micOn ? ' is-muted' : ''}`} aria-label={micOn ? t('mute') : t('unmute')} data-testid="toggle-mic-btn">
              {micOn ? <Mic size={18} /> : <MicOff size={18} />}
            </button>
            <button type="button" onClick={endCall} className="aura-btn aura-btn-danger" aria-label={t('end_call')} data-testid="end-call-btn">
              {isVideoMode ? <PhoneOff size={18} /> : <Phone size={18} />}
            </button>
            {isVideoMode && (
              <button type="button" onClick={toggleCamera} className={`aura-btn aura-btn-secondary${!camOn ? ' is-muted' : ''}`} aria-label={camOn ? t('camera_off') : t('camera_on')} data-testid="toggle-camera-btn">
                {camOn ? <Video size={18} /> : <VideoOff size={18} />}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
