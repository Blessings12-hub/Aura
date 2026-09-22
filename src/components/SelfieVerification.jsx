// src/components/SelfieVerification.jsx
//
// REWORKED: this used to be a self-contained widget that captured a photo
// AND submitted it AND could get someone instantly approved on its own —
// the old "quick check" fast path. That path is retired. Verification now
// always requires both a selfie and an ID document, reviewed by a human
// or, an hour later, by AI — see api/verify-submission.js and
// api/escalate-verifications.js. There is no longer anything for a
// selfie alone to instantly decide.
//
// So this component's job shrank to exactly one thing: drive the camera,
// let the person capture a frame, and hand that frame back to whichever
// page is using it via onCapture. The parent (Login.jsx or
// MatchFinder.jsx) holds onto that captured image alongside a chosen ID
// file, and submits both together when the person is ready.
//
// Still honest about the same limitation as before: a live camera capture
// is not liveness detection. Nothing here proves the photo wasn't a phone
// held up to another screen — see the conversation that led here for the
// full reasoning on why a free selfie check can't fully close that gap.
import { useEffect, useRef, useState } from 'react';
import { captureVideoFrameAsBase64 } from '../lib/verificationService';

export default function SelfieVerification({ onCapture, captured, onRetake }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraUnavailable, setCameraUnavailable] = useState(false);
  const [error, setError] = useState('');

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOn(false);
  };

  // Release the camera on unmount no matter how the component leaves —
  // navigating away mid-capture should never leave the camera light on.
  useEffect(() => () => stopCamera(), []);

  // Attach the stream once the <video> element actually exists in the DOM
  // (it only mounts once cameraOn is true) — doing this before that point
  // used to be the bug that made the camera permanently blank; see the
  // conversation history for the full diagnosis.
  useEffect(() => {
    if (cameraOn && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch((err) => {
        console.error('selfie preview play() failed', err);
        setError('Camera opened but the preview could not start. Please try again.');
      });
    }
  }, [cameraOn]);

  const startCamera = async () => {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraUnavailable(true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      streamRef.current = stream;
      setCameraOn(true);
    } catch (err) {
      console.error('getUserMedia failed', err?.name, err?.message);
      if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
        setError('Camera permission was denied. Check your browser/site settings.');
      } else if (err?.name === 'NotFoundError') {
        setError('No camera was found on this device.');
      }
      setCameraUnavailable(true);
    }
  };

  const capture = () => {
    if (!videoRef.current) return;
    const fileBase64 = captureVideoFrameAsBase64(videoRef.current);
    stopCamera();
    onCapture(fileBase64);
  };

  if (captured) {
    return (
      <div className="aura-field">
        <p role="status" className="aura-field-hint" data-testid="selfie-captured">Selfie captured.</p>
        <button type="button" className="aura-btn aura-btn-secondary" onClick={onRetake} data-testid="selfie-retake-btn">
          Retake
        </button>
      </div>
    );
  }

  return (
    <div className="aura-field">
      {cameraUnavailable && (
        <p role="alert" className="aura-login-error" style={{ fontSize: '0.82rem' }}>
          {error || "Camera isn't available here."}
        </p>
      )}

      {!cameraUnavailable && !cameraOn && (
        <button type="button" className="aura-btn aura-btn-secondary" onClick={startCamera} data-testid="selfie-start-btn">
          Open camera
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
            <button type="button" className="aura-btn aura-btn-primary" onClick={capture} data-testid="selfie-capture-btn">
              Capture
            </button>
            <button type="button" className="aura-btn aura-btn-secondary" onClick={stopCamera}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && !cameraUnavailable && <p role="alert" className="aura-login-error" style={{ margin: '8px 0 0', fontSize: '0.82rem' }}>{error}</p>}
    </div>
  );
}
