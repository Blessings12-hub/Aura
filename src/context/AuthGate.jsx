import {
  createContext, useContext, useEffect, useMemo, useState,
} from 'react';
import { firebaseConfigured, ensureFirebaseSession, observeFirebaseAuth } from '../lib/firebaseClient';
import SplashScreen from '../components/SplashScreen';

// ---------------------------------------------------------------------------
// The gate that wasn't a gate.
//
// This file used to say `const [ready] = useState(true)` — a leftover from
// the Appwrite days — which meant AuthGate rendered its children instantly
// and never actually waited for anything. Every screen underneath it,
// including PresenceRoot's heartbeat write and Home's online-count query,
// started hitting Firestore before Firebase had a signed-in user. Since
// firestore.rules requires `request.auth != null` on essentially every
// collection, those first reads and writes came back as
// "Missing or insufficient permissions."
//
// Now it genuinely blocks on ensureFirebaseSession() and publishes the
// resolved uid through context, so nothing downstream has to start its own
// sign-in or guess when auth is ready.
// ---------------------------------------------------------------------------
const AuthContext = createContext({ uid: null, ready: false, error: null });

export function useAuthContext() {
  return useContext(AuthContext);
}

export default function AuthGate({ children }) {
  const [uid, setUid] = useState(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!firebaseConfigured) { setReady(true); return undefined; }

    let active = true;

    ensureFirebaseSession()
      .then((user) => { if (active) setUid(user?.uid || null); })
      .catch((err) => {
        console.error('Firebase session failed', err);
        if (active) setError(err);
      })
      .finally(() => { if (active) setReady(true); });

    // Keeps the shared uid correct after a Google link/recovery or a sign-out,
    // without any screen needing its own auth listener.
    const unsubscribe = observeFirebaseAuth((user) => {
      if (active) setUid(user?.uid || null);
    });

    return () => { active = false; unsubscribe?.(); };
  }, []);

  const value = useMemo(() => ({ uid, ready, error }), [uid, ready, error]);

  if (!firebaseConfigured) {
    return (
      <div className="aura-page" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <div className="aura-card" style={{ textAlign: 'center', maxWidth: 420 }}>
          <p className="aura-muted">Aura is not connected to Firebase yet. Add the VITE_FIREBASE_* variables, then reload.</p>
        </div>
      </div>
    );
  }

  // This is the important line: nothing below renders — and therefore nothing
  // below touches Firestore — until there is a real signed-in uid.
  if (!ready) return <SplashScreen />;

  if (error) {
    return (
      <div className="aura-page" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <div className="aura-card" style={{ textAlign: 'center', maxWidth: 420 }}>
          <p className="aura-muted">Aura could not start a session. Check your connection and reload.</p>
          <button
            type="button"
            className="aura-btn aura-btn-secondary"
            style={{ marginTop: 16 }}
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
