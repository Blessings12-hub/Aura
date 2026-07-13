import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  doc, getDoc, setDoc, updateDoc, onSnapshot, collection, addDoc, serverTimestamp, query, orderBy,
} from 'firebase/firestore';
import { PhoneOff, ShieldAlert } from 'lucide-react';
import { db } from '../firebase';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useBlockedUsers } from '../hooks/useBlockedUsers';
import TopBar from '../components/TopBar';

const ICE_SERVERS = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ],
};

export default function SkillSwapCall() {
  const navigate = useNavigate();
  const { swapId } = useParams();
  const { userId, loading } = useCurrentUser();
  const blockedUsers = useBlockedUsers(userId);
  const { t } = useTranslation();
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const pcRef = useRef(null);
  const streamRef = useRef(null);
  const [status, setStatus] = useState('Connecting…');
  // Three-state consent gate: null = still checking, false = not consented
  // (blocks camera/mic access entirely), true = both parties accepted and
  // we're allowed to proceed. This is checked against swapPairs directly —
  // not inferred from how the person navigated here — so URL-typing or
  // using the back button can't bypass it.
  const [consented, setConsented] = useState(null);

  // Consent check — runs BEFORE any getUserMedia() call. Also keeps
  // listening: if either party revokes consent while a call might be
  // starting, we never open the camera.
  useEffect(() => {
    if (!swapId || !userId) return undefined;
    const unsub = onSnapshot(doc(db, 'swapPairs', swapId), (snap) => {
      const data = snap.data();
      if (!data) { setConsented(false); return; }
      const isParticipant = data.userA === userId || data.userB === userId;
      const otherUid = data.userA === userId ? data.userB : data.userA;
      const isBlocked = otherUid && blockedUsers.has(otherUid);
      setConsented(Boolean(isParticipant && data.videoA && data.videoB && !isBlocked));
    }, () => setConsented(false));
    return () => unsub();
  }, [swapId, userId, blockedUsers]);

  useEffect(() => {
    if (loading || !swapId || !userId || consented !== true) return undefined;
    let cancelled = false;
    let unsubCall, unsubCand;

    (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (cancelled) { stream.getTracks().forEach((tr) => tr.stop()); return; }
      streamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;
      stream.getTracks().forEach((tr) => pc.addTrack(tr, stream));
      pc.ontrack = (e) => { if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0]; };

      const callRef = doc(db, 'skillSwapCalls', swapId);
      const snap = await getDoc(callRef);
      const isInitiator = !snap.exists();

      if (isInitiator) {
        await setDoc(callRef, { userA: userId, createdAt: serverTimestamp(), status: 'requested' });
      }

      pc.onicecandidate = async (e) => {
        if (!e.candidate) return;
        const col = isInitiator ? 'offerCandidates' : 'answerCandidates';
        await addDoc(collection(callRef, col), { candidate: e.candidate.toJSON(), userId, createdAt: serverTimestamp() });
      };

      unsubCand = onSnapshot(
        query(collection(callRef, isInitiator ? 'answerCandidates' : 'offerCandidates'), orderBy('createdAt', 'asc')),
        (s) => s.docChanges().forEach(async (c) => {
          if (c.type === 'added') {
            try { await pc.addIceCandidate(new RTCIceCandidate(c.doc.data().candidate)); } catch (e) { console.error(e); }
          }
        }),
        (err) => { console.error('ICE candidate subscription failed', err); setStatus('Connection lost — check your internet and try again'); },
      );

      unsubCall = onSnapshot(callRef, async (s) => {
        const data = s.data(); if (!data) return;
        if (!isInitiator && data.offer && !pc.currentRemoteDescription) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
          const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
          await updateDoc(callRef, { answer: { type: ans.type, sdp: ans.sdp }, status: 'answered' });
          setStatus('Answered');
        }
        if (isInitiator && data.answer && !pc.currentRemoteDescription) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
          setStatus('Connected');
        }
      }, (err) => { console.error('call signaling subscription failed', err); setStatus('Connection lost — check your internet and try again'); });

      if (isInitiator) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await updateDoc(callRef, { offer: { type: offer.type, sdp: offer.sdp }, status: 'offered' });
        setStatus('Calling…');
      }
    })().catch((e) => { console.error(e); setStatus('Could not start the call'); });

    return () => {
      cancelled = true;
      if (unsubCall) unsubCall();
      if (unsubCand) unsubCand();
      if (pcRef.current) pcRef.current.close();
      if (streamRef.current) streamRef.current.getTracks().forEach((tr) => tr.stop());
    };
  }, [swapId, userId, loading, consented]);

  // While consent is still being checked, or if it isn't there, never touch
  // the camera/mic — show a clear message instead of a blank/broken screen.
  if (loading || consented === null) {
    return <div className="aura-page"><div className="aura-shell"><div className="aura-card">{t('loading')}</div></div></div>;
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
        <TopBar title="Skill Swap Call" subtitle={status} onBack={() => navigate(-1)} />
        <div className="aura-card aura-section fade-in">
          <div className="video-grid">
            <video ref={localVideoRef} autoPlay playsInline muted data-testid="local-video" />
            <video ref={remoteVideoRef} autoPlay playsInline data-testid="remote-video" />
          </div>
          <div className="aura-row" style={{ justifyContent: 'center', marginTop: 14 }}>
            <button type="button" onClick={() => navigate(-1)} className="aura-btn aura-btn-danger" data-testid="end-call-btn"><PhoneOff size={16} /> {t('end_call')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
