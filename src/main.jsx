
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './i18n';
import './styles/theme.css';

// Self-XSS warning — this does NOT block or detect dev tools (that's not
// possible in a browser, and not the point). It protects people from a
// real, common scam: someone on Discord/social media convinces a user to
// paste "debug code" into their own console, which silently hijacks their
// session. Same warning Facebook, Instagram, and most large sites show.
if (typeof console !== 'undefined') {
  const bigStyle = 'color:#ec4899; font-size:46px; font-weight:800; font-family:sans-serif; text-shadow: 1px 1px 0 #4F46E5;';
  const bodyStyle = 'color:#f5f5fb; font-size:16px; font-family:sans-serif;';
  console.log('%cStop!', bigStyle);
  console.log(
    '%cThis is a browser feature intended for developers. If someone told you to copy-paste something here to unlock a feature, hack an account, or "get free stuff," it is a scam and will give them access to your account.',
    bodyStyle,
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);