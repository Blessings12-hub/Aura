import { useEffect, useState } from 'react';
import { Smartphone, X } from 'lucide-react';

const DISMISS_KEY = 'aura_install_prompt_dismissed';

export default function InstallPrompt() {
  const [show, setShow] = useState(false);
  const [deferred, setDeferred] = useState(null);

  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    if (isStandalone || localStorage.getItem(DISMISS_KEY)) return;

    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferred(e);
      setTimeout(() => setShow(true), 5000);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    setShow(false);
  };

  const dismiss = () => {
    setShow(false);
    localStorage.setItem(DISMISS_KEY, 'true');
  };

  if (!show) return null;

  return (
    <div
      role="dialog"
      aria-labelledby="install-aura-title"
      style={{
        position: 'fixed',
        bottom: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: 'var(--primary)',
        color: '#fff',
        padding: '1.25rem 1.25rem 1rem',
        borderRadius: 14,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.25)',
        zIndex: 1000,
        maxWidth: 'min(90vw, 420px)',
        width: '100%'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <Smartphone size={20} />
          <div>
            <h3 id="install-aura-title" style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>
              Install Aura
            </h3>
            <p style={{ fontSize: '0.85rem', opacity: 0.9, margin: '4px 0 0' }}>
              Add Aura to your home screen for quick access.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          style={{
            background: 'transparent',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            padding: 0,
            alignSelf: 'flex-start'
          }}
        >
          <X size={18} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button
          type="button"
          onClick={install}
          style={{
            flex: 1,
            background: '#fff',
            color: 'var(--primary)',
            padding: '0.65rem 1rem',
            borderRadius: 10,
            border: 'none',
            fontWeight: 700,
            cursor: 'pointer'
          }}
        >
          Install
        </button>

        <button
          type="button"
          onClick={dismiss}
          style={{
            flex: 1,
            background: 'transparent',
            color: '#fff',
            padding: '0.65rem 1rem',
            borderRadius: 10,
            border: '1px solid rgba(255, 255, 255, 0.6)',
            cursor: 'pointer'
          }}
        >
          Not now
        </button>
      </div>
    </div>
  );
}