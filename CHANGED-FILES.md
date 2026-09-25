# Aura — App Check: the real fix for the rate-limit gap

One file: `src/lib/firebaseClient.js`. This is the code half of the fix —
there's a manual setup process outside the code that has to happen in a
specific order, or you can take the whole app down. Read this fully
before doing anything in the Firebase Console.

## What this actually fixes

`useSendCooldown.js` already says it plainly in its own comment: the
message-send throttle is client-side only, and "anyone calling the
Firestore SDK directly bypasses this entirely." That's true of every
write in this app, not just chat — nothing stops a script from calling
Firebase's anonymous sign-in directly (it's a public, unauthenticated
method) and then writing to Firestore as fast as the network allows,
completely outside your actual web app.

App Check closes that: once enabled, Firestore requires every client-SDK
request to prove it's coming from a real instance of your app running in
a real browser (via reCAPTCHA v3 — invisible, no puzzle for users to
solve) rather than a bare script. It doesn't replace `useSendCooldown`
for a legitimate user double-tapping send; it stops the class of abuse
that skips your UI entirely.

## Setup — four steps, in this order, do not skip the order

**1. Register a reCAPTCHA v3 site.** Go to
`google.com/recaptcha/admin/create`, choose **reCAPTCHA v3**, and add
your domain (`aura-blush-zeta.vercel.app`, and `localhost` too if you
test locally). You'll get a **Site key** and a **Secret key** — the site
key is meant to be public and goes in your code; the secret key stays in
the Firebase Console only, never in your repo.

**2. Register App Check in Firebase Console.** Your project → Build →
App Check → Apps → find your web app → Register → paste in the reCAPTCHA
**secret key** (not the site key) when asked.

**3. Add the site key to Vercel and deploy — enforcement is still OFF at
this point.** Add `VITE_RECAPTCHA_SITE_KEY` (the site key from step 1) to
Vercel's environment variables, redeploy. Nothing changes for users yet —
this file only *starts issuing* App Check tokens; nothing is rejecting
requests without one until step 4.

**4. Confirm tokens are actually flowing, THEN enable enforcement.**
Firebase Console → App Check → your app should show real request metrics
within a few minutes of normal use (open the deployed app, click around).
Once you see that traffic, THEN go to App Check → APIs → Cloud
Firestore → Enforce.

**Why the order matters this much:** enforcement is an all-or-nothing
switch for every client Firestore call in the entire app, not just chat
messages. If you enable it before step 3 is actually deployed and
confirmed working, every single Firestore read and write from every user
starts failing at once — not a message-spam fix, a full outage. Deploying
this file alone changes nothing; only the Console toggle in step 4 does.

## What this doesn't cover

This protects Firestore access through the client SDK — which is where
chat messages, profile saves, and most of the app's reads/writes happen.
It does not add App Check verification to your custom Vercel API routes
(`verify-submission.js`, `notify-report.js`, etc.) — those are already
gated by a real Firebase Auth ID token check, which is a meaningful bar
on its own, just a different one. Worth adding App Check there too as a
second layer if you want to go further, but it's not needed to close the
specific gap this patch addresses.
