import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';
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

  useEffect(() => {
    // Already logged in & profile complete → skip to home
    const storedId = localStorage.getItem('aura_userId');
    if (storedId) {
      getDoc(doc(db, 'users', storedId)).then((snap) => {
        if (snap.exists()) navigate('/aura');
      }).catch(() => {});
    }
  }, [navigate]);

  const handleLogin = async () => {
    setError('');
    if (!age || !gender) { setError(t('fill_required')); return; }
    if (Number(age) < MIN_AGE) { setError(t('age_error')); return; }
    setSubmitting(true);
    try {
      let uid = localStorage.getItem('aura_userId');
      if (!uid) {
        // Wait for auth state or trigger anonymous sign-in
        const existing = auth.currentUser;
        if (existing) {
          uid = existing.uid;
        } else {
          const cred = await signInAnonymously(auth);
          uid = cred.user.uid;
        }
        localStorage.setItem('aura_userId', uid);
      }
      const userRef = doc(db, 'users', uid);
      const existing = await getDoc(userRef);
      await setDoc(userRef, {
        age: Number(age),
        gender,
        avatarColor,
        createdAt: existing.exists() ? existing.data().createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      navigate('/aura');
    } catch (err) {
      console.error(err);
      setError(t('signin_failed'));
    } finally {
      setSubmitting(false);
    }
  };

  // Ensure anonymous auth started early
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) signInAnonymously(auth).catch(() => {});
    });
    return () => unsub();
  }, []);

  return (
    <div className=\"aura-page aura-login-page\">
      <div className=\"aura-shell aura-login-shell\">
        <div className=\"aura-login-lang\">
          <LanguageSwitcher />
        </div>

        <div className=\"aura-card aura-login-card fade-in\" data-testid=\"login-card\">
          <div className=\"aura-login-hero\">
            <div className=\"aura-login-mark\" aria-hidden=\"true\">A</div>
            <h1 className=\"aura-login-title\" data-testid=\"login-title\">{t('app_name')}</h1>
            <p className=\"aura-login-copy\" data-testid=\"login-copy\">{t('app_tagline')}</p>
          </div>

          <div className=\"aura-field\">
            <label className=\"aura-field-label\">{t('age')}</label>
            <input
              className=\"aura-input\"
              type=\"number\"
              inputMode=\"numeric\"
              min={MIN_AGE}
              value={age}
              placeholder={t('age_placeholder')}
              onChange={(e) => setAge(e.target.value)}
              data-testid=\"login-age-input\"
            />
          </div>

          <div className=\"aura-field\">
            <label className=\"aura-field-label\">{t('gender')}</label>
            <select
              className=\"aura-select\"
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              data-testid=\"login-gender-select\"
            >
              <option value=\"\">{t('select_gender')}</option>
              <option value=\"Female\">{t('female')}</option>
              <option value=\"Male\">{t('male')}</option>
              <option value=\"Non-binary\">{t('non_binary')}</option>
              <option value=\"Prefer not to say\">{t('prefer_not')}</option>
            </select>
          </div>

          <div className=\"aura-field\">
            <label className=\"aura-field-label\">{t('pick_color')}</label>
            <div role=\"radiogroup\" aria-label={t('pick_color')} className=\"aura-color-row\">
              {AVATAR_COLORS.map((color) => {
                const active = avatarColor === color;
                return (
                  <button
                    key={color}
                    type=\"button\"
                    role=\"radio\"
                    aria-checked={active}
                    aria-label={`Colour ${color}`}
                    onClick={() => setAvatarColor(color)}
                    className=\"aura-color-chip\"
                    data-testid={`login-color-${color.replace('#','')}`}
                    style={{ background: color, outlineColor: active ? 'var(--primary)' : 'transparent' }}
                  />
                );
              })}
            </div>
          </div>

          {error && (
            <p role=\"alert\" className=\"aura-login-error\" data-testid=\"login-error\">{error}</p>
          )}

          <button
            type=\"button\"
            onClick={handleLogin}
            disabled={submitting}
            className=\"aura-btn aura-btn-primary aura-login-submit\"
            data-testid=\"login-submit-btn\"
          >
            {submitting ? t('entering') : t('enter_anonymously')}
          </button>

          <p className=\"aura-muted\" style={{ fontSize: '0.82rem', margin: '14px 0 0', textAlign: 'center' }}>
            {t('privacy_note')}
          </p>
        </div>
      </div>
    </div>
  );
}