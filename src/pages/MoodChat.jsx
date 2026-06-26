import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db } from '../firebase';
import { doc, getDoc, collection, addDoc, query, orderBy, onSnapshot, Timestamp } from 'firebase/firestore';
import TopBar from '../components/TopBar';

export default function MoodChat({ theme, setTheme }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [user, setUser] = useState(null);
  const [mood, setMood] = useState('');
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [voiceMediaRecorder, setVoiceMediaRecorder] = useState(null);

  const moods = [
    { name: 'Happy', color: '#10B981' },
    { name: 'Stressed', color: '#F59E0B' },
    { name: 'Excited', color: '#EC4899' },
    { name: 'Sad', color: '#3B82F6' },
    { name: 'Calm', color: '#8B5CF6' },
    { name: 'Anxious', color: '#EF4444' },
    { name: 'Lonely', color: '#6366F1' },
    { name: 'Creative', color: '#14B8A6' }
  ];

  useEffect(() => {
    const getUserData = async () => {
      const userId = localStorage.getItem('aura_userId');
      if (!userId) return navigate('/');
      const userDoc = await getDoc(doc(db, 'users', userId));
      if (userDoc.exists()) setUser(userDoc.data());
      else navigate('/');
    };
    getUserData();
  }, [navigate]);

  useEffect(() => {
    if (!mood) return;
    const chatQuery = query(collection(db, 'chats', mood, 'messages'), orderBy('createdAt', 'asc'));
    const unsubscribe = onSnapshot(chatQuery, (snapshot) => {
      const msgs = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return { id: docSnap.id, ...data, isVoice: !!data.voiceUrl };
      });
      setMessages(msgs);
    });
    return () => unsubscribe();
  }, [mood]);

  const handleSendMessage = async () => {
    const userId = localStorage.getItem('aura_userId');
    if (!newMessage.trim() || !mood || !userId) return;

    await addDoc(collection(db, 'chats', mood, 'messages'), {
      text: newMessage.trim(),
      voiceUrl: '',
      isVoice: false,
      userId,
      userAge: user?.age,
      userGender: user?.gender,
      userColor: user?.avatarColor,
      createdAt: Timestamp.now()
    });

    setNewMessage('');
  };

  const startVoiceRecording = async () => {
    const userId = localStorage.getItem('aura_userId');
    if (!userId) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      const chunks = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const audioUrl = `voice-${Date.now()}.webm`;

        await addDoc(collection(db, 'chats', mood, 'messages'), {
          text: '',
          voiceUrl: audioUrl,
          isVoice: true,
          userId,
          userAge: user?.age,
          userGender: user?.gender,
          userColor: user?.avatarColor,
          createdAt: Timestamp.now()
        });

        setVoiceRecording(false);
      };

      mediaRecorder.start();
      setVoiceMediaRecorder(mediaRecorder);
      setVoiceRecording(true);
    } catch (error) {
      console.error('Voice error', error);
      alert('Cannot access microphone. Please check permissions.');
    }
  };

  const stopVoiceRecording = () => {
    if (voiceMediaRecorder) voiceMediaRecorder.stop();
  };

  if (!user) return <div className="aura-page"><div className="aura-shell"><div className="aura-card">Loading...</div></div></div>;

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar
          title="Mood Chat"
          subtitle={`Anonymous chat. Your info: ${user.age}, ${user.gender}`}
          onBack={() => navigate(-1)}
          theme={theme}
          setTheme={setTheme}
        />

        <div className="aura-card aura-section">
          {!mood ? (
            <div>
              <h2 style={{ textAlign: 'center', marginBottom: '2rem', color: 'var(--text)', fontSize: '1.5rem' }}>
                Choose Your Mood to Join Chat
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
                {moods.map((m) => (
                  <button
                    key={m.name}
                    onClick={() => setMood(m.name)}
                    className="aura-btn"
                    style={{ padding: '1.5rem', background: m.color, color: '#fff', borderRadius: '12px' }}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <div style={{ background: 'var(--primary)', color: '#fff', padding: '2rem', borderRadius: '16px', marginBottom: '2rem', textAlign: 'center' }}>
                <h2 style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>{mood}</h2>
                <p style={{ fontSize: '1rem', marginBottom: '1rem' }}>{messages.length} messages • Anonymous chat</p>
                <button onClick={() => setMood('')} className="aura-btn aura-btn-secondary">
                  Change Mood
                </button>
              </div>

              <div className="aura-card-compact" style={{ marginBottom: '2rem', maxHeight: '500px', overflowY: 'auto' }}>
                {messages.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '3rem' }}>
                    <div style={{ fontSize: '3rem', color: 'var(--muted)', marginBottom: '1rem' }}>👋</div>
                    <p className="aura-muted">No messages yet. Be the first to chat!</p>
                  </div>
                ) : (
                  messages.map((msg) => (
                    <div
                      key={msg.id}
                      style={{
                        background: msg.userId === localStorage.getItem('aura_userId') ? 'rgba(79,70,229,0.08)' : 'var(--surface-2)',
                        borderRadius: '12px',
                        padding: '1rem 1.25rem',
                        marginBottom: '0.75rem',
                        border: msg.userId === localStorage.getItem('aura_userId') ? '2px solid rgba(79,70,229,0.15)' : 'none'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: msg.userColor || '#ddd', marginRight: '0.75rem', border: '2px solid var(--border)' }} />
                        <div>
                          <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: '0.95rem' }}>Person {msg.userId?.slice(0, 6)}</span>
                          <span style={{ color: 'var(--muted)', fontSize: '0.85rem', marginLeft: '0.5rem' }}>
                            {msg.userAge} • {msg.userGender}
                          </span>
                        </div>
                      </div>

                      {msg.isVoice ? (
                        <div style={{ background: 'var(--primary)', color: '#fff', padding: '0.75rem 1.5rem', borderRadius: '8px', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span>🎤</span>
                          <span>Voice note</span>
                        </div>
                      ) : (
                        <p style={{ color: 'var(--text)', lineHeight: 1.6, fontSize: '1rem', margin: 0 }}>{msg.text}</p>
                      )}
                    </div>
                  ))
                )}
              </div>

              <div className="aura-row">
                <input
                  type="text"
                  className="aura-input"
                  placeholder="Type anonymous message..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSendMessage();
                  }}
                  style={{ flex: '1 1 300px' }}
                />
                <button
                  onClick={voiceRecording ? stopVoiceRecording : startVoiceRecording}
                  className="aura-btn aura-btn-secondary"
                  style={{ background: voiceRecording ? 'var(--danger)' : 'var(--success)', color: '#fff', border: 'none' }}
                  disabled={!mood}
                >
                  {voiceRecording ? 'Stop Voice' : 'Voice'}
                </button>
                <button
                  onClick={handleSendMessage}
                  className="aura-btn aura-btn-primary"
                  disabled={!mood || !newMessage.trim()}
                >
                  Send
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}