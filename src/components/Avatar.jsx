
/**
 * Coloured circle representing a user.
 * Replaces the inline `<div style={{ width, height, borderRadius:'50%', background }}/>`
 * blocks scattered across every page.
 */
export default function Avatar({ color, size = 40 }) {
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