import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { auth } from '../firebase';
import SplashScreen from '../components/SplashScreen';

export default function AuthGate({ children }) {
  const [ready, setReady] = useState(false);
  const [fatalError, setFatalError] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setReady(true);
        return;
      }
      // No session yet (first-ever visit, or a fully expired/cleared one).
      // Establish one now, BEFORE letting any route mount, so every
      // Firestore/Storage/RTDB call the app makes from here on has a
      // guaranteed non-null request.auth.
      try {
        await signInAnonymously(auth);
        // onAuthStateChanged will fire again with the new user and hit
        // the branch above — no need to setReady(true) here too.
      } catch (e) {
        console.error('AuthGate: anonymous sign-in failed', e);
        setFatalError(e);
        setReady(true); // let the app render anyway rather than hang forever;
        // individual pages' own error handling will surface the problem.
      }
    });
    return () => unsub();
  }, []);

  if (!ready) {
    return <SplashScreen />;
  }

  if (fatalError) {
    return (
      <div className="aura-page" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <div className="aura-card" style={{ textAlign: 'center', maxWidth: 360 }}>
          <p className="aura-muted">
            Couldn&apos;t connect. Check your internet connection and reload the page.
          </p>
        </div>
      </div>
    );
  }

  return children;
}
