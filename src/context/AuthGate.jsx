import { useEffect, useState } from 'react';
import { ensureAnonymousSession, appwriteConfigured } from '../lib/appwriteClient';
import SplashScreen from '../components/SplashScreen';

export default function AuthGate({ children }) {
  const [ready, setReady] = useState(false);
  const [fatalError, setFatalError] = useState(null);

  useEffect(() => {
    let active = true;
    ensureAnonymousSession()
      .catch((error) => { if (active) setFatalError(error); })
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);

  if (!ready) return <SplashScreen />;
  if (fatalError || !appwriteConfigured) {
    return (
      <div className="aura-page" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <div className="aura-card" style={{ textAlign: 'center', maxWidth: 420 }}>
          <p className="aura-muted">Aura is not connected to Appwrite yet. Add the Appwrite variables from APPWRITE_SETUP.md, then reload.</p>
        </div>
      </div>
    );
  }
  return children;
}
