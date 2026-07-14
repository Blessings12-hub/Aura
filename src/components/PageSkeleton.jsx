// A shimmering placeholder shown while a page's data is still loading,
// instead of a bare "Loading…" text card. Same aura-page/aura-shell
// wrapper as every real page so there's no layout jump when the real
// content replaces it.
export default function PageSkeleton() {
  return (
    <div className="aura-page">
      <div className="aura-shell">
        <div className="aura-card aura-section fade-in" aria-busy="true" data-testid="page-skeleton">
          <div className="skeleton-line" style={{ width: '40%', height: 20, marginBottom: 16 }} />
          <div className="skeleton-line" style={{ width: '92%', height: 14, marginBottom: 10 }} />
          <div className="skeleton-line" style={{ width: '78%', height: 14, marginBottom: 10 }} />
          <div className="skeleton-line" style={{ width: '60%', height: 14 }} />
        </div>
      </div>
    </div>
  );
}
