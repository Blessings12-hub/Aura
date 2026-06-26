import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db, signInAnon } from '../firebase';
import { doc, setDoc } from 'firebase/firestore';
import LanguageSwitcher from '../components/LanguageSwitcher';

export default function Login() {
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [avatarColor, setAvatarColor] = useState('#4F46E5');
  const navigate = useNavigate();
  const { t } = useTranslation();

  const colors = ['#4F46E5', '#EC4899', '#10B981', '#F59E0B', '#3B82F6', '#8B5CF6', '#EF4444', '#06B6D4'];

  const handleLogin = async () => {
    if (!age || !gender) return alert('Please enter your age and select your gender.');
    if (Number(age) < 16) return alert('You must be 16+ to join Aura.');

    try {
      const cred = await signInAnon();
      const uid = cred.user.uid;

      await setDoc(doc(db, 'users', uid), {
        age: Number(age),
        gender,
        avatarColor,
        createdAt: new Date().toISOString()
      });

      localStorage.setItem('aura_userId', uid);
      navigate('/aura');
    } catch (error) {
      console.error(error);
      alert('Error logging in. Please try again.');
    }
  };

  return (
    <div
      className="aura-page"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'radial-gradient(circle at top, rgba(79,70,229,0.16), transparent 30%), radial-gradient(circle at bottom right, rgba(236,72,153,0.12), transparent 28%), linear-gradient(180deg, var(--bg), var(--bg))'
      }}
    >
      <div className="aura-shell" style={{ maxWidth: 560, width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <LanguageSwitcher />
        </div>

        <div
          className="aura-card"
          style={{
            position: 'relative',
            overflow: 'hidden',
            padding: 28,
            boxShadow: '0 24px 60px rgba(0,0,0,0.10)',
            border: '1px solid rgba(255,255,255,0.35)'
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 'auto -80px -90px auto',
              width: 220,
              height: 220,
              borderRadius: '50%',
              background: 'rgba(236,72,153,0.10)',
              filter: 'blur(12px)'
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: '-90px auto auto -70px',
              width: 200,
              height: 200,
              borderRadius: '50%',
              background: 'rgba(79,70,229,0.10)',
              filter: 'blur(12px)'
            }}
          />

          <div style={{ textAlign: 'center', marginBottom: '1.6rem', position: 'relative' }}>
            <div
              style={{
                width: 82,
                height: 82,
                borderRadius: '26px',
                margin: '0 auto 14px',
                background: 'linear-gradient(135deg, #4F46E5, #EC4899)',
                color: '#fff',
                display: 'grid',
                placeItems: 'center',
                boxShadow: '0 12px 30px rgba(79,70,229,0.28)',
                fontSize: '1.9rem',
                fontWeight: 800
              }}
            >
              A
            </div>
            <h1 style={{ margin: 0, fontSize: '2.35rem', color: 'var(--text)' }}>Aura</h1>
            <p style={{ margin: '10px auto 0', maxWidth: 390, color: 'var(--muted)', lineHeight: 1.6 }}>
              Anonymous social spaces for chatting, matching, events, skills, and collaboration.
            </p>
          </div>

          <div
            className="aura-card-compact"
            style={{
              marginBottom: 18,
              background: 'linear-gradient(180deg, var(--surface), var(--surface-2))'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <div style={{ width: 10, height: 10, borderRadius: 999, background: 'var(--success)' }} />
              <span style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>Private, anonymous, and refreshed daily</span>
            </div>
            <p style={{ margin: 0, color: 'var(--text)', fontWeight: 600 }}>
              Choose your age, gender, and style — then enter the app.
            </p>
          </div>

          <div style={{ marginBottom: '1.2rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: 'var(--text)' }}>
              Enter Your Age
            </label>
            <input
              className="aura-input"
              type="number"
              value={age}
              placeholder="e.g., 23"
              onChange={(e) => setAge(e.target.value)}
            />
          </div>

          <div style={{ marginBottom: '1.2rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: 'var(--text)' }}>
              Choose Your Gender
            </label>
            <select
              className="aura-select"
              value={gender}
              onChange={(e) => setGender(e.target.value)}
            >
              <option value="">Select Gender</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Prefer not to say">Prefer not to say</option>
            </select>
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: 'var(--text)' }}>
              Pick Your Color
            </label>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              {colors.map((color) => (
                <button
                  key={color}
                  onClick={() => setAvatarColor(color)}
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '50%',
                    background: color,
                    border: avatarColor === color ? '3px solid #111' : '2px solid #ddd',
                    cursor: 'pointer'
                  }}
                />
              ))}
            </div>
          </div>

          <button
            onClick={handleLogin}
            className="aura-btn aura-btn-primary"
            style={{
              width: '100%',
              padding: '1rem 1.2rem',
              fontSize: '1rem',
              boxShadow: '0 10px 24px rgba(79,70,229,0.18)'
            }}
          >
            {t('enter_anonymously') || 'Enter Aura Anonymously'}
          </button>
        </div>
      </div>
    </div>
  );
}