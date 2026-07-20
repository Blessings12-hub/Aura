import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  collection, doc, setDoc, updateDoc, query, where, orderBy, limit, getDocs, onSnapshot,
  runTransaction, Timestamp,
} from 'firebase/firestore';
import { Mail, Send, Inbox } from 'lucide-react';
import { db } from '../firebase';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { moderateText, MODERATION_MESSAGES } from '../lib/contentFilter';
import TopBar from '../components/TopBar';
import PageSkeleton from '../components/PageSkeleton';

// Replaces Collab Studio. The design intent, from the conversation that
// decided this: every other activity in Aura is built around some kind of
// shared vulnerability between strangers — a mood, a daily prompt, a
// match, a skill, an event. Collab Studio was a well-built shared canvas,
// but it wasn't really ABOUT anonymity or feeling the way the rest of the
// app is; it could've been a feature in almost any generic app. Letters
// leans into the same theme as Daily Question — one-shot, async, low
// pressure — instead of Mood Chat's live pace, which some people find
// intimidating.
//
// Deliberately simple for v1: text-only (no voice/stickers/images, unlike
// the chat-shaped activities), and exactly ONE exchange per letter — you
// write, a random stranger reads and replies once, you read the reply.
// No back-and-forth thread beyond that. Keeps this contained rather than
// rebuilding a whole second chat surface.
export default function AnonymousLetters() {
  const navigate = useNavigate();
  const { user, userId, loading } = useCurrentUser();

  const [myLetters, setMyLetters] = useState([]);
  const [pendingReply, setPendingReply] = useState(null); // a letter I've claimed but not yet replied to
  const [draftLetter, setDraftLetter] = useState('');
  const [draftReply, setDraftReply] = useState('');
  const [sending, setSending] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [replying, setReplying] = useState(false);
  const [error, setError] = useState('');
  const [checkedPending, setCheckedPending] = useState(false);

  // Letters I've written, newest first — so I can see when a reply has
  // come in without having to remember which ones I sent.
  useEffect(() => {
    if (!userId) return undefined;
    const q = query(collection(db, 'letters'), where('authorId', '==', userId), orderBy('createdAt', 'desc'), limit(30));
    const unsub = onSnapshot(q, (snap) => {
      setMyLetters(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (err) => {
      console.error('load my letters failed', err);
      setError('Could not load your letters. Check your connection and try again.');
    });
    return () => unsub();
  }, [userId]);

  // If I already claimed a letter in a previous visit and never replied,
  // show that instead of letting me claim a second one — otherwise
  // someone could hold several letters hostage (claimed, never replied,
  // permanently stuck since a claimed letter isn't "open" for anyone else
  // to pick up anymore). Honest limitation: there's no automatic release
  // if someone claims a letter and genuinely never comes back — that
  // would need a scheduled Cloud Function to sweep and reset stale
  // claims, which is real infrastructure this doesn't have yet.
  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const q = query(
          collection(db, 'letters'),
          where('recipientId', '==', userId),
          where('status', '==', 'delivered'),
          limit(1),
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          const d = snap.docs[0];
          setPendingReply({ id: d.id, ...d.data() });
        }
      } catch (err) {
        console.error('check pending reply failed', err);
      } finally {
        setCheckedPending(true);
      }
    })();
  }, [userId]);

  if (loading || !user || !checkedPending) return <PageSkeleton />;

  const sendLetter = async () => {
    if (!draftLetter.trim()) return;
    const moderationReason = moderateText(draftLetter);
    if (moderationReason) {
      setError(MODERATION_MESSAGES[moderationReason]);
      return;
    }
    setError('');
    setSending(true);
    try {
      const ref = doc(collection(db, 'letters'));
      await setDoc(ref, {
        authorId: userId,
        text: draftLetter.trim(),
        status: 'open',
        createdAt: Timestamp.now(),
      });
      setDraftLetter('');
    } catch (err) {
      setError(`Couldn't send that letter. (${err?.code || 'unknown'})`);
    } finally {
      setSending(false);
    }
  };

  // Fetches a batch of open letters, filters out my own, picks one at
  // random client-side, then claims it inside a transaction — the
  // transaction (re-reading the doc fresh, only committing if it's still
  // 'open') is what actually prevents two people from claiming the same
  // letter at once, not the random pick itself.
  const claimRandomLetter = async () => {
    setError('');
    setClaiming(true);
    try {
      const q = query(collection(db, 'letters'), where('status', '==', 'open'), limit(30));
      const snap = await getDocs(q);
      const candidates = snap.docs.filter((d) => d.data().authorId !== userId);
      if (candidates.length === 0) {
        setError('No letters waiting right now — check back soon, or write one yourself.');
        return;
      }
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      const ref = doc(db, 'letters', pick.id);
      const claimed = await runTransaction(db, async (tx) => {
        const fresh = await tx.get(ref);
        if (!fresh.exists() || fresh.data().status !== 'open') return null;
        const deliveredAt = Timestamp.now();
        tx.update(ref, { status: 'delivered', recipientId: userId, deliveredAt });
        return { id: ref.id, ...fresh.data(), status: 'delivered', recipientId: userId, deliveredAt };
      });
      if (!claimed) {
        setError('That letter was just claimed by someone else — try again.');
        return;
      }
      setPendingReply(claimed);
    } catch (err) {
      setError(`Couldn't fetch a letter. (${err?.code || 'unknown'})`);
    } finally {
      setClaiming(false);
    }
  };

  const sendReply = async () => {
    if (!pendingReply || !draftReply.trim()) return;
    const moderationReason = moderateText(draftReply);
    if (moderationReason) {
      setError(MODERATION_MESSAGES[moderationReason]);
      return;
    }
    setError('');
    setReplying(true);
    try {
      await updateDoc(doc(db, 'letters', pendingReply.id), {
        status: 'replied', replyText: draftReply.trim(), repliedAt: Timestamp.now(),
      });
      setPendingReply(null);
      setDraftReply('');
    } catch (err) {
      setError(`Couldn't send that reply. (${err?.code || 'unknown'})`);
    } finally {
      setReplying(false);
    }
  };

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar title="Anonymous Letters" subtitle="Write one, or answer a stranger's" onBack={() => navigate('/aura')} />

        {error && <p className="aura-login-error" style={{ marginTop: 12 }}>{error}</p>}

        {pendingReply ? (
          <div className="aura-card fade-in" style={{ marginTop: 16 }}>
            <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Inbox size={18} /> A letter for you to answer
            </h2>
            <p style={{ whiteSpace: 'pre-wrap' }}>{pendingReply.text}</p>
            <textarea
              className="aura-input"
              style={{ minHeight: 140, resize: 'vertical', fontFamily: 'inherit', marginTop: 10 }}
              value={draftReply}
              onChange={(e) => setDraftReply(e.target.value)}
              placeholder="Write your reply…"
              maxLength={2000}
              data-testid="letter-reply-input"
            />
            <button
              type="button"
              className="aura-btn aura-btn-primary"
              style={{ marginTop: 10 }}
              onClick={sendReply}
              disabled={!draftReply.trim() || replying}
              data-testid="send-reply-btn"
            >
              <Send size={16} style={{ marginRight: 6 }} /> {replying ? 'Sending…' : 'Send reply'}
            </button>
          </div>
        ) : (
          <div className="aura-card fade-in" style={{ marginTop: 16 }}>
            <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Inbox size={18} /> Answer a stranger's letter
            </h2>
            <p className="aura-muted">You'll get a random letter someone else wrote, and one chance to reply.</p>
            <button type="button" className="aura-btn aura-btn-secondary" onClick={claimRandomLetter} disabled={claiming} data-testid="claim-letter-btn">
              {claiming ? 'Finding one…' : 'Get a letter to answer'}
            </button>
          </div>
        )}

        <div className="aura-card fade-in" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Mail size={18} /> Write a letter
          </h2>
          <p className="aura-muted">Say whatever you need to. A random stranger will read it and can write back once.</p>
          <textarea
            className="aura-input"
            style={{ minHeight: 140, resize: 'vertical', fontFamily: 'inherit' }}
            value={draftLetter}
            onChange={(e) => setDraftLetter(e.target.value)}
            placeholder="Dear stranger…"
            maxLength={2000}
            data-testid="letter-draft-input"
          />
          <button
            type="button"
            className="aura-btn aura-btn-primary"
            style={{ marginTop: 10 }}
            onClick={sendLetter}
            disabled={!draftLetter.trim() || sending}
            data-testid="send-letter-btn"
          >
            <Send size={16} style={{ marginRight: 6 }} /> {sending ? 'Sending…' : 'Send this letter'}
          </button>
        </div>

        {myLetters.length > 0 && (
          <div className="aura-card fade-in" style={{ marginTop: 16 }}>
            <h2 style={{ marginTop: 0 }}>Your letters</h2>
            {myLetters.map((l) => (
              <div key={l.id} style={{ padding: '10px 0', borderTop: '1px solid var(--border)' }} data-testid={`my-letter-${l.id}`}>
                <p style={{ margin: '0 0 4px', whiteSpace: 'pre-wrap' }}>{l.text}</p>
                {l.status === 'replied' ? (
                  <div style={{ marginTop: 6, paddingLeft: 10, borderLeft: '2px solid var(--accent)' }}>
                    <p className="aura-muted" style={{ margin: '0 0 2px', fontSize: '0.75rem', fontWeight: 700 }}>Their reply</p>
                    <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{l.replyText}</p>
                  </div>
                ) : (
                  <p className="aura-muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                    {l.status === 'delivered' ? 'Someone is reading this now…' : 'Waiting for a stranger to pick this up…'}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
