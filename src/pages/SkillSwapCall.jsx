import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
import { db } from '../firebase';
import { useCurrentUser } from '../hooks/useCurrentUser';
import TopBar from '../components/TopBar';

const ICE_SERVERS = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }]
};

export default function SkillSwapCall() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const callId = state?.callId;
  const otherUser = state?.otherUser;

  const { userId, loading } = useCurrentUser();
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const [status, setStatus] = useState('Connecting…');

  useEffect(() => {
    if (loading) return undefined;
    if (!callId || !userId) {
      navigate('/aura/swap');
      return undefined;
    }

    let unsubCall;
    let unsubCandidates;
    let cancelled = false;

    const start = async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      pc.ontrack = (e) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = e.streams[0];
        }
      };

      const callRef = doc(db, 'skillSwapCalls', callId);
      let callSnap = await getDoc(callRef);
      const isInitiator = !callSnap.exists();

      if (isInitiator) {
        await setDoc(callRef, {
          userA: userId,
          userB: otherUser?.userId || null,
          status: 'requested',
          createdAt: serverTimestamp()
        });
        callSnap = await getDoc(callRef);
      }

      pc.onicecandidate = async (e) => {
        if (!e.candidate) return;
        const targetCollection = isInitiator ? 'offerCandidates' : 'answerCandidates';
        await addDoc(collection(callRef, targetCollection), {
          candidate: e.candidate.toJSON(),
          userId,
          createdAt: serverTimestamp()
        });
      };

      const candidatesQ = query(
        collection(callRef, isInitiator ? 'answerCandidates' : 'offerCandidates'),
        orderBy('createdAt', 'asc')
      );

      unsubCandidates = onSnapshot(candidatesQ, (snap) => {
        snap.docChanges().forEach(async (change) => {
          if (change.type !== 'added') return;
          try {
            await pc.addIceCandidate(new RTCIceCandidate(change.doc.data().candidate));
          } catch (err) {
            console.error('Failed to add ICE candidate', err);
          }
        });
      });

      unsubCall = onSnapshot(callRef, async (snap) => {
        const data = snap.data();
        if (!data) return;

        if (!isInitiator && data.offer && !pc.currentRemoteDescription) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await updateDoc(callRef, {
            answer: { type: answer.type, sdp: answer.sdp },
            status: 'answered'
          });
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
        await updateDoc(callRef, {
          offer: { type: offer.type, sdp: offer.sdp },
          status: 'offered'
        });
        setStatus('Calling…');
      }
    };

    start().catch((err) => {
      console.error(err);
      setStatus('Could not start the call');
    });

    return () => {
      cancelled = true;
      if (unsubCall) unsubCall();
      if (unsubCandidates) unsubCandidates();
      if (pcRef.current) pcRef.current.close();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [callId, userId, otherUser, navigate, loading]);

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar
          title="Skill Swap Call"
          subtitle={`Status: ${status}`}
          onBack={() => navigate(-1)}
        />

        <div className="aura-card aura-section">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 16
            }}
          >
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              style={{ width: '100%', background: '#000', borderRadius: 12 }}
            />
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              style={{ width: '100%', background: '#000', borderRadius: 12 }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}