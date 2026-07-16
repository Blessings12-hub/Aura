
/**
 * Coloured circle representing a user.
 * Replaces the inline `<div style={{ width, height, borderRadius:'50%', background }}/>`
 * blocks scattered across every page.
 */
export default function Avatar({
  color, photoURL, size = 40, alt = '', online = false,
}) {
  // A photo (Match Finder identity, set via the profile editor) always
  // takes priority over the plain colour circle — but every existing call
  // site only ever passes `color`, so this stays a pure fallback and
  // nothing else needs to change.
  //
  // `online` is opt-in (default false) so every existing call site keeps
  // rendering exactly as before — pass it only where genuine RTDB presence
  // (see hooks/usePresence.js) is actually being tracked for that user.
  const dotSize = Math.max(8, Math.round(size * 0.28));
  const dot = online && (
    <span
      className="avatar-online-dot"
      style={{ width: dotSize, height: dotSize }}
      data-testid="avatar-online-dot"
    />
  );

  if (photoURL) {
    return (
      <span className="avatar-wrap" style={{ width: size, height: size }}>
        <img
          className="avatar avatar--photo"
          src={photoURL}
          alt={alt}
          style={{ width: size, height: size }}
        />
        {dot}
      </span>
    );
  }
  return (
    <span className="avatar-wrap" style={{ width: size, height: size }}>
      <div
        className="avatar"
        style={{
          width: size,
          height: size,
          background: color || 'var(--muted)',
          border: '2px solid var(--border)'
        }}
        aria-hidden="true"
      />
      {dot}
    </span>
  );
}