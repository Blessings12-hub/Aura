import { useState, useEffect } from 'react';

export default function InstallPrompt() {
  const [showPrompt, setShowPrompt] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  useEffect(() => {
    const isInstalled = window.matchMedia('(display-mode: standalone)').matches;
    if (isInstalled) return;

    const hasDismissed = localStorage.getItem('aura-install-prompt-dismissed');
    if (hasDismissed) return;

    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setTimeout(() => setShowPrompt(true), 5000);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`User response to install prompt: ${outcome}`);
      setDeferredPrompt(null);
      setShowPrompt(false);
    } catch (error) {
      console.error('Install prompt error:', error);
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    localStorage.setItem('aura-install-prompt-dismissed', 'true');
  };

  if (!showPrompt) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      backgroundColor: '#4F46E5',
      color: 'white',
      padding: '1.5rem',
      borderRadius: '12px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
      zIndex: 1000,
      maxWidth: '90%',
      width: '400px',
      display: 'flex',
      flexDirection: 'column',
      gap: '1rem'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
        <div>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
            Install Aura 📱
          </h3>
          <p style={{ fontSize: '0.875rem', opacity: 0.9 }}>
            Get Aura on your home screen for quick access to chatting, matching, events, and more!
          </p>
        </div>
        <button
          onClick={handleDismiss}
          style={{
            background: 'none',
            border: 'none',
            color: 'white',
            fontSize: '1.5rem',
            cursor: 'pointer',
            padding: '0'
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button
          onClick={handleInstallClick}
          style={{
            flex: 1,
            backgroundColor: 'white',
            color: '#4F46E5',
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            border: 'none',
            fontWeight: 'bold',
            cursor: 'pointer',
            fontSize: '0.875rem'
          }}
        >
          Install Now
        </button>
        <button
          onClick={handleDismiss}
          style={{
            flex: 1,
            backgroundColor: 'transparent',
            color: 'white',
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            border: '1px solid white',
            cursor: 'pointer',
            fontSize: '0.875rem'
          }}
        >
          Not Now
        </button>
      </div>
    </div>
  );
}