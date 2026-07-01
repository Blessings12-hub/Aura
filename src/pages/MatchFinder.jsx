import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  collection, addDoc, doc, setDoc, getDoc, query, orderBy, onSnapshot, Timestamp, where, getDocs, updateDoc,
} from 'firebase/firestore';
import { Heart, Lock, Sparkles } from 'lucide-react';
import { db } from '../firebase';
import { useCurrentUser } from '../hooks/useCurrentUser';
import TopBar from '../components/TopBar';
import Avatar from '../components/Avatar';

const pairId = (a, b) => [a, b].sort().join('_');

export default function MatchFinder() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, userId, loading } = useCurrentUser();
  const [bio, setBio] = useState('');
  const [hobbies, setHobbies] = useState('');
  const [lookingFor, setLookingFor] = useState('');
  const [profiles, setProfiles] = useState([]);
  const [matches, setMatches] = useState({}); // matchId -> {status, theirId, isInitiator}

  useEffect(() => {
    const q = query(collection(db, 'matchProfiles'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snap) => setProfiles(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }, []);

  // listen to matches where I'm involved
  useEffect(() => {
    if (!userId) return undefined;
    const unsubA = onSnapshot(query(collection(db, 'matchPairs'), where('userA', '==', userId)), (snap) => {
      const map = {};
      snap.docs.forEach((d) => { const data = d.data(); map[d.id] = { ...data, isInitiator: true, theirId: data.userB }; });
      setMatches((prev) => ({ ...prev, ...map }));
    });
    const unsubB = onSnapshot(query(collection(db, 'matchPairs'), where('userB', '==', userId)), (snap) => {
      const map = {};
      snap.docs.forEach((d) => { const data = d.data(); map[d.id] = { ...data, isInitiator: false, theirId: data.userA }; });
      setMatches((prev) => ({ ...prev, ...map }));
    });
    return () => { unsubA(); unsubB(); };
  }, [userId]);

  const post = async () => {
    if (!userId || !bio.trim() || !hobbies.trim() || !lookingFor.trim()) return;
    await addDoc(collection(db, 'matchProfiles'), {
      userId, age: user?.age, gender: user?.gender, avatarColor: user?.avatarColor,
      bio: bio.trim(), hobbies: hobbies.trim(), lookingFor: lookingFor.trim(),
      createdAt: Timestamp.now(),
    });
    setBio(''); setHobbies(''); setLookingFor('');
  };

  const requestMatch = async (other) => {
    if (!userId || !other?.userId || other.userId === userId) return;
    const id = pairId(userId, other.userId);
    const ref = doc(db, 'matchPairs', id);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        userA: userId, userB: other.userId,
        userAColor: user?.avatarColor, userBColor: other.avatarColor,
        userAAccepted: true, userBAccepted: false,
        status: 'pending',
        createdAt: Timestamp.now(),
      });
    } else {
      const data = snap.data();
      // if the other person requested first → accept
      if (data.userA === other.userId && !data.userBAccepted && userId === data.userB) {
        await updateDoc(ref, { userBAccepted: true, status: 'matched', matchedAt: Timestamp.now() });
      }
      if (data.userA === userId && !data.userAAccepted) {
        await updateDoc(ref, { userAAccepted: true });
      }
    }
  };

  const getMatchState = (other) => {
    const id = pairId(userId, other.userId);
    const m = matches[id];
    if (!m) return { status: 'none', id };
    return { status: m.status === 'matched' ? 'matched' : (m.userAAccepted && m.userBAccepted ? 'matched' : 'pending'), id, ...m };
  };

  if (loading || !user) return <div className=\"aura-page\"><div className=\"aura-shell\"><div className=\"aura-card\">{t('loading')}</div></div></div>;

  return (
    <div className=\"aura-page\">
      <div className=\"aura-shell\">
        <TopBar title={t('match_finder')} subtitle={t('match_finder_desc')} onBack={() => navigate(-1)} />

        <div className=\"aura-card aura-section fade-in\">
          <h2 className=\"aura-title\">{t('match_create_card')}</h2>
          <input className=\"aura-input\" value={bio} onChange={(e) => setBio(e.target.value)} placeholder={t('bio')} data-testid=\"match-bio\" />
          <input className=\"aura-input\" value={hobbies} onChange={(e) => setHobbies(e.target.value)} placeholder={t('hobbies')} data-testid=\"match-hobbies\" />
          <input className=\"aura-input\" value={lookingFor} onChange={(e) => setLookingFor(e.target.value)} placeholder={t('looking_for')} data-testid=\"match-looking\" />
          <button type=\"button\" onClick={post} disabled={!bio.trim() || !hobbies.trim() || !lookingFor.trim()} className=\"aura-btn aura-btn-primary\" data-testid=\"match-post-btn\">{t('post_card')}</button>
        </div>

        <h2 className=\"aura-title\">{t('available_matches')} ({profiles.length})</h2>
        <div className=\"match-deck\">
          {profiles.filter((p) => p.userId !== userId).map((p, i) => {
            const state = getMatchState(p);
            const matched = state.status === 'matched';
            return (
              <div key={p.id} className={`match-card fade-in delay-${Math.min(i, 3)} ${matched ? '' : 'match-locked'}`} data-testid={`match-card-${p.id}`}>
                <div className=\"aura-row\" style={{ gap: 14 }}>
                  <Avatar color={p.avatarColor} size={56} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className=\"aura-row\" style={{ gap: 8 }}>
                      <strong>{matched ? `${p.age} • ${p.gender}` : t('anonymous_profile')}</strong>
                      {!matched && <span className=\"chip\"><Lock size={12} /> locked</span>}
                      {matched && <span className=\"chip\" style={{ color: 'var(--success)' }}><Sparkles size={12} /> matched</span>}
                    </div>
                    {matched ? (
                      <>
                        <p className=\"aura-muted\" style={{ margin: '6px 0 0' }}><strong>Hobbies:</strong> {p.hobbies}</p>
                        <p className=\"aura-muted\" style={{ margin: '4px 0 0' }}><strong>Looking for:</strong> {p.lookingFor}</p>
                      </>
                    ) : (
                      <p className=\"aura-muted\" style={{ margin: '6px 0 0' }}>{p.bio?.slice(0, 70)}{p.bio?.length > 70 ? '…' : ''}</p>
                    )}
                  </div>
                </div>

                <div className=\"aura-row\" style={{ marginTop: 8 }}>
                  {matched ? (
                    <button type=\"button\" onClick={() => navigate(`/aura/match/chat/${pairId(userId, p.userId)}`, { state: { profile: p } })} className=\"aura-btn aura-btn-primary\" data-testid={`open-chat-${p.id}`}><Heart size={14} /> {t('start_chat')}</button>
                  ) : state.status === 'pending' ? (
                    <button type=\"button\" onClick={() => requestMatch(p)} className=\"aura-btn aura-btn-secondary\" data-testid={`pending-${p.id}`}>{state.isInitiator ? t('match_pending') : `${t('accept')} ${t('match_finder')}`}</button>
                  ) : (
                    <button type=\"button\" onClick={() => requestMatch(p)} className=\"aura-btn aura-btn-primary\" data-testid={`request-${p.id}`}><Heart size={14} /> {t('request_match')}</button>
                  )}
                </div>
              </div>
            );
          })}
          {profiles.filter((p) => p.userId !== userId).length === 0 && (
            <div className=\"aura-card\" style={{ textAlign: 'center' }}><p className=\"aura-muted\">{t('empty_no_matches')}</p></div>
          )}
        </div>
      </div>
    </div>
  );
}