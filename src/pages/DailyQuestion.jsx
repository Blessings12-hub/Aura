import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  collection, addDoc, query, orderBy, onSnapshot, Timestamp,
} from 'firebase/firestore';
import { Send } from 'lucide-react';
import { db } from '../firebase';
import {
  DAILY_QUESTIONS, questionForDate, todayKey,
} from '../constants/dailyQuestions';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useRoomPresence } from '../hooks/useRoomPresence';
import TopBar from '../components/TopBar';
import Avatar from '../components/Avatar';
import { pushAuraNotification } from '../notifications/NotificationManager';

// Same live-room pattern as Mood Chat, applied to the day's question: this
// used to be a "post once, see a static grid of everyone's answers" page.
// Now clicking the activity drops you straight into a group chat scoped to
// today's question, with real-time messages instead of a one-shot answer
// list.
export default function DailyQuestion() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, userId, loading } = useCurrentUser();
  const [answers, setAnswers] = useState([]);
  const [text, setText] = useState('');
  const listRef = useRef(null);
  const lastSeenRef = useRef(0);

  const day = todayKey();
  const question = questionForDate();
  const questionIndex = Math.max(DAILY_QUESTIONS.indexOf(question), 0);

  const { count: onlineCount } = useRoomPresence(
    `daily-${day}`,
    userId,
    { color: user?.avatarColor },
  );

  useEffect(() => {
    const q = query(collection(db, 'dailyQuestions', day, 'answers'), orderBy('createdAt', 'asc'));
    return onSnapshot(q, (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const newOnes = all.slice(lastSeenRef.current);
      newOnes.forEach((m) => {
        if (m.userId !== userId && lastSeenRef.current > 0) {
          pushAuraNotification(`Aura • ${t('daily_question')}`, m.text ? m.text.slice(0, 80) : '');
        }
      });
      lastSeenRef.current = all.length;
      setAnswers(all);
      requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; });
    });
  }, [day, userId, t]);

  const submit = async () => {
    if (!userId || !text.trim()) return;
    await addDoc(collection(db, 'dailyQuestions', day, 'answers'), {
      text: text.trim(),
      userId,
      userAge: user?.age,
      userGender: user?.gender,
      userColor: user?.avatarColor,
      createdAt: Timestamp.now(),
    });
    setText('');
  };

  if (loading || !user) {
    return <div className="aura-page"><div className="aura-shell"><div className="aura-card">{t('loading')}</div></div></div>;
  }

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar
          title={t('daily_question')}
          subtitle={`${question} • ${onlineCount} ${t('online_now')}`}
          onBack={() => navigate(-1)}
        />

        <div className="aura-card aura-section fade-in" data-testid="daily-question-room">
          <div className="aura-row" style={{ justifyContent: 'space-between' }}>
            <div className="chip"><span className="dot dot--live" /> Question #{questionIndex + 1} • {day}</div>
            <div className="chip">{onlineCount} {t('online_now')}</div>
          </div>

          <div ref={listRef} className="message-list" data-testid="daily-message-list" style={{ background: 'var(--surface-2)', borderRadius: 14, padding: 12, border: '1px solid var(--border)' }}>
            {answers.length === 0 ? (
              <p className="aura-muted" style={{ textAlign: 'center', padding: '2rem' }}>{t('empty_no_messages')}</p>
            ) : answers.map((a) => (
              <div key={a.id} className={`message${a.userId === userId ? ' message--mine' : ''}`} data-testid={`daily-msg-${a.id}`}>
                <div className="aura-row" style={{ gap: 8 }}>
                  <Avatar color={a.userColor} size={24} />
                  <span className="message__meta">Person {a.userId?.slice(0, 6)} • {a.userAge} • {a.userGender}</span>
                </div>
                <div className="message__bubble"><span>{a.text}</span></div>
              </div>
            ))}
          </div>

          <div className="aura-row">
            <input
              type="text"
              className="aura-input"
              placeholder={t('write_answer')}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              maxLength={600}
              style={{ flex: '1 1 240px' }}
              data-testid="daily-input"
            />
            <button
              type="button"
              onClick={submit}
              disabled={!text.trim()}
              className="aura-btn aura-btn-primary"
              data-testid="daily-submit-btn"
            >
              <Send size={16} /> {t('submit_answer')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
