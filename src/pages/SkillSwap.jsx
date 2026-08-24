import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  collection, addDoc, doc, setDoc, getDoc, query, orderBy, Timestamp, where, updateDoc, deleteDoc,
} from 'firebase/firestore';
import {
  Video, MessageCircle, Repeat, X,
} from 'lucide-react';
import { db } from '../firebase';
import { sendNotification } from '../lib/sendNotification';
import { subscribe } from '../lib/subscribe';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useBlockedUsers } from '../hooks/useBlockedUsers';
import { last24HoursTimestamp } from '../lib/rollingWindow';
import { moderateText, MODERATION_MESSAGES } from '../lib/contentFilter';
import TopBar from '../components/TopBar';
import PageSkeleton from '../components/PageSkeleton';
import Avatar from '../components/Avatar';
import ReportBlockMenu from '../components/ReportBlockMenu';

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
    const q = query(
      collection(db, 'skillSwaps'),
      where('createdAt', '>=', last24HoursTimestamp()),
      orderBy('createdAt', 'desc'),
    );
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
        const m = {}; s.docs.forEach((d) => { m[d.id] = { ...d.data(), isInitiator: true, theirId: d.data().userB }; });
        setPairs((p) => ({ ...p, ...m }));
      },
      (err) => setLoadError(`Swap requests could not be loaded. (${err?.code || 'unknown'}: ${err?.message || err})`),
      'swap pairs (as userA)',
    );
    const unsubB = subscribe(
      query(collection(db, 'swapPairs'), where('userB', '==', userId)),
      (s) => {
        const m = {}; s.docs.forEach((d) => { m[d.id] = { ...d.data(), isInitiator: false, theirId: d.data().userA }; });
        setPairs((p) => ({ ...p, ...m }));
      },
      (err) => setLoadError(`Swap requests could not be loaded. (${err?.code || 'unknown'}: ${err?.message || err})`),
      'swap pairs (as userB)',
    );
    return () => { unsubA(); unsubB(); };
  }, [userId]);

  const post = async () => {
    if (!userId || !skill.trim() || !want.trim()) return;
    const moderationReason = moderateText(`${skill} ${want}`);
    if (moderationReason) {
      setLoadError(MODERATION_MESSAGES[moderationReason]);
      return;
    }
    try {
      // Anonymous by design (matches Aura's "just presence" model, and
      // firestore.rules reject age/gender fields here) — no identity data
      // on the public card.
      await addDoc(collection(db, 'skillSwaps'), {
        userId, userColor: user?.avatarColor,
        skill: skill.trim(), want: want.trim(), createdAt: Timestamp.now(),
      });
      setSkill(''); setWant('');
    } catch (err) {
      setLoadError(`Couldn't post that. (${err?.code || 'unknown'}: ${err?.message || err})`);
    }
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
        sendNotification({
          uid: item.userId,
          title: 'Aura • Skill Swap',
          body: 'Someone wants to swap skills with you.',
          path: '/aura/swap',
        });
      } else {
        const data = snap.data();
        const updates = {};
        if (data.userA === userId && !data.userAAccepted) updates.userAAccepted = true;
        if (data.userB === userId && !data.userBAccepted) updates.userBAccepted = true;
        const a = data.userAAccepted || updates.userAAccepted;
        const b = data.userBAccepted || updates.userBAccepted;
        if (a && b) {
          updates.status = 'matched';
          sendNotification({
            uid: data.userA === userId ? data.userB : data.userA,
            title: 'Aura • Skill Swap',
            body: 'Your swap request was accepted!',
            path: `/aura/swap/chat/${id}`,
          });
        }
        if (Object.keys(updates).length) await updateDoc(ref, updates);
      }
    } catch (err) {
      setActionError(`Couldn't send that request. (${err?.code || 'unknown'}: ${err?.message || err})`);
    } finally {
      setPendingActions((prev) => { const next = { ...prev }; delete next[id]; return next; });
    }
  };

  // Same reasoning as MatchFinder's rejectMatch: deletes rather than
  // marking 'rejected', so declining/canceling stays silent rather than
  // creating a "who rejected me" signal.
  const rejectSwap = async (id) => {
    if (pendingActions[id]) return;
    setActionError('');
    setPendingActions((prev) => ({ ...prev, [id]: true }));
    try {
      await deleteDoc(doc(db, 'swapPairs', id));
    } catch (err) {
      setActionError(`Couldn't do that. (${err?.code || 'unknown'}: ${err?.message || err})`);
    } finally {
      setPendingActions((prev) => { const next = { ...prev }; delete next[id]; return next; });
    }
  };

  // Requests a video call directly from the roster, without needing to
  // open the chat first — same write toggleVideoRequest() does in
  // SkillSwapChat, just reachable from one tap further out.
  const quickRequestVideo = async (swapId) => {
    if (!userId) return;
    try {
      const ref = doc(db, 'swapPairs', swapId);
      const snap = await getDoc(ref);
      const data = snap.data() || {};
      const isA = data.userA === userId;
      await updateDoc(ref, isA
        ? { videoA: true, videoRequestedAt: data.videoRequestedAt || Timestamp.now() }
        : { videoB: true, videoRequestedAt: data.videoRequestedAt || Timestamp.now() });
      navigate(`/aura/swap/chat/${swapId}`);
    } catch (err) {
      setActionError(`Couldn't request a video call. (${err?.code || 'unknown'}: ${err?.message || err})`);
    }
  };

  // Someone else's request TO you — distinct from a card where you're the
  // one who sent the request and are waiting. Pulled into its own section
  // (see MatchFinder.jsx for the same pattern) so it's never just another
  // card in the general browse grid with a differently-worded button —
  // that ambiguity (a request to you looking identical to a request from
  // you) was the actual bug.
  const incomingSwaps = Object.entries(pairs)
    .filter(([, p]) => !p.isInitiator && p.status !== 'matched')
    .map(([id, p]) => ({ id, ...p }));
  const incomingUids = new Set(incomingSwaps.map((p) => p.theirId));

  // Every pair that's actually reached 'matched' — a real "conversations"
  // list built straight from swapPairs, not from whichever cards still
  // happen to be sitting in the public `items` deck. A matched partner who
  // never posted their own swap listing (they only ever browsed and
  // requested) would otherwise never show up anywhere on this side — that
  // mismatch was the root cause of "I accepted their request but I have no
  // way to open the chat".
  const mySwaps = Object.entries(pairs)
    .filter(([, p]) => p.status === 'matched')
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => (b.matchedAt?.toMillis?.() || 0) - (a.matchedAt?.toMillis?.() || 0));

  if (loading || !user) return <PageSkeleton />;

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar title={t('skill_swap')} subtitle={t('skill_swap_desc')} onBack={() => navigate(-1)} />

        <div className="aura-card aura-section fade-in">
          <h2 className="aura-title">{t('post_swap')}</h2>
          <input className="aura-input" value={skill} onChange={(e) => setSkill(e.target.value)} placeholder={t('i_can_teach')} maxLength={300} data-testid="swap-skill" />
          <input className="aura-input" value={want} onChange={(e) => setWant(e.target.value)} placeholder={t('i_want_to_learn')} maxLength={300} data-testid="swap-want" />
          <button type="button" onClick={post} disabled={!skill.trim() || !want.trim()} className="aura-btn aura-btn-primary" data-testid="swap-post-btn"><Repeat size={16} /> {t('post_swap')}</button>
        </div>

        {actionError && <p className="aura-login-error" data-testid="swap-action-error">{actionError}</p>}

        {incomingSwaps.length > 0 && (
          <>
            <h2 className="aura-title">{t('requests_for_you')} ({incomingSwaps.length})</h2>
            <div className="aura-grid" style={{ marginBottom: 22 }}>
              {incomingSwaps.map((p) => (
                <div key={p.id} className="aura-card-compact fade-in" data-testid={`incoming-swap-${p.id}`} style={{ borderColor: 'var(--primary)', borderWidth: 2 }}>
                  <div className="aura-row" style={{ marginBottom: 10 }}>
                    <Avatar color={p.userAColor} size={36} />
                    <div><strong>{t('anonymous_profile')}</strong></div>
                  </div>
                  <p className="aura-muted" style={{ margin: '0 0 12px' }}>{t('wants_to_swap_you')}</p>
                  <div className="aura-row">
                    <button
                      type="button"
                      onClick={() => requestSwap({ userId: p.theirId, userColor: p.userAColor })}
                      disabled={!!pendingActions[p.id]}
                      className="aura-btn aura-btn-primary"
                      data-testid={`accept-incoming-swap-${p.id}`}
                    >
                      <Repeat size={14} /> {pendingActions[p.id] ? t('loading') : t('accept')}
                    </button>
                    <button
                      type="button"
                      onClick={() => rejectSwap(p.id)}
                      disabled={!!pendingActions[p.id]}
                      className="aura-btn aura-btn-secondary"
                      data-testid={`decline-incoming-swap-${p.id}`}
                    >
                      <X size={14} /> {t('decline')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <h2 className="aura-title">{t('your_swaps')} ({mySwaps.length})</h2>
        {mySwaps.length === 0 ? (
          <div className="aura-card" style={{ textAlign: 'center' }}><p className="aura-muted">{t('no_swaps_yet')}</p></div>
        ) : (
          <div className="chat-roster" style={{ marginBottom: 22 }} data-testid="my-swaps-list">
            {mySwaps.map((p) => {
              const theirColor = p.isInitiator ? p.userBColor : p.userAColor;
              const videoBothAccepted = p.videoA && p.videoB;
              const iAccepted = p.userA === userId ? p.videoA : p.videoB;
              return (
                <div key={p.id} className="chat-roster__item fade-in" data-testid={`my-swap-${p.id}`}>
                  <Avatar color={theirColor} size={52} />
                  <button type="button" className="chat-roster__body" onClick={() => navigate(`/aura/swap/chat/${p.id}`)} data-testid={`open-swap-${p.id}`}>
                    <strong>{t('anonymous_profile')}</strong>
                    <span className="chat-roster__cta"><MessageCircle size={13} /> {t('open_chat')}</span>
                  </button>
                  {videoBothAccepted ? (
                    <button type="button" onClick={() => navigate(`/aura/swap/call/${p.id}`)} className="aura-btn aura-btn-primary aura-btn-pill" data-testid={`roster-start-video-${p.id}`}><Video size={14} /> {t('start_video')}</button>
                  ) : !iAccepted ? (
                    <button type="button" onClick={() => quickRequestVideo(p.id)} className="aura-btn aura-btn-secondary aura-btn-pill" data-testid={`roster-request-video-${p.id}`}><Video size={14} /></button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        <h2 className="aura-title">{t('available_swaps')} ({items.length})</h2>
        {loadError && <p className="aura-login-error" data-testid="swap-load-error">{loadError}</p>}
        {items.length === 0 ? (
          <div className="aura-card" style={{ textAlign: 'center' }}><p className="aura-muted">{t('empty_no_swaps')}</p></div>
        ) : (
          <div className="aura-grid">
            {items.filter((i) => i.userId !== userId && !blockedUsers.has(i.userId) && !incomingUids.has(i.userId)).map((item) => {
              const id = pairId(userId, item.userId);
              const p = pairs[id];
              const matched = p?.userAAccepted && p?.userBAccepted;
              const pending = p && !matched;
              return (
                <div key={item.id} className="aura-card-compact fade-in" data-testid={`swap-${item.id}`}>
                  <div className="aura-row" style={{ marginBottom: 10, justifyContent: 'space-between' }}>
                    <div className="aura-row">
                      <Avatar color={item.userColor} size={36} />
                      <div><strong>Person {item.userId?.slice(0, 6)}</strong></div>
                    </div>
                    <ReportBlockMenu
                      userId={userId}
                      otherUserId={item.userId}
                      blocked={blockedUsers.has(item.userId)}
                      context="skillSwap"
                      contextId={item.id}
                      compact
                    />
                  </div>
                  <p style={{ margin: '0 0 6px' }}><strong style={{ color: 'var(--warning)' }}>Teaches:</strong> {item.skill}</p>
                  <p style={{ margin: '0 0 12px' }}><strong style={{ color: 'var(--success)' }}>Wants:</strong> {item.want}</p>
                  {matched ? (
                    <button type="button" onClick={() => navigate(`/aura/swap/chat/${id}`, { state: { otherUser: item } })} className="aura-btn aura-btn-primary" data-testid={`swap-chat-${item.id}`}><MessageCircle size={14} /> {t('open_chat')}</button>
                  ) : pending ? (
                    p.isInitiator ? (
                      <>
                        <button type="button" disabled className="aura-btn aura-btn-secondary" data-testid={`swap-pending-${item.id}`}>{t('swap_pending')}</button>
                        <button type="button" onClick={() => rejectSwap(id)} disabled={!!pendingActions[id]} className="aura-btn aura-btn-secondary" data-testid={`swap-cancel-${item.id}`}><X size={14} /> {t('cancel_request')}</button>
                      </>
                    ) : (
                      <button type="button" onClick={() => requestSwap(item)} disabled={!!pendingActions[id]} className="aura-btn aura-btn-primary" data-testid={`swap-pending-${item.id}`}>{pendingActions[id] ? t('loading') : t('accept')}</button>
                    )
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
