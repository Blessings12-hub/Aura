import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './i18n';
import './styles/theme.css';
import { isAbortError } from './lib/quietErrors';

// A cancelled request is not an error condition. When a page navigates away,
// a Firestore listener is torn down, or React StrictMode discards its first
// development mount, any request still in flight is aborted on purpose — and
// the browser surfaces that as an unhandled rejection reading
// "AbortError: The user aborted a request."
//
// Swallowing exactly those keeps the console honest. Everything else still
// comes through untouched, so real failures stay visible.
window.addEventListener('unhandledrejection', (event) => {
  if (isAbortError(event.reason)) event.preventDefault();
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
