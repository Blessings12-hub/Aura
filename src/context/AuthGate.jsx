import { useEffect, useState } from 'react';
import { ensureFirebaseSession, firebaseConfigured } from '../lib/firebaseClient';
import SplashScreen from '../components/SplashScreen';

export default function AuthGate({ children }) {
  const [ready, setReady] = useState(false);
  const [fatalError, setFatalError] = useState(null);

  useEffect(() => {
    let active = true;
    ensureFirebaseSession()
      .catch((error) => { if (active) setFatalError(error); })
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);

  if (!ready) return <SplashScreen />;
  if (fatalError || !firebaseConfigured) {
    return (
      <div className="aura-page" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <div className="aura-card" style={{ textAlign: 'center', maxWidth: 420 }}>
          <p className="aura-muted">Aura is not connected to Firebase yet. Add the VITE_FIREBASE_* variables, then reload.</p>
        </div>
      </div>
    );
  }
  return children;
}
