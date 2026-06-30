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
import { db } from '../firebase';
import { useCurrentUser } from '../hooks/useCurrentUser';
import TopBar from '../components/TopBar';
import Avatar from '../components/Avatar';

export default function MatchFinder() {
  const navigate = useNavigate();
  const { user, userId, loading } = useCurrentUser();
  const [bio, setBio] = useState('');
  const [hobbies, setHobbies] = useState('');
  const [lookingFor, setLookingFor] = useState('');
  const [profiles, setProfiles] = useState([]);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    const q = query(collection(db, 'matchProfiles'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snap) => {
      setProfiles(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, []);

  const post = async () => {
    if (!userId || !bio.trim() || !hobbies.trim() || !lookingFor.trim()) return;

    await addDoc(collection(db, 'matchProfiles'), {
      userId,
      age: user?.age,
      gender: user?.gender,
      avatarColor: user?.avatarColor,
      bio: bio.trim(),
      hobbies: hobbies.trim(),
      lookingFor: lookingFor.trim(),
      createdAt: Timestamp.now()
    });

    setBio('');
    setHobbies('');
    setLookingFor('');
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
          title="Match Finder"
          subtitle="Post a card, browse other people, reveal, then chat 1:1."
          onBack={() => navigate(-1)}
        />

        <div className="aura-card aura-section">
          <h2 style={{ marginTop: 0, color: 'var(--text)' }}>Create your card</h2>

          <input
            className="aura-input"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Short bio"
            style={{ marginBottom: 12 }}
          />

          <input
            className="aura-input"
            value={hobbies}
            onChange={(e) => setHobbies(e.target.value)}
            placeholder="Hobbies, separated by commas"
            style={{ marginBottom: 12 }}
          />

          <input
            className="aura-input"
            value={lookingFor}
            onChange={(e) => setLookingFor(e.target.value)}
            placeholder="What you're looking for"
            style={{ marginBottom: 12 }}
          />

          <button
            type="button"
            onClick={post}
            disabled={!bio.trim() || !hobbies.trim() || !lookingFor.trim()}
            className="aura-btn aura-btn-primary"
          >
            Post card
          </button>
        </div>

        <div className="aura-section">
          <h2 style={{ color: 'var(--text)', marginBottom: 12 }}>
            People to match with ({profiles.length})
          </h2>

          <div className="aura-grid">
            {profiles.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelected(p)}
                className="aura-card"
                style={{ border: 'none', textAlign: 'left', cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <Avatar color={p.avatarColor} size={52} />
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ color: 'var(--text)', fontSize: '1.05rem' }}>
                      {p.age} • {p.gender}
                    </strong>
                    <p
                      style={{
                        margin: '4px 0 0',
                        color: 'var(--muted)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical'
                      }}
                    >
                      {p.bio}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {selected && (
          <div className="aura-card aura-section">
            <h2 style={{ color: 'var(--text)', marginTop: 0 }}>Profile reveal</h2>

            <div
              style={{
                display: 'flex',
                gap: 20,
                alignItems: 'center',
                flexWrap: 'wrap'
              }}
            >
              <Avatar color={selected.avatarColor} size={86} />

              <div style={{ minWidth: 0 }}>
                <h3 style={{ margin: 0, color: 'var(--text)' }}>
                  {selected.age} • {selected.gender}
                </h3>
                <p className="aura-muted" style={{ margin: '6px 0' }}>
                  <strong>Hobbies:</strong> {selected.hobbies}
                </p>
                <p className="aura-muted" style={{ margin: '6px 0' }}>
                  <strong>Looking for:</strong> {selected.lookingFor}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => navigate('/aura/match/chat', { state: { profile: selected } })}
              className="aura-btn aura-btn-primary"
              style={{ marginTop: 20 }}
            >
              Start chat
            </button>
          </div>
        )}
      </div>
    </div>
  );
}