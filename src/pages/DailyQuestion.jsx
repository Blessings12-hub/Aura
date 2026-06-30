import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  Timestamp
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  DAILY_QUESTIONS,
  questionForDate,
  todayKey
} from '../constants/dailyQuestions';
import { useCurrentUser } from '../hooks/useCurrentUser';
import TopBar from '../components/TopBar';
import Avatar from '../components/Avatar';

export default function DailyQuestion() {
  const navigate = useNavigate();
  const { user, userId, loading } = useCurrentUser();
  const [answers, setAnswers] = useState([]);
  const [text, setText] = useState('');

  const day = todayKey();
  const question = questionForDate();
  const questionIndex = Math.max(DAILY_QUESTIONS.indexOf(question), 0);

  useEffect(() => {
    const q = query(
      collection(db, 'dailyQuestions', day, 'answers'),
      orderBy('createdAt', 'asc')
    );

    return onSnapshot(q, (snap) => {
      setAnswers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, [day]);

  const submit = async () => {
    if (!userId || !text.trim()) return;

    await addDoc(collection(db, 'dailyQuestions', day, 'answers'), {
      text: text.trim(),
      userId,
      userAge: user?.age,
      userGender: user?.gender,
      userColor: user?.avatarColor,
      createdAt: Timestamp.now()
    });

    setText('');
  };

  if (loading || !user) {
    return (
      <div className="aura-page">
        <div className="aura-shell">
          <div className="aura-card">Loading…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar
          title="Daily Question"
          subtitle={question}
          onBack={() => navigate(-1)}
        />

        <div className="aura-card aura-section">
          <textarea
            className="aura-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write an anonymous answer…"
            maxLength={600}
          />

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 12,
              gap: 12,
              flexWrap: 'wrap'
            }}
          >
            <span className="aura-muted" style={{ fontSize: '0.85rem' }}>
              Question #{questionIndex + 1} • {day}
            </span>

            <button
              type="button"
              onClick={submit}
              disabled={!text.trim()}
              className="aura-btn aura-btn-primary"
            >
              Submit answer
            </button>
          </div>
        </div>

        <div className="aura-grid aura-section">
          {answers.map((a) => (
            <div key={a.id} className="aura-card-compact">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginBottom: 8
                }}
              >
                <Avatar color={a.userColor} size={28} />
                <strong style={{ color: 'var(--text)' }}>
                  Person {a.userId?.slice(0, 6)}
                </strong>
                <span className="aura-muted" style={{ fontSize: '0.85rem' }}>
                  {a.userAge} • {a.userGender}
                </span>
              </div>

              <p style={{ color: 'var(--text)', margin: 0, lineHeight: 1.5 }}>
                {a.text}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}