import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import {
  ensureFirebaseSession, signInWithGoogleRecovery, firebaseConfigured,
} from '../lib/firebaseClient';
import { doc, getDoc, setDoc, COLLECTIONS, db } from '../lib/firestoreClient';
import { AVATAR_COLORS } from '../constants/moods';
import LanguageSwitcher from '../components/LanguageSwitcher';

const MIN_AGE = 16;

const GENDER_OPTIONS = [
  { value: 'Female', labelKey: 'female' },
  { value: 'Male', labelKey: 'male' },
  { value: 'Non-binary', labelKey: 'non_binary' },
  { value: 'Prefer not to say', labelKey: 'prefer_not' },
];

export default function Login() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [age, setAge] = useState('');
  const [ageTouched, setAgeTouched] = useState(false);
  const [gender, setGender] = useState('');
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLORS[0]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [verificationPending, setVerificationPending] = useState(false);

  // Recovers a previous account on a new device/cleared cache — this is
  // the counterpart to the "Link Google account" option in Account
  // Settings. Firebase resolves this straight back to the same uid if
  // this Google account was linked before (see linkGoogleAccount in
  // firebaseClient.js); if it was never linked, Firebase silently creates
  // a brand-new account instead, so a missing users/{uid} doc here means
  // "genuinely nothing to recover", not an error.
  const handleRecover = async () => {
    setError('');
    setRecovering(true);
    try {
      const user = await signInWithGoogleRecovery();
      const snap = await getDoc(doc(db, COLLECTIONS.users, user.uid));
      if (snap.exists()) {
        navigate('/aura', { replace: true });
      } else {
        setError('No previous Aura account is linked to that Google account.');
      }
    } catch (err) {
      console.error('account recovery failed', err);
      setError('Could not recover an account with that Google sign-in.');
    } finally { setRecovering(false); }
  };

  // Single source of truth for "is Firebase Auth actually ready yet".
  // Waits for sign-in/session-restore to actually finish before reading
  // Firestore, so this can't race request.auth being null server-side and
  // get silently rejected by security rules.
  useEffect(() => {
    let active = true;
    async function checkProfile() {
      if (!firebaseConfigured) return;
      try {
        const user = await ensureFirebaseSession();
        const snap = await getDoc(doc(db, COLLECTIONS.users, user.uid));
        if (!snap.exists()) return;
        const profile = snap.data();
        const expiresAt = Number(profile.verificationExpiresAt || 0);
        if (active && profile.verificationStatus === 'approved' && expiresAt > Date.now()) navigate('/aura/match', { replace: true });
        if (active && profile.verificationStatus === 'pending') setVerificationPending(true);
      } catch (e) {
        console.error('Firebase profile check failed', e);
      }
    }
    checkProfile();
    return () => { active = false; };
  }, [navigate]);

  // Live inline validation, distinct from the submit-time error banner —
  // shows as soon as the person has touched the field, not only after
  // they try to submit.
  const ageHint = useMemo(() => {
    if (!ageTouched || age === '') return null;
    const n = Number(age);
    if (!Number.isFinite(n) || n <= 0) return { text: t('age_error'), error: true };
    if (n < MIN_AGE) return { text: t('age_error'), error: true };
    return null;
  }, [age, ageTouched, t]);

  const canSubmit = age !== '' && Number(age) >= MIN_AGE && gender && !submitting;

  const handleLogin = async () => {
    setError('');
    setAgeTouched(true);
    if (!age || !gender) { setError(t('fill_required')); return; }
    if (Number(age) < MIN_AGE) { setError(t('age_error')); return; }
    setSubmitting(true);
    try {
      const user = await ensureFirebaseSession();
      const uid = user.uid;
      const now = new Date().toISOString();
      const profile = {
        age: String(Number(age)), gender, avatarColor, createdAt: now, updatedAt: now,
        verificationStatus: 'pending', verified: false,
      };
      await setDoc(doc(db, COLLECTIONS.users, uid), profile, { merge: true });

      const request = { uid, age: String(Number(age)), gender, status: 'pending', submittedAt: now, reviewedAt: '', reviewerId: '' };
      await setDoc(doc(db, COLLECTIONS.verificationRequests, uid), request, { merge: true });

      navigate('/aura/match', { replace: true });
    } catch (err) {
      console.error(err);
      setError(t('signin_failed'));
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

        <div className="aura-card aura-login-card fade-in" data-testid="login-card">
          <div className="aura-login-hero">
            <div className="aura-login-mark" aria-hidden="true">A</div>
            <h1 className="aura-login-title" data-testid="login-title">{t('app_name')}</h1>
            <p className="aura-login-copy" data-testid="login-copy">{t('app_tagline')}</p>
          </div>

          <div className="aura-field">
            <button
              type="button"
              className="aura-btn aura-btn-secondary"
              style={{ width: '100%' }}
              onClick={handleRecover}
              disabled={recovering || submitting}
              data-testid="recover-account-btn"
            >
              {recovering ? 'Checking…' : 'Used Aura before? Recover with Google'}
            </button>
            <span className="aura-field-hint">
              Only works if you previously linked a Google account in Account Settings — otherwise there's nothing to recover, and you can just continue below.
            </span>
          </div>

          <div className="aura-field">
            <label className="aura-field-label" htmlFor="login-age">{t('age')}</label>
            <input
              id="login-age"
              className={`aura-input${ageHint?.error ? ' has-error' : ''}`}
              type="number"
              inputMode="numeric"
              min={MIN_AGE}
              value={age}
              placeholder={t('age_placeholder')}
              onChange={(e) => setAge(e.target.value)}
              onBlur={() => setAgeTouched(true)}
              data-testid="login-age-input"
            />
            {ageHint && (
              <span className={`aura-field-hint${ageHint.error ? ' is-error' : ''}`}>{ageHint.text}</span>
            )}
          </div>

          <div className="aura-field">
            <span className="aura-field-label">{t('gender')}</span>
            <div className="aura-segmented" role="radiogroup" aria-label={t('gender')}>
              {GENDER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={gender === opt.value}
                  onClick={() => setGender(opt.value)}
                  className={`aura-segmented-option${gender === opt.value ? ' is-active' : ''}`}
                  data-testid={`login-gender-${opt.value.replace(/\s+/g, '-').toLowerCase()}`}
                >
                  {t(opt.labelKey)}
                </button>
              ))}
            </div>
          </div>

          <div className="aura-field">
            <span className="aura-field-label">{t('pick_color')}</span>
            <div role="radiogroup" aria-label={t('pick_color')} className="aura-color-row">
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
                    className={`aura-color-chip${active ? ' is-active' : ''}`}
                    data-testid={`login-color-${color.replace('#', '')}`}
                    style={{ background: color, outlineColor: active ? 'var(--primary)' : 'transparent' }}
                  >
                    <span className="aura-color-chip__check" aria-hidden="true"><Check size={16} strokeWidth={3} /></span>
                  </button>
                );
              })}
            </div>
          </div>

          {verificationPending && (
            <p role="status" className="aura-field-hint" data-testid="verification-pending">
              Verification is still being reviewed. Keep this page open or return here later; once approved, you&apos;ll continue to Match Finder automatically.
            </p>
          )}

          {error && (
            <p role="alert" className="aura-login-error" data-testid="login-error">{error}</p>
          )}

          <button
            type="button"
            onClick={handleLogin}
            disabled={!canSubmit}
            className="aura-btn aura-btn-primary aura-login-submit"
            data-testid="login-submit-btn"
          >
            {submitting && <span className="aura-spinner" aria-hidden="true" />}
            {submitting ? t('entering') : t('enter_anonymously')}
          </button>

          <p className="aura-muted" style={{ fontSize: '0.82rem', margin: '14px 0 0', textAlign: 'center' }}>
            {t('privacy_note')}
          </p>
        </div>
      </div>
    </div>
  );
}
