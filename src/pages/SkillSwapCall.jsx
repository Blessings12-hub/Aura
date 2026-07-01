import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  doc, getDoc, setDoc, updateDoc, onSnapshot, collection, addDoc, serverTimestamp, query, orderBy,
} from 'firebase/firestore';
import { PhoneOff } from 'lucide-react';
import { db } from '../firebase';
import { useCurrentUser } from '../hooks/useCurrentUser';
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
  const { t } = useTranslation();
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const pcRef = useRef(null);
  const streamRef = useRef(null);
  const [status, setStatus] = useState('Connecting…');

  useEffect(() => {
    if (loading || !swapId || !userId) return undefined;
    let cancelled = false;
    let unsubCall, unsubCand;

    (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
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
        })
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
      });

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
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, [swapId, userId, loading]);

  return (
    <div className=\"aura-page\">
      <div className=\"aura-shell\">
        <TopBar title=\"Skill Swap Call\" subtitle={status} onBack={() => navigate(-1)} />
        <div className=\"aura-card aura-section fade-in\">
          <div className=\"video-grid\">
            <video ref={localVideoRef} autoPlay playsInline muted data-testid=\"local-video\" />
            <video ref={remoteVideoRef} autoPlay playsInline data-testid=\"remote-video\" />
          </div>
          <div className=\"aura-row\" style={{ justifyContent: 'center', marginTop: 14 }}>
            <button type=\"button\" onClick={() => navigate(-1)} className=\"aura-btn aura-btn-danger\" data-testid=\"end-call-btn\"><PhoneOff size={16} /> {t('end_call')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}