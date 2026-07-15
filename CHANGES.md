# New: branded splash screen on app launch

New file `src/components/SplashScreen.jsx` — shows your Aura logo with a
gentle "breathing" glow (fits the logo's own look) and fades in the
wordmark underneath, same idea as Instagram/WhatsApp's launch screen.

Wired into `src/context/AuthGate.jsx`, replacing the generic shimmer
skeleton for the one moment that matters most: the very first load, while
Firebase auth is still resolving. `PageSkeleton` (the shimmer) is untouched
and still used everywhere else (e.g. navigating into Mood Chat) — that's a
different job and shouldn't be replaced by a full-logo splash every time.

Respects `prefers-reduced-motion` — the animation is disabled for anyone
with that accessibility setting on.

No new files needed in `public/` — it reuses the `icon-512.png` you
already have.

## Also added: self-XSS console warning
`src/main.jsx` now logs a big "Stop!" warning to the console on load —
same thing Facebook/Instagram/most large sites do. To be clear about what
this actually does: it does NOT block or detect dev tools (not possible in
a browser). It protects people from a real scam where someone is tricked
into pasting malicious code into their own console to "unlock a feature"
or "hack" something, which actually hijacks their session.
