// src/components/SelfieVerification.jsx
//
// One component, used from both Login.jsx and MatchFinder.jsx, so the
// camera-handling logic exists exactly once. It is entirely self-contained:
// it manages its own camera stream and result message, and needs nothing
// back from its parent, because the actual outcome (an approval) is written
// server-side and arrives back through Firestore listeners that already
// exist elsewhere — useCurrentUser's onSnapshot on users/{uid}, and
// MatchFinder's onSnapshot on verificationRequests/{uid}. This component's
// only job is to run the check and say, locally, whether it worked.
//
// HONEST ABOUT WHAT THIS IS: a live camera capture is not the same thing as
// liveness detection. Nothing here proves the photo wasn't a phone held up
// to another phone. That's a real limitation of doing this for free instead
// of through a vendor like Persona/Yoti — see the conversation that led
// here. It's mitigated, not solved, by requiring the capture to come from
// getUserMedia rather than a file picker, and by the conservative
// approval bar in api/verify-selfie.js (see that file for the reasoning).
import { useEffect, useRef, useState } from 'react';
import { captureVideoFrameAsBase64, submitSelfieCheck } from '../lib/verificationService';

const MIN_AGE = 18;

export default function SelfieVerification({ userId, age, gender }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [approved, setApproved] = useState(false);
  const [cameraUnavailable, setCameraUnavailable] = useState(false);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOn(false);
  };

  // Release the camera on unmount no matter how the component leaves —
  // navigating away mid-check should never leave the camera light on.
  useEffect(() => () => stopCamera(), []);

  const eligible = Number(age) >= MIN_AGE && !!gender;

  const startCamera = async () => {
    setError('');
    setMessage('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraUnavailable(true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
    } catch {
      // Permission denied, no camera present, or an insecure (non-HTTPS)
      // context — any of these means "fall back to the document upload"
      // rather than a dead end.
      setCameraUnavailable(true);
    }
  };

  const captureAndCheck = async () => {
    if (!videoRef.current || !userId) return;
    setChecking(true);
    setError('');
    setMessage('');
    try {
      const fileBase64 = captureVideoFrameAsBase64(videoRef.current);
      stopCamera();
      const result = await submitSelfieCheck({
        userId, fileBase64, age, gender,
      });
      if (result.approved) {
        setApproved(true);
        setMessage(result.alreadyVerified ? "You're already verified." : "You're verified! This unlocks automatically.");
      } else if (result.reason === 'no_single_face') {
        setMessage("Couldn't find a clear single face in that photo — try again, or submit an ID document below instead.");
      } else {
        setMessage("Couldn't confidently confirm your age from that photo — please submit an ID document below instead.");
      }
    } catch (err) {
      setError(err?.message || 'Could not run the selfie check.');
    } finally {
      setChecking(false);
    }
  };

  if (approved) {
    return <p role="status" className="aura-field-hint" data-testid="selfie-verify-approved">{message}</p>;
  }

  if (!eligible) {
    return (
      <p className="aura-muted" style={{ fontSize: '0.82rem' }}>
        Enter your age (18+) and gender above to try the quick selfie check.
      </p>
    );
  }

  return (
    <div className="aura-card" style={{ margin: '10px 0' }} data-testid="selfie-verify-widget">
      <p style={{ margin: '0 0 6px', fontWeight: 700 }}>Quick check (optional)</p>
      <p className="aura-muted" style={{ margin: '0 0 10px', fontSize: '0.82rem' }}>
        A live photo can confirm you&apos;re an adult in a few seconds. It only ever approves obvious, confident cases — anything less clear just falls through to the ID upload below, no harm done. The photo is never stored.
      </p>

      {cameraUnavailable && (
        <p className="aura-muted" style={{ fontSize: '0.82rem' }}>
          Camera isn&apos;t available here — no problem, use the ID upload below instead.
        </p>
      )}

      {!cameraUnavailable && !cameraOn && (
        <button type="button" className="aura-btn aura-btn-secondary" onClick={startCamera} data-testid="selfie-verify-start">
          Start quick check
        </button>
      )}

      {cameraOn && (
        <div>
          <video
            ref={videoRef}
            playsInline
            muted
            style={{
              width: '100%', maxWidth: 280, borderRadius: 12, transform: 'scaleX(-1)', background: '#000',
            }}
          />
          <div className="aura-row" style={{ marginTop: 8, gap: 8 }}>
            <button type="button" className="aura-btn aura-btn-primary" onClick={captureAndCheck} disabled={checking} data-testid="selfie-verify-capture">
              {checking ? 'Checking…' : 'Capture & check'}
            </button>
            <button type="button" className="aura-btn aura-btn-secondary" onClick={stopCamera} disabled={checking}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {message && !approved && <p role="status" className="aura-field-hint" style={{ margin: '8px 0 0' }} data-testid="selfie-verify-message">{message}</p>}
      {error && <p role="alert" className="aura-login-error" style={{ margin: '8px 0 0' }}>{error}</p>}
    </div>
  );
}
