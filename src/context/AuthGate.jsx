import { useState } from 'react';
import { firebaseConfigured } from '../lib/firebaseClient';
import SplashScreen from '../components/SplashScreen';

export default function AuthGate({ children }) {
  const [ready] = useState(true);

  if (!ready) return <SplashScreen />;
  if (!firebaseConfigured) {
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
