import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { account, databases, databaseId, APPWRITE_COLLECTIONS, ensureAnonymousSession, ownerPermissions } from '../lib/appwriteClient';
import { AVATAR_COLORS } from '../constants/moods';
import { ensureFirebaseSession, firebaseConfigured } from '../lib/firebaseClient';
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
  // Settings. Anonymous accounts have no password and no way to sign back
  // in on their own; if someone never linked a Google account first,
  // there is genuinely nothing to recover here — that limitation is real,
  // not a bug in this flow, and is explained in the UI below.
  const handleRecover = async () => {
    setError('');
    setRecovering(true);
    try {
      const session = await account.createEmailPasswordSession(window.prompt('Email') || '', window.prompt('Password') || '');
      const profile = await databases.getDocument(databaseId, APPWRITE_COLLECTIONS.users, session.userId);
      if (profile) navigate('/aura', { replace: true });
    } catch (err) {
      console.error('account recovery failed', err);
      setError('Could not recover that account. Check your Appwrite email/password session.');
    } finally { setRecovering(false); }
  };

  // Single source of truth for "is Firebase Auth actually ready yet".
  // Previously this page had two separate effects: one that read Firestore
  // immediately using whatever uid happened to be in localStorage (with the
  // failure silently swallowed by .catch(() => {})), and a second, unrelated
  // effect that handled anonymous sign-in. Because the Firestore read didn't
  // wait for the sign-in/session-restore to actually finish, it could fire
  // while request.auth was still null server-side, get rejected by the
  // security rules, and silently fail — leaving an already-onboarded person
  // stuck looking at the login form again instead of being sent to Home.
  useEffect(() => {
    let active = true;
    async function checkProfile() {
      try {
        const session = await ensureAnonymousSession();
        const profile = await databases.getDocument(databaseId, APPWRITE_COLLECTIONS.users, session.$id);
        const expiresAt = Number(profile.verificationExpiresAt || 0);
        if (active && profile.verificationStatus === 'approved' && expiresAt > Date.now()) navigate('/aura/match', { replace: true });
        if (active && profile.verificationStatus === 'pending') setVerificationPending(true);
      } catch (e) {
        if (e?.code !== 404) console.error('Appwrite profile check failed', e);
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
      const session = await ensureAnonymousSession();
      const firebaseUser = firebaseConfigured ? await ensureFirebaseSession() : null;
      const uid = session.$id;
      const now = new Date().toISOString();
      const profile = {
        age: String(Number(age)), gender, avatarColor, createdAt: now, updatedAt: now,
        firebaseUid: firebaseUser?.uid || '', verificationStatus: 'pending', verified: false,
      };
      const permissions = ownerPermissions(uid);
      try {
        await databases.getDocument(databaseId, APPWRITE_COLLECTIONS.users, uid);
        await databases.updateDocument(databaseId, APPWRITE_COLLECTIONS.users, uid, profile, permissions);
      } catch (lookupError) {
        if (lookupError?.code !== 404) throw lookupError;
        await databases.createDocument(databaseId, APPWRITE_COLLECTIONS.users, uid, profile, permissions);
      }
      const request = { uid, age: String(Number(age)), gender, status: 'pending', submittedAt: now, reviewedAt: '', reviewerId: '' };
      try {
        await databases.updateDocument(databaseId, APPWRITE_COLLECTIONS.verificationRequests, uid, request, permissions);
      } catch (lookupError) {
        if (lookupError?.code !== 404) throw lookupError;
        await databases.createDocument(databaseId, APPWRITE_COLLECTIONS.verificationRequests, uid, request, permissions);
      }
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
