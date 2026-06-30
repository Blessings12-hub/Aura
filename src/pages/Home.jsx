import { useNavigate } from 'react-router-dom';
import { ACTIVITIES } from '../constants/activities';
import { useCurrentUser } from '../hooks/useCurrentUser';
import TopBar from '../components/TopBar';

export default function Home() {
  const navigate = useNavigate();
  const { user, loading } = useCurrentUser();

  if (loading || !user) {
    return (
      <div className="aura-page">
        <div className="aura-shell">
          <div className="aura-card">Loading…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar
          title="Welcome to Aura"
          subtitle="Six daily activities. Anonymous. Resets every 24 hours."
        />

        <div className="aura-grid">
          {ACTIVITIES.map((activity) => (
            <button
              key={activity.id}
              type="button"
              onClick={() => navigate(activity.route)}
              className="aura-card activity-card"
              aria-label={`Open ${activity.title}`}
            >
              <div
                className="activity-card__icon"
                style={{ background: activity.color }}
                aria-hidden="true"
              >
                <span style={{ fontWeight: 800 }}>{activity.title.charAt(0)}</span>
              </div>

              <div>
                <h3
                  style={{
                    margin: 0,
                    color: 'var(--text)',
                    fontSize: '1.25rem',
                    fontWeight: 700
                  }}
                >
                  {activity.title}
                </h3>
                <p
                  style={{
                    color: 'var(--muted)',
                    fontSize: '0.95rem',
                    lineHeight: 1.5,
                    margin: '6px 0 0'
                  }}
                >
                  {activity.description}
                </p>
              </div>

              <span className="activity-card__cta" style={{ background: activity.color }}>
                Open
              </span>
            </button>
          ))}
        </div>

        <div className="aura-card aura-section" style={{ textAlign: 'center' }}>
          <p className="aura-muted" style={{ margin: 0, lineHeight: 1.7 }}>
            Everything disappears after 24 hours. No profiles, no history, just presence. Age and
            gender are visible for matching; identity stays anonymous.
          </p>
        </div>
      </div>
    </div>
  );
}