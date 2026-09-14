import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { doc, onSnapshot } from '../lib/firestoreClient';
import {
  PhoneOff, ShieldAlert, Mic, MicOff, Video, VideoOff, RefreshCw,
} from 'lucide-react';
import { db } from '../lib/firestoreClient';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useBlockedUsers } from '../hooks/useBlockedUsers';
import { useVideoCall } from '../hooks/useVideoCall';
import TopBar from '../components/TopBar';
import PageSkeleton from '../components/PageSkeleton';

export default function SkillSwapCall() {
  const navigate = useNavigate();
  const { swapId } = useParams();
  const { userId, loading } = useCurrentUser();
  const blockedUsers = useBlockedUsers(userId);
  const { t } = useTranslation();
  // Three-state consent gate: null = still checking, false = not consented
  // (blocks camera/mic access entirely), true = both parties accepted and
  // we're allowed to proceed. This is checked against swapPairs directly —
  // not inferred from how the person navigated here — so URL-typing or
  // using the back button can't bypass it.
  const [consented, setConsented] = useState(null);
  const [otherUid, setOtherUid] = useState(null);
  const [sessionId, setSessionId] = useState(null);

  // Consent check — runs BEFORE any getUserMedia() call. Also keeps
  // listening: if either party revokes consent while a call might be
  // starting, we never open the camera. Also picks up callSessionId, the
  // per-attempt id minted in SkillSwapChat the moment both sides agree —
  // this is what gives every call a brand-new signaling doc instead of
  // reusing a previous call's stale offer/answer.
  useEffect(() => {
    if (!swapId || !userId) return undefined;
    const unsub = onSnapshot(doc(db, 'swapPairs', swapId), (snap) => {
      const data = snap.data();
      if (!data) { setConsented(false); return; }
      const isParticipant = data.userA === userId || data.userB === userId;
      const otherUidVal = data.userA === userId ? data.userB : data.userA;
      const isBlocked = otherUidVal && blockedUsers.has(otherUidVal);
      setOtherUid(otherUidVal || null);
      setSessionId(data.callSessionId || null);
      setConsented(Boolean(isParticipant && data.videoA && data.videoB && !isBlocked));
    }, () => setConsented(false));
    return () => unsub();
  }, [swapId, userId, blockedUsers]);

  const {
    localVideoRef, remoteVideoRef, status, micOn, camOn, toggleMic, toggleCamera, callFailed, retry, cleanupSession,
  } = useVideoCall({
    collectionName: 'skillSwapCalls',
    pairId: swapId,
    sessionId,
    userId,
    otherUid,
    consented,
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
          <TopBar title={t('skill_swap')} onBack={() => navigate(-1)} />
          <div className="aura-card aura-section fade-in" style={{ textAlign: 'center' }} data-testid="video-not-consented">
            <ShieldAlert size={28} style={{ marginBottom: 8, color: 'var(--warning)' }} />
            <p className="aura-muted">
              This video call hasn't been accepted by both people yet. Go back to the chat and request — or accept — a video call first.
            </p>
            <button type="button" onClick={() => navigate(`/aura/swap/chat/${swapId}`)} className="aura-btn aura-btn-primary" style={{ marginTop: 10 }}>
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
        <TopBar title="Skill Swap Call" subtitle={status} onBack={endCall} />
        <div className="aura-card aura-section fade-in">
          <div className="call-stage">
            <video ref={remoteVideoRef} autoPlay playsInline className="call-stage__remote" data-testid="remote-video" />
            <video ref={localVideoRef} autoPlay playsInline muted className="call-stage__local" data-testid="local-video" />
          </div>
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
            <button type="button" onClick={endCall} className="aura-btn aura-btn-danger" aria-label={t('end_call')} data-testid="end-call-btn"><PhoneOff size={18} /></button>
            <button type="button" onClick={toggleCamera} className={`aura-btn aura-btn-secondary${!camOn ? ' is-muted' : ''}`} aria-label={camOn ? t('camera_off') : t('camera_on')} data-testid="toggle-camera-btn">
              {camOn ? <Video size={18} /> : <VideoOff size={18} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
