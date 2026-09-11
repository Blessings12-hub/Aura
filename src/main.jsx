
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './i18n';
import './styles/theme.css';

// Registered here unconditionally, not only inside the notification
// opt-in flow (see src/firebase-messaging.js's requestNotificationPermission,
// which also calls register() — that's fine, it's idempotent and just
// returns the existing registration). Previously this only ever ran for
// someone who explicitly enabled push notifications, so offline caching
// silently never activated for anyone who skipped that prompt.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/firebase-messaging-sw.js').catch((err) => {
      console.error('service worker registration failed', err);
    });
  });
}


ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
