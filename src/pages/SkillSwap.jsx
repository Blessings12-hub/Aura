import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  Timestamp
} from 'firebase/firestore';
import { Video } from 'lucide-react';
import { db } from '../firebase';
import { useCurrentUser } from '../hooks/useCurrentUser';
import TopBar from '../components/TopBar';
import Avatar from '../components/Avatar';

export default function SkillSwap() {
  const navigate = useNavigate();
  const { user, userId, loading } = useCurrentUser();
  const [skill, setSkill] = useState('');
  const [want, setWant] = useState('');
  const [items, setItems] = useState([]);

  useEffect(() => {
    const q = query(collection(db, 'skillSwaps'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snap) => {
      setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, []);

  const post = async () => {
    if (!userId || !skill.trim() || !want.trim()) return;

    await addDoc(collection(db, 'skillSwaps'), {
      userId,
      userAge: user?.age,
      userGender: user?.gender,
      userColor: user?.avatarColor,
      skill: skill.trim(),
      want: want.trim(),
      createdAt: Timestamp.now()
    });

    setSkill('');
    setWant('');
  };

  const startCall = (item) => {
    if (!userId || !item?.userId) return;
    const callId = [userId, item.userId].sort().join('_');
    navigate('/aura/swap/call', { state: { callId, otherUser: item } });
  };

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
          title="Skill Swap"
          subtitle="Teach what you know, learn what you want. Anonymous video calls."
          onBack={() => navigate(-1)}
        />

        <div className="aura-card aura-section">
          <h2 style={{ marginTop: 0, color: 'var(--text)' }}>Post a swap</h2>

          <input
            className="aura-input"
            value={skill}
            onChange={(e) => setSkill(e.target.value)}
            placeholder="I can teach… (Python, guitar, cooking)"
            style={{ marginBottom: 12 }}
          />

          <input
            className="aura-input"
            value={want}
            onChange={(e) => setWant(e.target.value)}
            placeholder="I want to learn… (Spanish, drawing, marketing)"
            style={{ marginBottom: 12 }}
          />

          <button
            type="button"
            onClick={post}
            disabled={!skill.trim() || !want.trim()}
            className="aura-btn aura-btn-primary"
          >
            Post swap
          </button>
        </div>

        <div className="aura-section">
          <h2 style={{ color: 'var(--text)', marginBottom: 12 }}>
            Available swaps ({items.length})
          </h2>

          {items.length === 0 ? (
            <div className="aura-card" style={{ textAlign: 'center' }}>
              <p className="aura-muted">No swaps yet. Be the first to post.</p>
            </div>
          ) : (
            <div className="aura-grid">
              {items.map((item) => (
                <div key={item.id} className="aura-card-compact">
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      marginBottom: 12
                    }}
                  >
                    <Avatar color={item.userColor} size={36} />
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ color: 'var(--text)' }}>
                        Person {item.userId?.slice(0, 6)}
                      </strong>
                      <span className="aura-muted" style={{ fontSize: '0.85rem', marginLeft: 6 }}>
                        {item.userAge} • {item.userGender}
                      </span>
                    </div>
                  </div>

                  <p style={{ margin: '0 0 6px', color: 'var(--text)' }}>
                    <strong style={{ color: 'var(--warning)' }}>Teaches:</strong> {item.skill}
                  </p>

                  <p style={{ margin: '0 0 12px', color: 'var(--text)' }}>
                    <strong style={{ color: 'var(--success)' }}>Wants:</strong> {item.want}
                  </p>

                  {item.userId !== userId && (
                    <button
                      type="button"
                      onClick={() => startCall(item)}
                      className="aura-btn aura-btn-primary"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      <Video size={16} /> Start video chat
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}