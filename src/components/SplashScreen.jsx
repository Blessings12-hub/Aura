// Shown once, the moment the app opens, while Firebase auth is still
// resolving — the same job Instagram/WhatsApp's logo-on-launch does.
// Distinct from PageSkeleton (which is a per-page shimmer placeholder used
// AFTER the app has already opened, e.g. navigating into Mood Chat).
export default function SplashScreen() {
  return (
    <div className="aura-splash" role="status" aria-live="polite" data-testid="splash-screen">
      <img
        src="/icon-512.png"
        alt="Aura"
        width={104}
        height={104}
        className="aura-splash__mark"
      />
      <span className="aura-splash__word">Aura</span>
    </div>
  );
}
