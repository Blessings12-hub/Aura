import { useEffect, useRef, useState } from 'react';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, collection, addDoc,
  getDocs, serverTimestamp, query, orderBy,
} from '../lib/appwriteFirestoreCompat';
import { db } from '../firebase';

// STUN alone only works when at least one side has a directly reachable
// (or easily NAT-mapped) network path — on real mobile networks and many
// home routers ("symmetric NAT"), that's just not true, and the call would
// silently never connect even though signaling looked fine. A TURN relay
// is what actually makes it work in those cases, so it's included here too.
//
// TURN credentials now come from env vars (VITE_TURN_URLS / _USERNAME /
// _CREDENTIAL — see .env.example) so a real paid provider can be dropped
// in from Vercel's Environment Variables screen without touching code.
// Until those are set, this falls back to Open Relay Project's free
// public TURN service — fine for testing/low traffic, but it's rate
// limited with no uptime guarantee, so calls can fail unpredictably once
// there's real concurrent usage. Swapping in a paid provider (Twilio,
// Cloudflare Calls, Metered.ca's paid tier, Xirsys, etc.) is the fix —
// sign up on their site, grab the static TURN username/credential and
// server URL(s) they give you, and set the three env vars below. No code
// change needed after that.
const customTurnUrls = import.meta.env.VITE_TURN_URLS;
const customTurnUsername = import.meta.env.VITE_TURN_USERNAME;
const customTurnCredential = import.meta.env.VITE_TURN_CREDENTIAL;
const hasCustomTurn = customTurnUrls && customTurnUsername && customTurnCredential;

const ICE_SERVERS = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    ...(hasCustomTurn
      ? [{
          urls: customTurnUrls.split(',').map((u) => u.trim()),
          username: customTurnUsername,
          credential: customTurnCredential,
        }]
      : [
          { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
          { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
          { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
        ]),
  ],
};

// Surfaced in the UI so you (and anyone helping you test) can tell at a
// glance which TURN service a call actually used, without digging into
// devtools — useful while you're transitioning from the free fallback to
// a real provider.
export const usingFallbackTurn = !hasCustomTurn;

const describeMediaError = (err) => {
  if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
    return 'Camera/microphone access was denied. Allow access in your browser settings and try again.';
  }
  if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
    return 'No camera or microphone was found on this device.';
  }
  if (err?.name === 'NotReadableError') {
    return 'Your camera or microphone is already in use by another app.';
  }
  return "Couldn't access your camera/microphone. Check permissions and try again.";
};

// A bare `video: true` / `audio: true` request leaves every browser to
// pick its own (low, inconsistent) default — often well under 480p and
// with no echo cancellation guaranteed. These are the actual levers for
// call quality: what resolution/framerate we ask the camera for, and what
// audio processing we ask for. `ideal` (never `min`) everywhere, so a
// device that can't hit these numbers still connects at whatever it *can*
// do instead of getUserMedia throwing an OverconstrainedError.
const VIDEO_CONSTRAINTS = {
  width: { ideal: 1280, max: 1920 },
  height: { ideal: 720, max: 1080 },
  frameRate: { ideal: 30, max: 30 },
  facingMode: 'user',
};
const AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  sampleRate: { ideal: 48000 },
  channelCount: { ideal: 1 },
};

// The other half of the story: even with a sharp local capture, WebRTC's
// per-track sender still needs headroom to actually *send* that much data.
// These raise the ceiling each sender is allowed to encode up to — real
// congestion control (bandwidth estimation) still adapts DOWN from here
// automatically on a bad connection, this just stops every browser's own
// much lower implicit starting cap from quietly holding a good connection
// back from ever reaching HD.
const MAX_VIDEO_BITRATE_BPS = 2_500_000; // ~2.5 Mbps — comfortably 720p/1080p
const MAX_AUDIO_BITRATE_BPS = 64_000; // 64 kbps Opus — "HD voice", well above the typical ~32 kbps default

// Raises one RTCRtpSender's encoding bitrate ceiling. Safe to call right
// after addTrack — doesn't need to wait for negotiation to complete.
async function applyBitrateCeiling(sender, maxBitrate) {
  if (!sender) return;
  try {
    const params = sender.getParameters();
    if (!params.encodings || !params.encodings.length) params.encodings = [{}];
    params.encodings[0].maxBitrate = maxBitrate;
    await sender.setParameters(params);
  } catch (e) {
    // Non-fatal — the call still works at whatever bitrate the browser's
    // own default ceiling allows, just without the HD+ headroom.
    console.error('Could not raise call bitrate ceiling', e);
  }
}

/**
 * Shared WebRTC 1:1 call engine used by both Skill Swap and Match Finder
 * video/audio calls.
 *
 * Fixes three real bugs found in the original implementation, any one of
 * which could be why two people couldn't reliably see/hear each other:
 *
 * 1. ICE candidates were written to Firestore subcollections named
 *    `offerCandidates`/`answerCandidates`, but the security rules only ever
 *    granted access to a subcollection named `candidates` — every single
 *    candidate write/read was silently permission-denied. Signaling (the
 *    offer/answer) still went through because that lives on the parent doc,
 *    which explains why a call could look like it was "connecting" while
 *    audio/video never actually arrived. Rules now match the real path
 *    names (see firestore.rules).
 * 2. Both peers independently decided "am I the initiator?" by checking
 *    whether the signaling doc existed yet — a genuine race: if both people
 *    opened the call around the same time, both could see "doesn't exist"
 *    and both try to create an offer, corrupting the handshake. The
 *    initiator is now decided deterministically (alphabetically-first uid),
 *    so there's never a conflict regardless of timing.
 * 3. The signaling doc was permanent per-pair, so a SECOND call between the
 *    same two people reused the first call's stale offer/answer/candidates
 *    and could never connect. Callers now pass a fresh `sessionId` (minted
 *    whenever both sides newly agree to a call), so every call gets a
 *    brand-new signaling doc.
 * 4. Candidates that arrived before the remote description was set used to
 *    be dropped (addIceCandidate throws if called too early, and the error
 *    was only logged, never retried) — a classic trickle-ICE race that
 *    silently breaks connectivity depending on timing. Early candidates are
 *    now queued and flushed right after the remote description is set.
 */
export function useVideoCall({
  collectionName, pairId, sessionId, userId, otherUid, consented, withVideo = true,
}) {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const pcRef = useRef(null);
  const streamRef = useRef(null);
  const [status, setStatus] = useState('Connecting…');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [callFailed, setCallFailed] = useState(false);
  // Bumping this re-runs the connection effect on demand (manual retry).
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!collectionName || !pairId || !sessionId || !userId || !otherUid || consented !== true) {
      return undefined;
    }
    let cancelled = false;
    let unsubCall;
    let unsubOfferCand;
    let unsubAnswerCand;
    const callId = `${pairId}_${sessionId}`;
    const callRef = doc(db, collectionName, callId);
    // Deterministic, not a race: whichever uid sorts first always makes the
    // offer for this pair, no matter who opens the call page first.
    const isInitiator = [userId, otherUid].sort()[0] === userId;
    const pendingRemoteCandidates = [];

    setStatus('Connecting…');
    setCallFailed(false);

    (async () => {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: withVideo ? VIDEO_CONSTRAINTS : false,
          audio: AUDIO_CONSTRAINTS,
        });
      } catch (err) {
        if (!cancelled) { setStatus(describeMediaError(err)); setCallFailed(true); }
        return;
      }
      if (cancelled) { stream.getTracks().forEach((tr) => tr.stop()); return; }
      streamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;
      stream.getTracks().forEach((tr) => {
        const sender = pc.addTrack(tr, stream);
        applyBitrateCeiling(sender, tr.kind === 'video' ? MAX_VIDEO_BITRATE_BPS : MAX_AUDIO_BITRATE_BPS);
      });
      pc.ontrack = (e) => { if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0]; };

      pc.oniceconnectionstatechange = () => {
        if (cancelled) return;
        const s = pc.iceConnectionState;
        if (s === 'connected' || s === 'completed') { setStatus('Connected'); setCallFailed(false); } else if (s === 'disconnected') {
          setStatus('Reconnecting…');
        } else if (s === 'failed') {
          setStatus("Call failed — check your connection and try 'Retry'.");
          setCallFailed(true);
        } else if (s === 'checking') {
          setStatus('Connecting…');
        }
      };

      const flushPendingCandidates = async () => {
        while (pendingRemoteCandidates.length) {
          const cand = pendingRemoteCandidates.shift();
          try { await pc.addIceCandidate(new RTCIceCandidate(cand)); } catch (e) { console.error('Failed to add queued ICE candidate', e); }
        }
      };

      const addOrQueueCandidate = async (candidate) => {
        if (pc.remoteDescription && pc.remoteDescription.type) {
          try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) { console.error('Failed to add ICE candidate', e); }
        } else {
          pendingRemoteCandidates.push(candidate);
        }
      };

      pc.onicecandidate = async (e) => {
        if (!e.candidate) return;
        const col = isInitiator ? 'offerCandidates' : 'answerCandidates';
        try {
          await addDoc(collection(callRef, col), { candidate: e.candidate.toJSON(), userId, createdAt: serverTimestamp() });
        } catch (err) { console.error('Failed to send ICE candidate', err); }
      };

      unsubOfferCand = onSnapshot(
        query(collection(callRef, isInitiator ? 'answerCandidates' : 'offerCandidates'), orderBy('createdAt', 'asc')),
        (s) => s.docChanges().forEach((c) => { if (c.type === 'added') addOrQueueCandidate(c.doc.data().candidate); }),
        (err) => { console.error('ICE candidate subscription failed', err); setStatus('Connection lost — check your internet and try again'); setCallFailed(true); },
      );
      // Kept as a variable name for symmetry/cleanup below even though only
      // one candidate subscription is used per side.
      unsubAnswerCand = () => {};

      const snap = await getDoc(callRef);
      if (isInitiator && !snap.exists()) {
        await setDoc(callRef, { userA: userId, userB: otherUid, createdAt: serverTimestamp(), status: 'requested' });
      }

      unsubCall = onSnapshot(callRef, async (s) => {
        const data = s.data(); if (!data) return;
        try {
          if (!isInitiator && data.offer && !pc.currentRemoteDescription) {
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            await flushPendingCandidates();
            const ans = await pc.createAnswer();
            await pc.setLocalDescription(ans);
            await updateDoc(callRef, { answer: { type: ans.type, sdp: ans.sdp }, status: 'answered' });
          }
          if (isInitiator && data.answer && !pc.currentRemoteDescription) {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            await flushPendingCandidates();
          }
        } catch (err) {
          console.error('Call signaling error', err);
          setStatus("Couldn't complete the connection — try 'Retry'.");
          setCallFailed(true);
        }
      }, (err) => { console.error('call signaling subscription failed', err); setStatus('Connection lost — check your internet and try again'); setCallFailed(true); });

      if (isInitiator) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await updateDoc(callRef, { offer: { type: offer.type, sdp: offer.sdp }, status: 'offered' });
        setStatus('Calling…');
      }
    })().catch((e) => { console.error(e); if (!cancelled) { setStatus('Could not start the call'); setCallFailed(true); } });

    return () => {
      cancelled = true;
      if (unsubCall) unsubCall();
      if (unsubOfferCand) unsubOfferCand();
      if (unsubAnswerCand) unsubAnswerCand();
      if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
      if (streamRef.current) { streamRef.current.getTracks().forEach((tr) => tr.stop()); streamRef.current = null; }
    };
  }, [collectionName, pairId, sessionId, userId, otherUid, consented, withVideo, attempt]);

  const toggleMic = () => {
    const stream = streamRef.current;
    if (!stream) return;
    const next = !micOn;
    stream.getAudioTracks().forEach((tr) => { tr.enabled = next; });
    setMicOn(next);
  };

  const toggleCamera = () => {
    const stream = streamRef.current;
    if (!stream) return;
    const next = !camOn;
    stream.getVideoTracks().forEach((tr) => { tr.enabled = next; });
    setCamOn(next);
  };

  const retry = () => setAttempt((n) => n + 1);

  // Best-effort tidy-up of this session's signaling doc + candidate
  // subcollections once the call is over — not required for correctness
  // (every call gets a fresh sessionId regardless), just housekeeping so
  // Firestore doesn't accumulate stale WebRTC junk forever.
  const cleanupSession = async () => {
    if (!collectionName || !pairId || !sessionId) return;
    const callId = `${pairId}_${sessionId}`;
    const callRef = doc(db, collectionName, callId);
    try {
      const cols = ['offerCandidates', 'answerCandidates'];
      await Promise.all(cols.map(async (col) => {
        const snap = await getDocs(collection(callRef, col));
        await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
      }));
      await deleteDoc(callRef);
    } catch (e) { console.error('Call cleanup failed (non-fatal)', e); }
  };

  return {
    localVideoRef, remoteVideoRef, status, micOn, camOn, toggleMic, toggleCamera, callFailed, retry, cleanupSession,
  };
}
