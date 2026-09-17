// src/lib/quietErrors.js
//
// Some errors are real bugs. Some are just the browser telling you a request
// you no longer care about was cancelled — a Firestore listener torn down on
// navigation, a fetch interrupted by a page unload, React StrictMode mounting
// a component twice in development and immediately discarding the first copy.
//
// Those show up as "AbortError: The user aborted a request." and there is
// nothing to fix in them; the request was supposed to stop. They're worth
// filtering out so they don't bury the errors that DO matter.
//
// Note the deliberate narrowness: this only ever matches abort/cancellation.
// A permission-denied, an unavailable backend, or a bad query still logs
// loudly, because those are real.

export function isAbortError(error) {
  if (!error) return false;
  if (error.name === 'AbortError') return true;
  if (error.code === 'ABORT_ERR') return true;
  const message = String(error.message || error);
  return /aborted a request|operation was aborted|AbortError/i.test(message);
}

export function isCancellation(error) {
  if (isAbortError(error)) return true;
  // Firestore's own code for "you unsubscribed / we tore the stream down".
  return error?.code === 'cancelled';
}

// Logs an error unless it's just cancellation noise.
export function logUnlessCancelled(label, error) {
  if (isCancellation(error)) return;
  console.error(label, error);
}
