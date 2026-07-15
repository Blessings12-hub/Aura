import { useNavigate } from 'react-router-dom';
import { Flame, HelpCircle, ArrowRight } from 'lucide-react';
import { todayKey, questionForDate } from '../constants/dailyQuestions';
import { yesterdayKey } from '../lib/streak';

/**
 * Shown on Home whenever the person hasn't answered today's question yet.
 * This is the main lever for pulling someone back daily: if they already
 * have a streak going, losing it is a much stronger pull than a generic
 * "come chat" reminder, so that's the framing whenever there's one to lose.
 */
export default function DailyQuestionNudge({ user }) {
  const navigate = useNavigate();
  if (!user) return null;

  const day = todayKey();
  const alreadyAnsweredToday = user.dailyStreakLastDate === day;
  if (alreadyAnsweredToday) return null;

  const streakStillAlive = user.dailyStreak > 0 && user.dailyStreakLastDate === yesterdayKey(new Date(`${day}T00:00:00`));

  return (
    <button
      type="button"
      onClick={() => navigate('/aura/question')}
      className="aura-card fade-in daily-nudge"
      data-testid="daily-question-nudge"
      style={{
        display: 'flex', alignItems: 'center', gap: 12, width: '100%',
        textAlign: 'left', cursor: 'pointer', border: streakStillAlive ? '1px solid #f59e0b55' : undefined,
      }}
    >
      <div
        className="daily-nudge__icon"
        style={{
          display: 'grid', placeItems: 'center', width: 40, height: 40, borderRadius: 12, flexShrink: 0,
          background: streakStillAlive ? 'rgba(245, 158, 11, 0.2)' : 'rgba(16, 185, 129, 0.2)',
          color: streakStillAlive ? '#f59e0b' : '#10b981',
        }}
        aria-hidden="true"
      >
        {streakStillAlive ? <Flame size={20} /> : <HelpCircle size={20} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {streakStillAlive ? (
          <>
            <p style={{ margin: 0, fontWeight: 700 }}>Your {user.dailyStreak}-day streak ends today</p>
            <p className="aura-muted" style={{ margin: 0, fontSize: '0.85rem' }}>Answer today's question to keep it going.</p>
          </>
        ) : (
          <>
            <p style={{ margin: 0, fontWeight: 700 }}>Today's question</p>
            <p className="aura-muted" style={{ margin: 0, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{questionForDate()}</p>
          </>
        )}
      </div>
      <ArrowRight size={16} style={{ flexShrink: 0 }} />
    </button>
  );
}
