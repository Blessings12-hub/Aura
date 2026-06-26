import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db } from '../firebase';
import { doc, getDoc, collection, addDoc, query, orderBy, onSnapshot, Timestamp } from 'firebase/firestore';
import TopBar from '../components/TopBar';

export default function DailyQuestion({ theme, setTheme }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [user, setUser] = useState(null);
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState([]);
  const [answer, setAnswer] = useState('');

  const questions = [
    'What is one thing that made you smile today?',
    'What would you tell your younger self?',
    'What is a small goal you want to achieve this week?',
    'What is your comfort food and why?',
    'What is a place you want to visit one day?',
    'How are you feeling today?',
    'What are you grateful for today?',
    'What is your top priority today?',
    'What is distracting you the most?',
    'How much water have you had today?',
    'What is your biggest challenge while learning?',
    'Who made your day better today?',
    'Have you checked on someone today?',
    'Who would you like to reconnect with?',
    'What is one thing you are proud of today?',
    'How close are you to your goals?',
    'What is your favourite song today?',
    'What is one recommendation you would give someone today?',
    'What made you smile today?',
    'What could you have done better?',
    'If you could relive one moment today, what would it be?',
    'How would you rate your day out of 10?',
    'What is one unpopular opinion you have?',
    'What is one thing you have been consistently improving?'
  ];

  useEffect(() => {
    const loadUser = async () => {
      const userId = localStorage.getItem('aura_userId');
      if (!userId) return navigate('/');
      const userDoc = await getDoc(doc(db, 'users', userId));
      if (userDoc.exists()) setUser(userDoc.data());
      else navigate('/');
    };
    loadUser();
  }, [navigate]);

  useEffect(() => {
    const todayIndex = new Date().getDate() % questions.length;
    setQuestion(questions[todayIndex]);

    const qref = query(collection(db, 'dailyQuestions', 'today', 'answers'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(qref, (snap) => {
      setAnswers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    return () => unsub();
  }, []);

  const sendAnswer = async () => {
    const userId = localStorage.getItem('aura_userId');
    if (!userId || !answer.trim()) return;

    await addDoc(collection(db, 'dailyQuestions', 'today', 'answers'), {
      text: answer.trim(),
      userId,
      userAge: user?.age,
      userGender: user?.gender,
      userColor: user?.avatarColor,
      createdAt: Timestamp.now()
    });

    setAnswer('');
  };

  if (!user) return <div className="aura-page"><div className="aura-shell"><div className="aura-card">Loading...</div></div></div>;

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar
          title="Daily Question"
          subtitle={question}
          onBack={() => navigate(-1)}
          theme={theme}
          setTheme={setTheme}
        />

        <div className="aura-card aura-section">
          <textarea
            className="aura-textarea"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Write your anonymous answer..."
          />
          <button onClick={sendAnswer} className="aura-btn aura-btn-primary" style={{ marginTop: 12 }}>
            Submit Answer
          </button>
        </div>

        <div className="aura-grid aura-section">
          {answers.map((a) => (
            <div key={a.id} className="aura-card-compact">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: a.userColor || '#ddd' }} />
                <strong style={{ color: 'var(--text)' }}>Person {a.userId?.slice(0, 6)}</strong>
                <span style={{ color: 'var(--muted)' }}>{a.userAge} • {a.userGender}</span>
              </div>
              <p style={{ margin: 0, color: 'var(--text)' }}>{a.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}