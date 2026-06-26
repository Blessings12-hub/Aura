import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { doc, getDoc, collection, addDoc, onSnapshot, query, orderBy, Timestamp } from 'firebase/firestore';
import TopBar from '../components/TopBar';

export default function SkillSwap({ theme, setTheme }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [skill, setSkill] = useState('');
  const [want, setWant] = useState('');
  const [items, setItems] = useState([]);

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

  useEffect(() => {
    const qref = query(collection(db, 'skillSwaps'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(qref, (snap) => setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return () => unsub();
  }, []);

  const postSwap = async () => {
    const userId = localStorage.getItem('aura_userId');
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

  const startVideoCall = async (item) => {
    const userId = localStorage.getItem('aura_userId');
    if (!userId || !item?.userId) return;

    const callId = [userId, item.userId].sort().join('_');
    navigate('/aura/swap/call', { state: { callId, otherUser: item } });
  };

  if (!user) return <div className="aura-page"><div className="aura-shell"><div className="aura-card">Loading...</div></div></div>;

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar
          title="Skill Swap"
          subtitle="Exchange skills anonymously. Teach what you know, learn what you want."
          onBack={() => navigate(-1)}
          theme={theme}
          setTheme={setTheme}
        />

        <div className="aura-card aura-section">
          <h2 style={{ color: 'var(--text)', marginBottom: '1rem' }}>Post Your Skill Swap</h2>
          <input className="aura-input" value={skill} onChange={(e) => setSkill(e.target.value)} placeholder="I can teach e.g., Python, Guitar, Cooking" style={{ marginBottom: 14 }} />
          <input className="aura-input" value={want} onChange={(e) => setWant(e.target.value)} placeholder="I want to learn e.g., Spanish, Drawing, Marketing" style={{ marginBottom: 14 }} />
          <button onClick={postSwap} className="aura-btn aura-btn-primary">
            Post Swap
          </button>
        </div>

        <div className="aura-section">
          <h2 style={{ color: 'var(--text)', marginBottom: '1rem' }}>Available Swaps ({items.length})</h2>
          {items.length === 0 ? (
            <div className="aura-card" style={{ textAlign: 'center' }}>
              <p className="aura-muted">No swaps yet. Be the first to post!</p>
            </div>
          ) : (
            <div className="aura-grid">
              {items.map((item) => (
                <div key={item.id} className="aura-card-compact">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: item.userColor || '#ddd' }} />
                    <strong style={{ color: 'var(--text)' }}>Person {item.userId?.slice(0, 6)}</strong>
                    <span style={{ color: 'var(--muted)', marginLeft: 8 }}>{item.userAge} • {item.userGender}</span>
                  </div>

                  <div style={{ marginBottom: 8 }}>
                    <strong style={{ color: 'var(--warning)' }}>Teaches:</strong> {item.skill}
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <strong style={{ color: 'var(--success)' }}>Wants:</strong> {item.want}
                  </div>

                  {item.userId !== localStorage.getItem('aura_userId') && (
                    <button onClick={() => startVideoCall(item)} className="aura-btn aura-btn-primary">
                      Start Video Chat
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <button onClick={() => navigate('/aura')} className="aura-btn aura-btn-secondary aura-section">
            Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}