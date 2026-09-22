import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import {
  ensureFirebaseSession, signInWithGoogleRecovery, firebaseConfigured,
} from '../lib/firebaseClient';
import { doc, getDoc, setDoc, onSnapshot, COLLECTIONS, db } from '../lib/firestoreClient';
import { AVATAR_COLORS } from '../constants/moods';
import { submitVerification } from '../lib/verificationService';
import { useAuthUid } from '../hooks/useAuthUid';
import LanguageSwitcher from '../components/LanguageSwitcher';
import SelfieVerification from '../components/SelfieVerification';
import PageSkeleton from '../components/PageSkeleton';

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
  // AuthGate has already established the anonymous session by the time this
  // page renders (see AuthGate.jsx) — this is just reading that shared uid,
  // not starting a new sign-in. Needed for the post-signup verification
  // step below (see showVerificationStep) — by then users/{uid} already exists
  // (handleLogin just created it), so it's safe for the selfie/ID checks to
  // write verification fields onto it.
  const { uid: userId } = useAuthUid();

  const [age, setAge] = useState('');
  const [ageTouched, setAgeTouched] = useState(false);
  const [gender, setGender] = useState('');
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLORS[0]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [recovering, setRecovering] = useState(false);
  // TIGHTENED, per explicit request: no more either/or fast path. Every
  // submission needs both a live selfie and an ID document together — see
  // the matching change in MatchFinder.jsx and the header comment in
  // api/verify-submission.js.
  const [selfieBase64, setSelfieBase64] = useState('');
  const [verificationFile, setVerificationFile] = useState(null);
  // TIGHTENED, per explicit request: verification now gates the whole app,
  // not just Match Finder — so this screen is no longer skippable once an
  // account exists. showVerificationStep covers both a brand-new signup
  // and a returning account that still isn't approved; either way, the
  // person sits here until they're verified. requestStatus/declineReason
  // are read live from verificationRequests/{uid} — the exact same pattern
  // MatchFinder's own gate uses, so both places behave identically.
  const [showVerificationStep, setShowVerificationStep] = useState(false);
  const [requestStatus, setRequestStatus] = useState(null);
  const [requestDeclineReason, setRequestDeclineReason] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState('');
  const [verifyError, setVerifyError] = useState('');
  // FIXED: without this, a returning user — whether already verified or
  // mid-verification — saw the blank signup form flash on screen for a
  // moment on every visit, before the bootstrap check below redirected
  // them to /aura or flipped this over to the verification step. Gating
  // render on this until that check resolves removes the flash; a
  // brand-new visitor with no account at all resolves this near-instantly
  // (the check just confirms there's genuinely nothing to find).
  const [bootstrapping, setBootstrapping] = useState(true);

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
  //
  // TIGHTENED, per explicit request: this used to only redirect an
  // ALREADY-approved account and otherwise leave the normal signup form
  // showing — someone with an existing but unverified account would see
  // the blank sign-up fields again instead of picking up where they left
  // off. Now an existing account that isn't approved goes straight into
  // the verification step, prefilled with what's already on file, since
  // access to the whole app depends on finishing that step, not just
  // Match Finder.
  useEffect(() => {
    let active = true;
    async function checkProfile() {
      try {
        if (!firebaseConfigured) return;
        const user = await ensureFirebaseSession();
        if (!user || !active) return;

        const snap = await getDoc(doc(db, COLLECTIONS.users, user.uid));
        if (!active) return;
        if (snap.exists()) {
          const profile = snap.data();
          const expiresAt = profile.verificationExpiresAt;
          const expiresMs = typeof expiresAt?.toMillis === 'function'
            ? expiresAt.toMillis()
            : Number(expiresAt || 0);
          if (profile.verificationStatus === 'approved' && expiresMs > Date.now()) {
            navigate('/aura', { replace: true });
            return;
          }
          // Account exists but isn't verified yet — prefill from what they
          // already entered so they aren't asked to redo the signup form,
          // and go straight to the verification step.
          //
          // FIXED: this used to check `typeof profile.age === 'number'`.
          // Any account created before an earlier patch fixed Login writing
          // age as a string still has it stored that way — for those
          // accounts this check silently failed, age never prefilled, and
          // SelfieVerification would then show "enter your age above" on a
          // screen that has no age field to enter it in. Checking for
          // "present at all", not a specific type, handles both shapes;
          // Account Settings' new profile editor (see AccountSettings.jsx)
          // also normalizes it to a real number the next time it's saved.
          if (profile.age !== undefined && profile.age !== null && profile.age !== '') setAge(String(profile.age));
          if (profile.gender) setGender(profile.gender);
          if (profile.avatarColor) setAvatarColor(profile.avatarColor);
          setShowVerificationStep(true);
        }
      } catch (e) {
        console.error('Firebase profile check failed', e);
      } finally {
        if (active) setBootstrapping(false);
      }
    }
    checkProfile();
    return () => { active = false; };
  }, [navigate]);

  // Live status of this account's verificationRequests/{uid} — mirrors
  // MatchFinder's gate exactly, so "do the same thing for login too" means
  // the same three states (nothing submitted / pending / declined) render
  // the same way in both places.
  useEffect(() => {
    if (!userId) return undefined;
    return onSnapshot(
      doc(db, COLLECTIONS.verificationRequests, userId),
      (snap) => {
        if (!snap.exists()) { setRequestStatus(null); return; }
        const data = snap.data();
        setRequestStatus(data.status || null);
        setRequestDeclineReason(data.declineReason || '');
      },
      () => {},
    );
  }, [userId]);

  // Live listener on the account itself so an approval that lands WHILE
  // someone is sitting on this screen — the selfie check resolving in a
  // few seconds, or an admin approving a document minutes/hours later —
  // continues straight into the app with no manual refresh needed.
  useEffect(() => {
    if (!userId || !showVerificationStep) return undefined;
    return onSnapshot(
      doc(db, COLLECTIONS.users, userId),
      (snap) => {
        if (!snap.exists()) return;
        const profile = snap.data();
        const expiresAt = profile.verificationExpiresAt;
        const expiresMs = typeof expiresAt?.toMillis === 'function'
          ? expiresAt.toMillis()
          : Number(expiresAt || 0);
        if (profile.verificationStatus === 'approved' && expiresMs > Date.now()) {
          navigate('/aura', { replace: true });
        }
      },
      () => {},
    );
  }, [userId, showVerificationStep, navigate]);

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

      // Two things changed in this payload, and each one on its own was
      // enough to make every single sign-in fail with permission-denied:
      //
      //   * `age` was written as String(Number(age)) — a string. validAge()
      //     in firestore.rules requires `data.age is int`. MatchFinder
      //     already writes a number here, so a number is the correct shape;
      //     Login was the odd one out.
      //
      //   * `verificationStatus` and `verified` were included, but the
      //     users/{uid} create rule explicitly requires both to be ABSENT
      //     (they're admin/server-written only). Note that
      //     setDoc(..., { merge: true }) on a document that doesn't exist
      //     yet still counts as a *create* to security rules, so the merge
      //     flag didn't get around it.
      const profile = {
        age: Number(age), gender, avatarColor, createdAt: now, updatedAt: now,
      };
      await setDoc(doc(db, COLLECTIONS.users, uid), profile, { merge: true });

      // FIXED (routing bug you reported): this used to navigate straight
      // to '/aura/match' — every new sign-up, verified or not, skipped the
      // activity hub entirely. handleRecover (above) already sends a
      // returning user to '/aura', the hub, and that's the correct landing
      // spot for a new account too — once they're actually allowed in; see
      // below, this doesn't navigate anywhere yet.
      //
      // TIGHTENED, per explicit request: verification is no longer
      // scoped to Match Finder — nothing past this point is reachable
      // without it (see RequireVerifiedAccount in App.jsx). This still
      // waits until AFTER the profile write above, though, for a real bug
      // reason, not just tidiness: if someone ran the selfie check before
      // this account existed, the server (api/verify-selfie.js) would
      // write verification fields onto users/{uid} immediately, creating a
      // half-written document — verified, but with no age/gender/
      // avatarColor/createdAt — that every other page's account check
      // would still treat as "this is a real, complete account". Waiting
      // until the full profile write above has already happened removes
      // that ordering entirely.
      setShowVerificationStep(true);
    } catch (err) {
      console.error('sign-in failed', err);
      // The generic banner hid which step actually failed, which made this
      // very hard to diagnose from a phone. The Firebase error code is short
      // and non-sensitive, so showing it costs nothing and saves a lot of
      // guesswork.
      setError(err?.code ? `${t('signin_failed')} (${err.code})` : t('signin_failed'));
    } finally {
      setSubmitting(false);
    }
  };

  // Runs only from the verification step below, once users/{uid} is
  // guaranteed to already exist (see the FIXED comment in handleLogin).
  const handleVerifySubmission = async () => {
    setVerifyError('');
    setVerifyMessage('');
    if (!selfieBase64) {
      setVerifyError('Capture a selfie first.');
      return;
    }
    if (!verificationFile) {
      setVerifyError('Choose a clear photo of a government-issued ID.');
      return;
    }
    setVerifying(true);
    try {
      const result = await submitVerification({
        userId, selfieBase64, idFile: verificationFile, age: Number(age), gender,
      });
      if (result.alreadyVerified) {
        setVerifyMessage("You're already verified! Continuing now.");
      } else {
        // Nothing decides instantly anymore — see api/verify-submission.js.
        // The live listener above will pick up the eventual decision
        // (by a human, or by api/escalate-verifications.js after an
        // hour) and continue on its own.
        setVerifyMessage('Submitted for review. Most requests are reviewed within an hour — this continues automatically once approved.');
        setSelfieBase64('');
        setVerificationFile(null);
      }
    } catch (err) {
      console.error('identity verification submission failed', err);
      setVerifyError(err?.message || 'Could not submit your verification request. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  if (bootstrapping) return <PageSkeleton />;

  if (showVerificationStep) {
    return (
      <div className="aura-page aura-login-page">
        <div className="aura-shell aura-login-shell">
          <div className="aura-card aura-login-card fade-in" data-testid="login-verification-step">
            <div className="aura-login-hero">
              <h1 className="aura-login-title">Verify to continue</h1>
              <p className="aura-login-copy">Every account on Aura needs a quick age check before anything unlocks — Mood Chat, Match Finder, all of it.</p>
            </div>

            {requestStatus === 'pending' && (
              <p role="alert" className="aura-login-error" data-testid="login-verify-pending" style={{ margin: '0 0 12px' }}>
                Your submission is being reviewed. This continues automatically once it's approved — no need to resubmit or refresh.
              </p>
            )}
            {requestStatus === 'declined' && (
              <p role="alert" className="aura-login-error" data-testid="login-verify-declined" style={{ margin: '0 0 12px' }}>
                {requestDeclineReason || 'Your last submission was declined.'}
                {!/under 18/i.test(requestDeclineReason || '') && ' You can try again below with a clearer photo.'}
              </p>
            )}
            {!requestStatus && (
              <p role="alert" className="aura-login-error" data-testid="login-verify-required" style={{ margin: '0 0 12px' }}>
                You haven&apos;t completed verification yet — nothing past this screen is accessible until you do.
              </p>
            )}
            <p className="aura-muted" style={{ fontSize: '0.82rem', margin: '0 0 12px' }}>
              A selfie and an ID document, reviewed together — usually by a person within an hour, automatically if not. Both images are kept only until your request is decided, then deleted.
            </p>

            <div className="aura-field">
              <SelfieVerification captured={!!selfieBase64} onCapture={setSelfieBase64} onRetake={() => setSelfieBase64('')} />

              <label className="aura-field-label" htmlFor="login-verification-file">Government-issued ID photo</label>
              <input
                id="login-verification-file"
                className="aura-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => { setVerificationFile(event.target.files?.[0] || null); setVerifyError(''); setVerifyMessage(''); }}
                disabled={verifying}
                data-testid="login-verification-file"
              />
              <button type="button" className="aura-btn aura-btn-primary" style={{ marginTop: 10 }} onClick={handleVerifySubmission} disabled={verifying || !verificationFile || !selfieBase64} data-testid="login-verify-btn">
                {verifying ? 'Submitting…' : 'Submit verification'}
              </button>
              {verifyMessage && <p role="status" className="aura-field-hint" style={{ margin: '8px 0 0' }}>{verifyMessage}</p>}
              {verifyError && <p role="alert" className="aura-login-error" style={{ margin: '8px 0 0' }}>{verifyError}</p>}
            </div>
          </div>
        </div>
      </div>
    );

  }

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
