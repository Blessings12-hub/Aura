# Aura — fix: "HTTP 500" from both verification endpoints

Two files: `api/verify-selfie.js`, `api/verify-document.js`. Extract over
`Aura-main/`. No env var changes required by this patch itself — but see
below, this almost certainly points at one that needs checking.

## What "HTTP 500" actually means here

That's not a message from the server — it's the client's own fallback text
(`verificationService.js`: `detail = \`HTTP ${response.status}\`` when the
error response isn't valid JSON). Seeing it means the server crashed hard
enough to return no usable body at all, for both the selfie check and the
document upload. The same generic failure on two independent endpoints is
the signal: something they both share broke, not something specific to
either one's logic.

The one thing both files share, identically, is this, sitting at module
scope with no error handling:

```js
if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  initializeApp({ credential: cert(serviceAccount) });
}
```

If `FIREBASE_SERVICE_ACCOUNT` is missing, or its JSON is malformed, this
throws *before the handler function even exists to catch it* — Vercel
can't run the function at all and returns a bare 500 with no body. That's
exactly what "HTTP 500" with nothing else looks like from the client.

The single most common way this specific env var gets malformed: the
service account JSON's `private_key` field contains literal `\n` sequences
inside a quoted string, and pasting it through certain editors or clipboard
managers reformats or strips them, breaking the JSON (or breaking the key
itself even when the JSON still parses). Worth re-checking directly in
Vercel's dashboard — the value should be the *entire* service account JSON
file's contents as one unbroken line.

A second, separate gap made this worse: past that init block, nothing in
either handler was wrapped in a top-level try/catch either. Any Firestore
Admin SDK call failing for some other reason (wrong project ID, the service
account missing Firestore IAM permissions, Firestore not enabled in Native
mode) would crash the function the exact same opaque way.

## The fix

Both files now:
1. Wrap the init block in try/catch, storing the error instead of crashing
   the module. The handler checks this first and returns a clear, specific
   JSON error — `"Server verification setup is broken (Firebase
   credentials)..."` — instead of the whole function failing to even start.
2. Wrap the rest of the handler body (renamed to `handleVerifySelfie` /
   `handleVerifyDocument`, called from inside a try/catch in the exported
   `handler`) so any other failure also comes back as real JSON with a
   message, and gets logged server-side either way.

## What to do next

Redeploy, then try the selfie check again. One of two things happens:

- **You now see a specific message** (about Firebase credentials, or
  something else) instead of "HTTP 500" — that tells you exactly what's
  wrong and where to look.
- **It works** — meaning the credential issue above was it, and better
  error handling alone happened to route around a transient version of it.

Either way, check Vercel's function logs for `verify-selfie` and
`verify-document` after a failed attempt — I added `console.error` calls at
every failure point, so the exact underlying error (not just "500") will be
sitting there even in the case this patch can't fully diagnose on its own
without seeing your deployment.
