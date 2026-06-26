import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db } from '../firebase';
import { doc, getDoc, collection, addDoc, onSnapshot, query, orderBy, Timestamp } from 'firebase/firestore';
import TopBar from '../components/TopBar';

export default function MatchFinder({ theme, setTheme }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [user, setUser] = useState(null);
  const [bio, setBio] = useState('');
  const [hobbies, setHobbies] = useState('');
  const [lookingFor, setLookingFor] = useState('');
  const [profiles, setProfiles] = useState([]);
  const [selectedProfile, setSelectedProfile] = useState(null);

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
    const qref = query(collection(db, 'matchProfiles'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(qref, (snap) => {
      setProfiles(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  const postProfile = async () => {
    const userId = localStorage.getItem('aura_userId');
    if (!userId || !bio.trim() || !hobbies.trim() || !lookingFor.trim()) return;

    await addDoc(collection(db, 'matchProfiles'), {
      userId,
      name: 'Anonymous',
      age: user?.age,
      sex: user?.gender,
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

  if (!user) return <div className="aura-page"><div className="aura-shell"><div className="aura-card">Loading...</div></div></div>;

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar
          title="Match Finder"
          subtitle="Create a profile, discover people, and reveal more after matching."
          onBack={() => navigate(-1)}
          theme={theme}
          setTheme={setTheme}
        />

        <div className="aura-card aura-section">
          <h2 style={{ marginBottom: 16, color: 'var(--text)' }}>Create Your Match Profile</h2>
          <input
            className="aura-input"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Short bio"
            style={{ marginBottom: 14 }}
          />
          <input
            className="aura-input"
            value={hobbies}
            onChange={(e) => setHobbies(e.target.value)}
            placeholder="Hobbies, separated by commas"
            style={{ marginBottom: 14 }}
          />
          <input
            className="aura-input"
            value={lookingFor}
            onChange={(e) => setLookingFor(e.target.value)}
            placeholder="Looking for"
            style={{ marginBottom: 14 }}
          />
          <button onClick={postProfile} className="aura-btn aura-btn-primary">
            Post Profile
          </button>
        </div>

        <div className="aura-section">
          <h2 style={{ color: 'var(--text)', marginBottom: 16 }}>People to Match With ({profiles.length})</h2>

          <div className="aura-grid">
            {profiles.map((profile) => (
              <button
                key={profile.id}
                onClick={() => setSelectedProfile(profile)}
                className="aura-card"
                style={{ border: 'none', textAlign: 'left', cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ width: 56, height: 56, borderRadius: '50%', background: profile.avatarColor || '#ddd' }} />
                  <div>
                    <strong style={{ color: 'var(--text)', fontSize: '1.1rem' }}>
                      {profile.name} • {profile.age} • {profile.sex}
                    </strong>
                    <p style={{ margin: '4px 0 0', color: 'var(--muted)' }}>{profile.bio}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {selectedProfile && (
          <div className="aura-card aura-section">
            <h2 style={{ color: 'var(--text)', marginBottom: 16 }}>Profile Reveal</h2>
            <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ width: 90, height: 90, borderRadius: '50%', background: selectedProfile.avatarColor || '#ddd' }} />
              <div>
                <h3 style={{ margin: 0, color: 'var(--text)' }}>{selectedProfile.name}</h3>
                <p style={{ margin: '6px 0', color: 'var(--muted)' }}>{selectedProfile.age} • {selectedProfile.sex}</p>
                <p style={{ margin: '6px 0', color: 'var(--muted)' }}><strong>Hobbies:</strong> {selectedProfile.hobbies}</p>
                <p style={{ margin: '6px 0', color: 'var(--muted)' }}><strong>Looking for:</strong> {selectedProfile.lookingFor}</p>
              </div>
            </div>

            <button
              onClick={() => navigate('/aura/match/chat', { state: { profile: selectedProfile } })}
              className="aura-btn aura-btn-primary"
              style={{ marginTop: 20 }}
            >
              Start Chat
            </button>
          </div>
        )}

        <button onClick={() => navigate('/aura')} className="aura-btn aura-btn-secondary aura-section">
          Back to Home
        </button>
      </div>
    </div>
  );
}