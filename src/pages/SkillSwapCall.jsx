import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  collection,
  addDoc,
  serverTimestamp,
  query,
  orderBy
} from 'firebase/firestore';
import TopBar from '../components/TopBar';

const iceServers = { iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }] };

export default function SkillSwapCall({ theme, setTheme }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { callId, otherUser } = location.state || {};
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const [status, setStatus] = useState('Connecting...');

  useEffect(() => {
    if (!callId) return navigate('/aura/swap');

    let unsubCall = null;
    let unsubCandidates = null;
    let closed = false;

    const start = async () => {
      const userId = localStorage.getItem('aura_userId');
      if (!userId) return navigate('/');

      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const pc = new RTCPeerConnection(iceServers);
      pcRef.current = pc;

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      pc.ontrack = (event) => {
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = event.streams[0];
      };

      pc.onicecandidate = async (event) => {
        if (!event.candidate) return;

        const callSnap = await getDoc(doc(db, 'skillSwapCalls', callId));
        const data = callSnap.data();
        const targetCollection = data?.userA === userId ? 'offerCandidates' : 'answerCandidates';

        await addDoc(collection(db, 'skillSwapCalls', callId, targetCollection), {
          candidate: event.candidate.toJSON(),
          userId,
          createdAt: serverTimestamp()
        });
      };

      const callRef = doc(db, 'skillSwapCalls', callId);
      const callSnap = await getDoc(callRef);

      if (!callSnap.exists()) {
        await setDoc(callRef, {
          userA: userId,
          userB: otherUser?.userId || null,
          status: 'requested',
          createdAt: serverTimestamp()
        });
      }

      unsubCall = onSnapshot(callRef, async (snap) => {
        const data = snap.data();
        if (!data || closed) return;

        if (data.offer && pc.signalingState === 'stable' && data.userA !== userId) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await updateDoc(callRef, {
            answer: { type: answer.type, sdp: answer.sdp },
            status: 'answered'
          });
          setStatus('Answered');
        }

        if (data.answer && pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
          setStatus('Connected');
        }
      });

      const offerCandidatesQ = query(collection(db, 'skillSwapCalls', callId, 'offerCandidates'), orderBy('createdAt', 'asc'));
      const answerCandidatesQ = query(collection(db, 'skillSwapCalls', callId, 'answerCandidates'), orderBy('createdAt', 'asc'));

      unsubCandidates = onSnapshot(
        userId === callSnap.data()?.userA ? answerCandidatesQ : offerCandidatesQ,
        (snap) => {
          snap.docChanges().forEach(async (change) => {
            if (change.type === 'added') {
              await pc.addIceCandidate(new RTCIceCandidate(change.doc.data().candidate));
            }
          });
        }
      );

      if (callSnap.data()?.userA === userId && !callSnap.data()?.offer) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await updateDoc(callRef, {
          offer: { type: offer.type, sdp: offer.sdp },
          status: 'offered'
        });
        setStatus('Offered');
      }
    };

    start();

    return () => {
      closed = true;
      unsubCall && unsubCall();
      unsubCandidates && unsubCandidates();
      pcRef.current && pcRef.current.close();
      localStreamRef.current && localStreamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, [callId, navigate, otherUser]);

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar
          title="Skill Swap Video Chat"
          subtitle={`Status: ${status}`}
          onBack={() => navigate(-1)}
          theme={theme}
          setTheme={setTheme}
        />

        <div className="aura-card aura-section">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            <video ref={localVideoRef} autoPlay playsInline muted style={{ width: '100%', background: '#000', borderRadius: 12 }} />
            <video ref={remoteVideoRef} autoPlay playsInline style={{ width: '100%', background: '#000', borderRadius: 12 }} />
          </div>
        </div>
      </div>
    </div>
  );
}