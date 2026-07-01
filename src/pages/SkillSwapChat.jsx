import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  collection, addDoc, doc, onSnapshot, query, orderBy, updateDoc, Timestamp, getDoc, setDoc,
} from 'firebase/firestore';
import { Send, Video, X } from 'lucide-react';
import { db } from '../firebase';
import { useCurrentUser } from '../hooks/useCurrentUser';
import TopBar from '../components/TopBar';

export default function SkillSwapChat() {
  const navigate = useNavigate();
  const { swapId } = useParams();
  const { user, userId, loading } = useCurrentUser();
  const { t } = useTranslation();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [pair, setPair] = useState(null);

  useEffect(() => {
    if (!swapId) return undefined;
    const unsubMsg = onSnapshot(query(collection(db, 'swapChats', swapId, 'messages'), orderBy('createdAt', 'asc')),
      (s) => setMessages(s.docs.map((d) => ({ id: d.id, ...d.data() }))));
    const unsubPair = onSnapshot(doc(db, 'swapPairs', swapId), (s) => setPair(s.data() || null));
    return () => { unsubMsg(); unsubPair(); };
  }, [swapId]);

  const send = async () => {
    if (!text.trim() || !userId) return;
    await addDoc(collection(db, 'swapChats', swapId, 'messages'), {
      text: text.trim(), userId, userColor: user?.avatarColor, createdAt: Timestamp.now(),
    });
    setText('');
  };

  const toggleVideoRequest = async (accept) => {
    if (!userId || !swapId) return;
    const ref = doc(db, 'swapPairs', swapId);
    const snap = await getDoc(ref);
    const data = snap.data() || {};
    const isA = data.userA === userId;
    const upd = isA
      ? { videoA: accept, videoRequestedAt: data.videoRequestedAt || Timestamp.now() }
      : { videoB: accept, videoRequestedAt: data.videoRequestedAt || Timestamp.now() };
    await updateDoc(ref, upd);
  };

  const videoBothAccepted = pair?.videoA && pair?.videoB;
  const iAccepted = pair && (pair.userA === userId ? pair.videoA : pair.videoB);
  const theyAccepted = pair && (pair.userA === userId ? pair.videoB : pair.videoA);

  if (loading) return <div className=\"aura-page\"><div className=\"aura-shell\"><div className=\"aura-card\">{t('loading')}</div></div></div>;

  return (
    <div className=\"aura-page\">
      <div className=\"aura-shell\">
        <TopBar
          title={t('skill_swap')}
          subtitle={videoBothAccepted ? 'Both accepted — start video' : (iAccepted ? 'Waiting for them to accept video' : (theyAccepted ? 'They want a video call' : 'Chat — request a video call anytime'))}
          onBack={() => navigate(-1)}
          right={
            videoBothAccepted ? (
              <button type=\"button\" onClick={() => navigate(`/aura/swap/call/${swapId}`)} className=\"aura-btn aura-btn-primary aura-btn-pill\" data-testid=\"start-video-btn\"><Video size={14} /> {t('start_video')}</button>
            ) : iAccepted ? (
              <button type=\"button\" onClick={() => toggleVideoRequest(false)} className=\"aura-btn aura-btn-secondary aura-btn-pill\" data-testid=\"cancel-video-btn\"><X size={14} /> Cancel</button>
            ) : (
              <button type=\"button\" onClick={() => toggleVideoRequest(true)} className=\"aura-btn aura-btn-primary aura-btn-pill\" data-testid=\"request-video-btn\"><Video size={14} /> {theyAccepted ? t('accept') : t('request_video')}</button>
            )
          }
        />

        <div className=\"aura-card aura-section fade-in\">
          <div className=\"message-list\" data-testid=\"swap-messages\">
            {messages.map((m) => (
              <div key={m.id} className={`message${m.userId === userId ? ' message--mine' : ''}`}>
                <div className=\"message__bubble\">{m.text}</div>
              </div>
            ))}
            {messages.length === 0 && <p className=\"aura-muted\" style={{ textAlign: 'center', padding: '1.5rem' }}>{t('empty_no_messages')}</p>}
          </div>
          <div className=\"aura-row\">
            <input className=\"aura-input\" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder={t('type_message')} style={{ flex: '1 1 240px' }} data-testid=\"swap-chat-input\" />
            <button type=\"button\" onClick={send} disabled={!text.trim()} className=\"aura-btn aura-btn-primary\" data-testid=\"swap-chat-send\"><Send size={16} /> {t('send')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}