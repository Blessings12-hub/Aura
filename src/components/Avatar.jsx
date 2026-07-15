
/**
 * Coloured circle representing a user.
 * Replaces the inline `<div style={{ width, height, borderRadius:'50%', background }}/>`
 * blocks scattered across every page.
 */
export default function Avatar({ color, photoURL, size = 40, alt = '' }) {
  // A photo (Match Finder identity, set via the profile editor) always
  // takes priority over the plain colour circle — but every existing call
  // site only ever passes `color`, so this stays a pure fallback and
  // nothing else needs to change.
  if (photoURL) {
    return (
      <img
        className="avatar avatar--photo"
        src={photoURL}
        alt={alt}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
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
  );
}