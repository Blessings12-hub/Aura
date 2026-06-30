import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import { auth, db } from '../firebase';
import { AVATAR_COLORS } from '../constants/moods';
import LanguageSwitcher from '../components/LanguageSwitcher';

const MIN_AGE = 16;

export default function Login() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLORS[0]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleLogin = async () => {
    setError('');

    if (!age || !gender) {
      setError('Please enter your age and choose a gender.');
      return;
    }

    if (Number(age) < MIN_AGE) {
      setError(`You must be ${MIN_AGE} or older to join Aura.`);
      return;
    }

    setSubmitting(true);

    try {
      let uid = localStorage.getItem('aura_userId');

      if (!uid) {
        const cred = await signInAnonymously(auth);
        uid = cred.user.uid;
        localStorage.setItem('aura_userId', uid);
      }

      const userRef = doc(db, 'users', uid);
      const existing = await getDoc(userRef);

      await setDoc(
        userRef,
        {
          age: Number(age),
          gender,
          avatarColor,
          createdAt: existing.exists() ? existing.data().createdAt : new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        { merge: true }
      );

      navigate('/aura');
    } catch (err) {
      console.error(err);
      setError('Could not sign you in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="aura-page aura-login-page">
      <div className="aura-shell aura-login-shell">
        <div className="aura-login-lang">
          <LanguageSwitcher />
        </div>

        <div className="aura-card aura-login-card">
          <div className="aura-login-hero">
            <div className="aura-login-mark" aria-hidden="true">
              A
            </div>

            <h1 className="aura-login-title">Aura</h1>

            <p className="aura-login-copy">
              A mood-based social app for anonymous chat, matching, and shared activities.
              Everything resets every 24 hours.
            </p>
          </div>

          <Field label="Your age">
            <input
              className="aura-input"
              type="number"
              inputMode="numeric"
              min={MIN_AGE}
              value={age}
              placeholder="e.g. 23"
              onChange={(e) => setAge(e.target.value)}
            />
          </Field>

          <Field label="Gender">
            <select className="aura-select" value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="">Select gender</option>
              <option value="Female">Female</option>
              <option value="Male">Male</option>
              <option value="Non-binary">Non-binary</option>
              <option value="Prefer not to say">Prefer not to say</option>
            </select>
          </Field>

          <Field label="Pick your colour">
            <div
              role="radiogroup"
              aria-label="Avatar colour"
              className="aura-color-row"
            >
              {AVATAR_COLORS.map((color) => {
                const active = avatarColor === color;
                return (
                  <button
                    key={color}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={`Colour ${color}`}
                    onClick={() => setAvatarColor(color)}
                    className="aura-color-chip"
                    style={{
                      background: color,
                      outlineColor: active ? 'var(--text)' : 'transparent'
                    }}
                  />
                );
              })}
            </div>
          </Field>

          {error && (
            <p role="alert" className="aura-login-error">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={handleLogin}
            disabled={submitting}
            className="aura-btn aura-btn-primary aura-login-submit"
          >
            {submitting ? 'Entering…' : t('enter_anonymously', 'Enter Aura anonymously')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="aura-field">
      <label className="aura-field-label">{label}</label>
      {children}
    </div>
  );
}