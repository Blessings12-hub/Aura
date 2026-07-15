import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  collection, addDoc, query, orderBy, Timestamp,
} from 'firebase/firestore';
import { Send } from 'lucide-react';
import { db } from '../firebase';
import { subscribe } from '../lib/subscribe';
import {
  DAILY_QUESTIONS, questionForDate, todayKey,
} from '../constants/dailyQuestions';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useBlockedUsers } from '../hooks/useBlockedUsers';
import { useSendCooldown } from '../hooks/useSendCooldown';
import { useRoomPresence } from '../hooks/useRoomPresence';
import TopBar from '../components/TopBar';
import PageSkeleton from '../components/PageSkeleton';
import Avatar from '../components/Avatar';
import ReportBlockMenu from '../components/ReportBlockMenu';
import { pushAuraNotification } from '../notifications/NotificationManager';
import { recordDailyAnswerStreak } from '../lib/streak';
import { moderateText, MODERATION_MESSAGES } from '../lib/contentFilter';

// Same live-room pattern as Mood Chat, applied to the day's question: this
// used to be a "post once, see a static grid of everyone's answers" page.
// Now clicking the activity drops you straight into a group chat scoped to
// today's question, with real-time messages instead of a one-shot answer
// list.
export default function DailyQuestion() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, userId, loading } = useCurrentUser();
  const blockedUsers = useBlockedUsers(userId);
  const { ready: sendReady, trigger: triggerCooldown } = useSendCooldown();
  const [answers, setAnswers] = useState([]);
  const [text, setText] = useState('');
  const [chatError, setChatError] = useState('');
  const listRef = useRef(null);
  const lastSeenRef = useRef(0);

  const day = todayKey();
  const question = questionForDate();
  const questionIndex = Math.max(DAILY_QUESTIONS.indexOf(question), 0);

  const { count: onlineCount, error: presenceError } = useRoomPresence(
    `daily-${day}`,
    userId,
    { color: user?.avatarColor },
  );

  useEffect(() => {
    const q = query(collection(db, 'dailyQuestions', day, 'answers'), orderBy('createdAt', 'asc'));
    return subscribe(q, (snap) => {
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
    }, () => setChatError('Answers could not be loaded. Check your connection and try again.'), `daily question (${day})`);
  }, [day, userId, t]);

  const submit = async () => {
    if (!userId || !text.trim() || !sendReady) return;
    const moderationReason = moderateText(text);
    if (moderationReason) {
      setChatError(MODERATION_MESSAGES[moderationReason]);
      return;
    }
    triggerCooldown();
    try {
      await addDoc(collection(db, 'dailyQuestions', day, 'answers'), {
        text: text.trim(),
        userId,
        userAge: user?.age,
        userGender: user?.gender,
        userColor: user?.avatarColor,
        createdAt: Timestamp.now(),
      });
      setText('');
      // Fire-and-forget: the streak write is a separate document from the
      // answer itself, and shouldn't block the input from clearing or show
      // an error banner over what was actually a successful send. Real
      // failures here just mean the streak doesn't tick up this once,
      // which self-corrects tomorrow rather than blocking anything.
      recordDailyAnswerStreak(userId, day).catch((err) => console.error('streak update failed', err));
    } catch (err) {
      setChatError(`Couldn't send that. (${err?.code || 'unknown'}: ${err?.message || err})`);
    }
  };

  if (loading || !user) {
    return <PageSkeleton />;
  }

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar
          title={t('daily_question')}
          subtitle={`${question} • ${presenceError ? t('presence_unavailable') : `${onlineCount} ${t('online_now')}`}`}
          onBack={() => navigate(-1)}
        />

        <div className="aura-card aura-section fade-in" data-testid="daily-question-room">
          <div className="aura-row" style={{ justifyContent: 'space-between' }}>
            <div className="chip"><span className="dot dot--live" /> Question #{questionIndex + 1} • {day}</div>
            {user?.dailyStreak > 0 && (
              <div className="chip" data-testid="daily-streak-chip" title={user.dailyStreakBest > user.dailyStreak ? `Best: ${user.dailyStreakBest} days` : undefined}>
                🔥 {user.dailyStreak} {user.dailyStreak === 1 ? 'day' : 'days'}
              </div>
            )}
            <div className="chip">{presenceError ? '—' : onlineCount} {t('online_now')}</div>
          </div>

          <div ref={listRef} className="message-list" data-testid="daily-message-list" style={{ background: 'var(--surface-2)', borderRadius: 14, padding: 12, border: '1px solid var(--border)' }}>
            {answers.filter((a) => !blockedUsers.has(a.userId)).length === 0 ? (
              <p className="aura-muted" style={{ textAlign: 'center', padding: '2rem' }}>{t('empty_no_messages')}</p>
            ) : answers.filter((a) => !blockedUsers.has(a.userId)).map((a) => (
              <div key={a.id} className={`message${a.userId === userId ? ' message--mine' : ''}`} data-testid={`daily-msg-${a.id}`}>
                <div className="aura-row" style={{ gap: 8, justifyContent: 'space-between' }}>
                  <div className="aura-row" style={{ gap: 8 }}>
                    <Avatar color={a.userColor} size={24} />
                    <span className="message__meta">Person {a.userId?.slice(0, 6)} • {a.userAge} • {a.userGender}</span>
                  </div>
                  {a.userId !== userId && (
                    <ReportBlockMenu userId={userId} otherUserId={a.userId} blocked={blockedUsers.has(a.userId)} context="dailyQuestion" contextId={day} compact />
                  )}
                </div>
                <div className="message__bubble"><span>{a.text}</span></div>
              </div>
            ))}
          </div>

          {chatError && <p className="aura-login-error" style={{ margin: '10px 0 0' }} data-testid="daily-chat-error">{chatError}</p>}

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
              disabled={!text.trim() || !sendReady}
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
