export default function TopBar({ title, subtitle, onBack, theme, setTheme }) {
  return (
    <div className="aura-card" style={{ marginBottom: 20 }}>
      <div className="aura-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          {onBack && (
            <div className="aura-back">
              <button onClick={onBack}>← Back</button>
            </div>
          )}
          <h1 className="aura-title" style={{ fontSize: '2.4rem', color: 'var(--primary)' }}>{title}</h1>
          {subtitle && <p className="aura-subtitle" style={{ marginTop: 8 }}>{subtitle}</p>}
        </div>

        <button
          className="aura-btn aura-btn-secondary"
          onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
        >
          {theme === 'light' ? 'Dark mode' : 'Light mode'}
        </button>
      </div>
    </div>
  );
}