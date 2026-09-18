import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import {
  ensureFirebaseSession, signInWithGoogleRecovery, firebaseConfigured,
} from '../lib/firebaseClient';
import { doc, getDoc, setDoc, COLLECTIONS, db } from '../lib/firestoreClient';
import { AVATAR_COLORS } from '../constants/moods';
import { submitIdentityDocument } from '../lib/verificationService';
import { useAuthUid } from '../hooks/useAuthUid';
import LanguageSwitcher from '../components/LanguageSwitcher';
import SelfieVerification from '../components/SelfieVerification';

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
  // step below (see justSignedUp) — by then users/{uid} already exists
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
  const [verificationPending, setVerificationPending] = useState(false);
  const [verificationFile, setVerificationFile] = useState(null);
  const [justSignedUp, setJustSignedUp] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState('');
  const [verifyError, setVerifyError] = useState('');

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
  // Two fixes in here:
  //
  //   1. This used to read firebaseAuth.currentUser directly and bail out
  //      when it was null — which it usually was on a cold load, so the
  //      "you're already verified, go straight to Match Finder" redirect
  //      almost never fired. ensureFirebaseSession() waits properly.
  //
  //   2. verificationExpiresAt is written by the admin screen as a Firestore
  //      Timestamp (Timestamp.fromMillis(...)), but this compared it with
  //      Number(...), which on a Timestamp object gives NaN — and NaN is
  //      never greater than Date.now(), so an approved account still failed
  //      the check. toMillis() is the right reader.
  //
  // The "pending" flag now comes from verificationRequests/{uid}, not from
  // users/{uid}. users/{uid}.verificationStatus is admin-written only (see
  // firestore.rules), so it is never 'pending' — that state only ever lives
  // on the request document.
  useEffect(() => {
    let active = true;
    async function checkProfile() {
      if (!firebaseConfigured) return;
      try {
        const user = await ensureFirebaseSession();
        if (!user || !active) return;

        const snap = await getDoc(doc(db, COLLECTIONS.users, user.uid));
        if (active && snap.exists()) {
          const profile = snap.data();
          const expiresAt = profile.verificationExpiresAt;
          const expiresMs = typeof expiresAt?.toMillis === 'function'
            ? expiresAt.toMillis()
            : Number(expiresAt || 0);
          if (profile.verificationStatus === 'approved' && expiresMs > Date.now()) {
            navigate('/aura/match', { replace: true });
            return;
          }
        }

        const requestSnap = await getDoc(doc(db, COLLECTIONS.verificationRequests, user.uid));
        if (active && requestSnap.exists() && requestSnap.data().status === 'pending') {
          setVerificationPending(true);
        }
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
      // spot for a new account too.
      //
      // FIXED (partial-account bug, found while adding the selfie check
      // here): verification used to be offered INSIDE this same form,
      // before the account existed yet. If someone ran a selfie check
      // before clicking this button, the server (see api/verify-selfie.js)
      // would write verification fields onto users/{uid} immediately —
      // creating that document early, with none of the profile fields
      // (age/gender/avatarColor/createdAt) this function is about to write.
      // Every other page's useCurrentUser hook treats users/{uid} existing
      // as "this is a real account", so a half-written doc could have let
      // someone into the anonymous activities with a broken profile before
      // ever finishing sign-up. Verification now only happens on the step
      // below, AFTER this write has already created the full profile doc —
      // so there is no ordering where a partial doc can exist.
      setJustSignedUp(true);
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

  // Runs only from the post-signup step below, once users/{uid} is
  // guaranteed to already exist (see the FIXED comment in handleLogin).
  const handleVerifyDocument = async () => {
    setVerifyError('');
    setVerifyMessage('');
    if (!verificationFile) {
      setVerifyError('Choose a clear photo of a government-issued ID first.');
      return;
    }
    setVerifying(true);
    try {
      const result = await submitIdentityDocument({
        userId, file: verificationFile, age: Number(age), gender,
      });
      if (result.status === 'approved') {
        setVerifyMessage("You're verified! Match Finder is unlocked.");
      } else if (result.status === 'declined') {
        setVerifyError(result.declineReason || 'This document was declined. You can try again with a clearer photo.');
      } else {
        setVerifyMessage('Document received. A reviewer will finish checking it shortly — Match Finder will unlock automatically once approved.');
      }
    } catch (err) {
      console.error('identity verification submission failed', err);
      setVerifyError(err?.message || 'Could not submit your verification request. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  if (justSignedUp) {
    return (
      <div className="aura-page aura-login-page">
        <div className="aura-shell aura-login-shell">
          <div className="aura-card aura-login-card fade-in" data-testid="login-postsignup-card">
            <div className="aura-login-hero">
              <h1 className="aura-login-title">You&apos;re in!</h1>
              <p className="aura-login-copy">Mood Chat, Daily Question, Skill Swap, Event Buddy, and Letters are ready to use right now — no verification needed for those.</p>
            </div>

            <div className="aura-field">
              <p className="aura-field-label" style={{ marginBottom: 4 }}>Want to unlock Match Finder too?</p>
              <p className="aura-muted" style={{ fontSize: '0.82rem', margin: '0 0 10px' }}>
                It&apos;s the one activity that requires age verification, since it connects you with real people. Totally optional right now — you can always do this later from Match Finder itself.
              </p>

              <SelfieVerification userId={userId} age={age} gender={gender} />

              <p className="aura-muted" style={{ fontSize: '0.82rem', margin: '2px 0 8px' }}>Or submit an ID document — always works, no camera needed:</p>
              <input
                className="aura-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => { setVerificationFile(event.target.files?.[0] || null); setVerifyError(''); setVerifyMessage(''); }}
                disabled={verifying}
                data-testid="login-verification-file"
              />
              <button type="button" className="aura-btn aura-btn-secondary" style={{ marginTop: 10 }} onClick={handleVerifyDocument} disabled={verifying || !verificationFile} data-testid="login-verify-btn">
                {verifying ? 'Checking…' : 'Submit verification'}
              </button>
              {verifyMessage && <p role="status" className="aura-field-hint" style={{ margin: '8px 0 0' }}>{verifyMessage}</p>}
              {verifyError && <p role="alert" className="aura-login-error" style={{ margin: '8px 0 0' }}>{verifyError}</p>}
            </div>

            <button
              type="button"
              onClick={() => navigate('/aura', { replace: true })}
              className="aura-btn aura-btn-primary aura-login-submit"
              data-testid="login-continue-btn"
            >
              Continue to Aura
            </button>
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
