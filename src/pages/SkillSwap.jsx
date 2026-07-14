import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  collection, addDoc, doc, setDoc, getDoc, query, orderBy, onSnapshot, Timestamp, where, updateDoc,
} from 'firebase/firestore';
import { Video, MessageCircle, Repeat } from 'lucide-react';
import { db } from '../firebase';
import { subscribe } from '../lib/subscribe';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useBlockedUsers } from '../hooks/useBlockedUsers';
import TopBar from '../components/TopBar';
import PageSkeleton from '../components/PageSkeleton';
import Avatar from '../components/Avatar';

const pairId = (a, b) => [a, b].sort().join('_');

export default function SkillSwap() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, userId, loading } = useCurrentUser();
  const blockedUsers = useBlockedUsers(userId);
  const [skill, setSkill] = useState('');
  const [want, setWant] = useState('');
  const [items, setItems] = useState([]);
  const [pairs, setPairs] = useState({});
  const [loadError, setLoadError] = useState('');
  const [pendingActions, setPendingActions] = useState({});
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    const q = query(collection(db, 'skillSwaps'), orderBy('createdAt', 'desc'));
    return subscribe(
      q,
      (snap) => setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => setLoadError(`Skill swaps could not be loaded. (${err?.code || 'unknown'}: ${err?.message || err})`),
      'skill swaps',
    );
  }, []);

  useEffect(() => {
    if (!userId) return undefined;
    const unsubA = subscribe(
      query(collection(db, 'swapPairs'), where('userA', '==', userId)),
      (s) => {
        const m = {}; s.docs.forEach((d) => { m[d.id] = { ...d.data(), isInitiator: true }; });
        setPairs((p) => ({ ...p, ...m }));
      },
      (err) => setLoadError(`Swap requests could not be loaded. (${err?.code || 'unknown'}: ${err?.message || err})`),
      'swap pairs (as userA)',
    );
    const unsubB = subscribe(
      query(collection(db, 'swapPairs'), where('userB', '==', userId)),
      (s) => {
        const m = {}; s.docs.forEach((d) => { m[d.id] = { ...d.data(), isInitiator: false }; });
        setPairs((p) => ({ ...p, ...m }));
      },
      (err) => setLoadError(`Swap requests could not be loaded. (${err?.code || 'unknown'}: ${err?.message || err})`),
      'swap pairs (as userB)',
    );
    return () => { unsubA(); unsubB(); };
  }, [userId]);

  const post = async () => {
    if (!userId || !skill.trim() || !want.trim()) return;
    // Anonymous by design (matches Aura's "just presence" model, and
    // firestore.rules reject age/gender fields here) — no identity data
    // on the public card.
    await addDoc(collection(db, 'skillSwaps'), {
      userId, userColor: user?.avatarColor,
      skill: skill.trim(), want: want.trim(), createdAt: Timestamp.now(),
    });
    setSkill(''); setWant('');
  };

  const requestSwap = async (item) => {
    if (!userId || item.userId === userId) return;
    const id = pairId(userId, item.userId);
    if (pendingActions[id]) return;
    setActionError('');
    setPendingActions((prev) => ({ ...prev, [id]: true }));
    try {
      const ref = doc(db, 'swapPairs', id);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, {
          userA: userId, userB: item.userId, status: 'pending',
          userAAccepted: true, userBAccepted: false,
          userAColor: user?.avatarColor, userBColor: item.userColor,
          createdAt: Timestamp.now(),
        });
      } else {
        const data = snap.data();
        const updates = {};
        if (data.userA === userId && !data.userAAccepted) updates.userAAccepted = true;
        if (data.userB === userId && !data.userBAccepted) updates.userBAccepted = true;
        const a = data.userAAccepted || updates.userAAccepted;
        const b = data.userBAccepted || updates.userBAccepted;
        if (a && b) updates.status = 'matched';
        if (Object.keys(updates).length) await updateDoc(ref, updates);
      }
    } catch (err) {
      setActionError(`Couldn't send that request. (${err?.code || 'unknown'}: ${err?.message || err})`);
    } finally {
      setPendingActions((prev) => { const next = { ...prev }; delete next[id]; return next; });
    }
  };

  if (loading || !user) return <PageSkeleton />;

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar title={t('skill_swap')} subtitle={t('skill_swap_desc')} onBack={() => navigate(-1)} />

        <div className="aura-card aura-section fade-in">
          <h2 className="aura-title">{t('post_swap')}</h2>
          <input className="aura-input" value={skill} onChange={(e) => setSkill(e.target.value)} placeholder={t('i_can_teach')} data-testid="swap-skill" />
          <input className="aura-input" value={want} onChange={(e) => setWant(e.target.value)} placeholder={t('i_want_to_learn')} data-testid="swap-want" />
          <button type="button" onClick={post} disabled={!skill.trim() || !want.trim()} className="aura-btn aura-btn-primary" data-testid="swap-post-btn"><Repeat size={16} /> {t('post_swap')}</button>
        </div>

        <h2 className="aura-title">{t('available_swaps')} ({items.length})</h2>
        {loadError && <p className="aura-login-error" data-testid="swap-load-error">{loadError}</p>}
        {actionError && <p className="aura-login-error" data-testid="swap-action-error">{actionError}</p>}
        {items.length === 0 ? (
          <div className="aura-card" style={{ textAlign: 'center' }}><p className="aura-muted">{t('empty_no_swaps')}</p></div>
        ) : (
          <div className="aura-grid">
            {items.filter((i) => i.userId !== userId && !blockedUsers.has(i.userId)).map((item) => {
              const id = pairId(userId, item.userId);
              const p = pairs[id];
              const matched = p?.userAAccepted && p?.userBAccepted;
              const pending = p && !matched;
              return (
                <div key={item.id} className="aura-card-compact fade-in" data-testid={`swap-${item.id}`}>
                  <div className="aura-row" style={{ marginBottom: 10 }}>
                    <Avatar color={item.userColor} size={36} />
                    <div><strong>Person {item.userId?.slice(0, 6)}</strong></div>
                  </div>
                  <p style={{ margin: '0 0 6px' }}><strong style={{ color: 'var(--warning)' }}>Teaches:</strong> {item.skill}</p>
                  <p style={{ margin: '0 0 12px' }}><strong style={{ color: 'var(--success)' }}>Wants:</strong> {item.want}</p>
                  {matched ? (
                    <button type="button" onClick={() => navigate(`/aura/swap/chat/${id}`, { state: { otherUser: item } })} className="aura-btn aura-btn-primary" data-testid={`swap-chat-${item.id}`}><MessageCircle size={14} /> {t('open_chat')}</button>
                  ) : pending ? (
                    <button type="button" onClick={() => requestSwap(item)} disabled={!!pendingActions[id]} className="aura-btn aura-btn-secondary" data-testid={`swap-pending-${item.id}`}>{pendingActions[id] ? t('loading') : (p.isInitiator ? t('swap_pending') : t('accept'))}</button>
                  ) : (
                    <button type="button" onClick={() => requestSwap(item)} disabled={!!pendingActions[id]} className="aura-btn aura-btn-primary" data-testid={`swap-request-${item.id}`}>{pendingActions[id] ? t('loading') : t('request_swap')}</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
