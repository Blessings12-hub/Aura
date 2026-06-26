import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import TopBar from '../components/TopBar';

const activities = [
  { id: 1, title: 'Mood Chat', description: 'Anonymous chat by mood + age + gender', icon: '💬', color: '#4F46E5', route: '/aura/chat' },
  { id: 2, title: 'Collab Studio', description: 'Draw together on the same canvas', icon: '🎨', color: '#EC4899', route: '/aura/collab' },
  { id: 3, title: 'Daily Question', description: 'Answer + see local anonymous answers', icon: '💡', color: '#10B981', route: '/aura/question' },
  { id: 4, title: 'Skill Swap', description: 'Exchange skills, video chat anonymously', icon: '🔄', color: '#F59E0B', route: '/aura/swap' },
  { id: 5, title: 'Event Buddy', description: 'Find anonymous event partners', icon: '📅', color: '#3B82F6', route: '/aura/event' },
  { id: 6, title: 'Match Finder', description: 'Dating matches. Anonymous profiles. Swipe to like.', icon: '❤️', color: '#EF4444', route: '/aura/match' }
];

export default function Home({ theme, setTheme }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);

  useEffect(() => {
    const loadUser = async () => {
      const userId = localStorage.getItem('aura_userId');
      if (!userId) return navigate('/');
      const userDoc = await getDoc(doc(db, 'users', userId));
      if (userDoc.exists()) setUser(userDoc.data());
      else navigate('/');
    };
    loadUser();
  }, [navigate]);

  if (!user) return <div style={{ padding: 24 }}>Loading...</div>;

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar
          title="Welcome to Aura"
          subtitle="6 daily activities. Anonymous. Resets every 24 hours."
          theme={theme}
          setTheme={setTheme}
        />

        <div className="aura-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          {activities.map((activity) => (
            <button
              key={activity.id}
              onClick={() => navigate(activity.route)}
              className="aura-card"
              style={{
                border: 'none',
                textAlign: 'center',
                minHeight: '320px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <div style={{ fontSize: '4rem', marginBottom: '1.5rem', color: activity.color, background: `${activity.color}15`, width: '100px', height: '100px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {activity.icon}
              </div>
              <h3 style={{ fontSize: '1.5rem', marginBottom: '0.75rem', color: 'var(--text)', fontWeight: 700 }}>{activity.title}</h3>
              <p style={{ color: 'var(--muted)', fontSize: '0.95rem', lineHeight: 1.5, marginBottom: '1.5rem' }}>{activity.description}</p>
              <div style={{ background: activity.color, color: '#fff', padding: '0.75rem 2rem', borderRadius: '8px', fontSize: '0.9rem', fontWeight: 600 }}>Join</div>
            </button>
          ))}
        </div>

        <div className="aura-card" style={{ textAlign: 'center', marginTop: '5rem' }}>
          <div style={{ fontSize: '2rem', color: '#4F46E5', marginBottom: '1rem' }}>🫧</div>
          <p style={{ color: 'var(--muted)', fontSize: '1rem', lineHeight: 1.6 }}>Everything disappears after 24 hours.</p>
          <p style={{ color: 'var(--muted)', fontSize: '1rem', lineHeight: 1.6 }}>No profiles. No history. Just presence.</p>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', lineHeight: 1.5 }}>Age + gender visible for matching. 100% anonymous identity.</p>
        </div>
      </div>
    </div>
  );
}