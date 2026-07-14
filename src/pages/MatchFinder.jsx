import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  collection, addDoc, doc, setDoc, getDoc, query, orderBy, onSnapshot, Timestamp, where, updateDoc,
} from 'firebase/firestore';
import { Heart, Lock, Sparkles } from 'lucide-react';
import { db } from '../firebase';
import { subscribe } from '../lib/subscribe';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useBlockedUsers } from '../hooks/useBlockedUsers';
import TopBar from '../components/TopBar';
import PageSkeleton from '../components/PageSkeleton';
import Avatar from '../components/Avatar';

const pairId = (a, b) => [a, b].sort().join('_');

export default function MatchFinder() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, userId, loading } = useCurrentUser();
  const blockedUsers = useBlockedUsers(userId);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [hobbies, setHobbies] = useState('');
  const [lookingFor, setLookingFor] = useState('');
  const [profiles, setProfiles] = useState([]);
  const [matches, setMatches] = useState({}); // pairId -> {status, theirId, isInitiator}
  const [loadError, setLoadError] = useState('');
  // Per-pairId "is this request in flight right now" so the button can
  // show real feedback (spinner/disabled) instead of doing nothing
  // visible while the write is in progress.
  const [pendingActions, setPendingActions] = useState({});
  const [actionError, setActionError] = useState('');
  // Identity (age/gender) for people we've actually matched with, fetched
  // separately from userIdentities/{uid} — never bundled into the public
  // card, so it's never sent to a browser until a real match exists.
  const [identities, setIdentities] = useState({}); // uid -> {age, gender}

  // Prefill the name field from any identity doc the person already has
  // (e.g. they posted a card before), so re-posting doesn't force retyping.
  useEffect(() => {
    if (!userId) return;
    getDoc(doc(db, 'userIdentities', userId)).then((snap) => {
      const name = snap.exists() ? snap.data()?.displayName : null;
      if (name) setDisplayName(name);
    }).catch(() => {});
  }, [userId]);

  useEffect(() => {
    const q = query(collection(db, 'matchProfiles'), orderBy('createdAt', 'desc'));
    return subscribe(
      q,
      (snap) => setProfiles(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => setLoadError(`Profiles could not be loaded. (${err?.code || 'unknown'}: ${err?.message || err})`),
      'match profiles',
    );
  }, []);

  // listen to matches where I'm involved
  useEffect(() => {
    if (!userId) return undefined;
    const unsubA = subscribe(
      query(collection(db, 'matchPairs'), where('userA', '==', userId)),
      (snap) => {
        const map = {};
        snap.docs.forEach((d) => { const data = d.data(); map[d.id] = { ...data, isInitiator: true, theirId: data.userB }; });
        setMatches((prev) => ({ ...prev, ...map }));
      },
      (err) => setLoadError(`Matches could not be loaded. (${err?.code || 'unknown'}: ${err?.message || err})`),
      'match pairs (as userA)',
    );
    const unsubB = subscribe(
      query(collection(db, 'matchPairs'), where('userB', '==', userId)),
      (snap) => {
        const map = {};
        snap.docs.forEach((d) => { const data = d.data(); map[d.id] = { ...data, isInitiator: false, theirId: data.userA }; });
        setMatches((prev) => ({ ...prev, ...map }));
      },
      (err) => setLoadError(`Matches could not be loaded. (${err?.code || 'unknown'}: ${err?.message || err})`),
      'match pairs (as userB)',
    );
    return () => { unsubA(); unsubB(); };
  }, [userId]);

  // Once a pair becomes 'matched', fetch the other person's identity doc.
  // Firestore rules only allow this read once matchPairs status === 'matched',
  // so this genuinely fails (silently, per onSnapshot's error handling) for
  // anyone who tries to fetch it before a real match — not just hidden by UI.
  useEffect(() => {
    if (!userId) return undefined;
    const unsubs = Object.values(matches)
      .filter((m) => m.status === 'matched' && m.theirId && !identities[m.theirId])
      .map((m) => onSnapshot(
        doc(db, 'userIdentities', m.theirId),
        (snap) => {
          if (snap.exists()) {
            setIdentities((prev) => ({ ...prev, [m.theirId]: snap.data() }));
          }
        },
        () => { /* not matched yet or no permission — expected, ignore */ },
      ));
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, userId]);

  const post = async () => {
    if (!userId || !displayName.trim() || !bio.trim() || !hobbies.trim() || !lookingFor.trim()) return;
    // Public card: NO age/gender/name here. This is enforced both here and
    // by Firestore rules (matchProfiles create rule rejects age/gender
    // fields) — the card that's browsable by everyone stays anonymous.
    await addDoc(collection(db, 'matchProfiles'), {
      userId, avatarColor: user?.avatarColor,
      bio: bio.trim(), hobbies: hobbies.trim(), lookingFor: lookingFor.trim(),
      createdAt: Timestamp.now(),
    });
    // Identity (name, age, gender) lives in its own doc, keyed by uid, only
    // readable by the owner or a matched partner (see firestore.rules) —
    // this is the "dating account" info that unlocks only after a match.
    await setDoc(doc(db, 'userIdentities', userId), {
      displayName: displayName.trim(), age: user?.age, gender: user?.gender,
    }, { merge: true });
    setBio(''); setHobbies(''); setLookingFor('');
  };

  const requestMatch = async (other) => {
    if (!userId || !other?.userId || other.userId === userId) return;
    const id = pairId(userId, other.userId);
    if (pendingActions[id]) return; // already in flight — ignore double-taps
    setActionError('');
    setPendingActions((prev) => ({ ...prev, [id]: true }));
    try {
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
    } catch (err) {
      // This is the fix for "the button doesn't work" — previously any
      // failure here (permission error, network blip, anything) failed
      // completely silently. Now it's visible and the button re-enables.
      setActionError(`Couldn't send that request. (${err?.code || 'unknown'}: ${err?.message || err})`);
    } finally {
      setPendingActions((prev) => { const next = { ...prev }; delete next[id]; return next; });
    }
  };

  const getMatchState = (other) => {
    const id = pairId(userId, other.userId);
    const m = matches[id];
    if (!m) return { status: 'none', id };
    return { status: m.status === 'matched' ? 'matched' : (m.userAAccepted && m.userBAccepted ? 'matched' : 'pending'), id, ...m };
  };

  if (loading || !user) return <PageSkeleton />;

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar title={t('match_finder')} subtitle={t('match_finder_desc')} onBack={() => navigate(-1)} />

        <div className="aura-card aura-section fade-in">
          <h2 className="aura-title">{t('match_create_card')}</h2>
          <input className="aura-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={t('display_name_ph')} maxLength={40} data-testid="match-name" />
          <input className="aura-input" value={bio} onChange={(e) => setBio(e.target.value)} placeholder={t('bio')} maxLength={300} data-testid="match-bio" />
          <input className="aura-input" value={hobbies} onChange={(e) => setHobbies(e.target.value)} placeholder={t('hobbies')} maxLength={300} data-testid="match-hobbies" />
          <input className="aura-input" value={lookingFor} onChange={(e) => setLookingFor(e.target.value)} placeholder={t('looking_for')} maxLength={300} data-testid="match-looking" />
          <p className="aura-muted" style={{ fontSize: '0.82rem', margin: '2px 0 10px' }}>{t('match_identity_hint')}</p>
          <button type="button" onClick={post} disabled={!displayName.trim() || !bio.trim() || !hobbies.trim() || !lookingFor.trim()} className="aura-btn aura-btn-primary" data-testid="match-post-btn">{t('post_card')}</button>
        </div>

        <h2 className="aura-title">{t('available_matches')} ({profiles.length})</h2>
        {loadError && <p className="aura-login-error" data-testid="match-load-error">{loadError}</p>}
        {actionError && <p className="aura-login-error" data-testid="match-action-error">{actionError}</p>}
        <div className="match-deck">
          {profiles.filter((p) => p.userId !== userId && !blockedUsers.has(p.userId)).map((p, i) => {
            const state = getMatchState(p);
            const matched = state.status === 'matched';
            const identity = matched ? identities[p.userId] : null;
            return (
              <div key={p.id} className={`match-card fade-in delay-${Math.min(i, 3)} ${matched ? '' : 'match-locked'}`} data-testid={`match-card-${p.id}`}>
                <div className="aura-row" style={{ gap: 14 }}>
                  <Avatar color={p.avatarColor} size={56} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="aura-row" style={{ gap: 8 }}>
                      <strong>
                        {matched
                          ? (identity ? `${identity.displayName || 'Person ' + p.userId?.slice(0, 6)} • ${identity.age} • ${identity.gender}` : t('loading'))
                          : t('anonymous_profile')}
                      </strong>
                      {!matched && <span className="chip"><Lock size={12} /> locked</span>}
                      {matched && <span className="chip" style={{ color: 'var(--success)' }}><Sparkles size={12} /> matched</span>}
                    </div>
                    {matched ? (
                      <>
                        <p className="aura-muted" style={{ margin: '6px 0 0' }}><strong>Hobbies:</strong> {p.hobbies}</p>
                        <p className="aura-muted" style={{ margin: '4px 0 0' }}><strong>Looking for:</strong> {p.lookingFor}</p>
                      </>
                    ) : (
                      <p className="aura-muted" style={{ margin: '6px 0 0' }}>{p.bio?.slice(0, 70)}{p.bio?.length > 70 ? '…' : ''}</p>
                    )}
                  </div>
                </div>

                <div className="aura-row" style={{ marginTop: 8 }}>
                  {matched ? (
                    <button type="button" onClick={() => navigate(`/aura/match/chat/${pairId(userId, p.userId)}`, { state: { profile: p } })} className="aura-btn aura-btn-primary" data-testid={`open-chat-${p.id}`}><Heart size={14} /> {t('start_chat')}</button>
                  ) : state.status === 'pending' ? (
                    <button type="button" onClick={() => requestMatch(p)} disabled={!!pendingActions[state.id]} className="aura-btn aura-btn-secondary" data-testid={`pending-${p.id}`}>{pendingActions[state.id] ? t('loading') : (state.isInitiator ? t('match_pending') : `${t('accept')} ${t('match_finder')}`)}</button>
                  ) : (
                    <button type="button" onClick={() => requestMatch(p)} disabled={!!pendingActions[state.id]} className="aura-btn aura-btn-primary" data-testid={`request-${p.id}`}><Heart size={14} /> {pendingActions[state.id] ? t('loading') : t('request_match')}</button>
                  )}
                </div>
              </div>
            );
          })}
          {profiles.filter((p) => p.userId !== userId && !blockedUsers.has(p.userId)).length === 0 && (
            <div className="aura-card" style={{ textAlign: 'center' }}><p className="aura-muted">{t('empty_no_matches')}</p></div>
          )}
        </div>
      </div>
    </div>
  );
}
