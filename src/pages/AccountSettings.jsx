import { useEffect, useState } from 'react';
import { linkGoogleAccount, deleteCurrentFirebaseUser } from '../lib/firebaseClient';
import {
  doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs, COLLECTIONS, db,
} from '../lib/firestoreClient';
import { useNavigate } from 'react-router-dom';
import {
  Download, Trash2, AlertTriangle, ShieldCheck, UserCog,
} from 'lucide-react';
import { useCurrentUser } from '../hooks/useCurrentUser';
import TopBar from '../components/TopBar';
import PageSkeleton from '../components/PageSkeleton';

// Matches Login.jsx's account-wide minimum. Not shared as a constant
// across files — MatchFinder.jsx already has its own local MIN_MATCH_AGE
// for the same reason (18 there, specific to Match Finder), so this
// follows the existing pattern rather than introducing a new shared
// constants module for a single number.
const MIN_AGE = 16;

const GENDER_OPTIONS = [
  { value: 'Female', label: 'Female' },
  { value: 'Male', label: 'Male' },
  { value: 'Non-binary', label: 'Non-binary' },
  { value: 'Prefer not to say', label: 'Prefer not to say' },
];

// Honest scope note, also shown in the UI below: this covers the account
// itself — the users/{uid}, userIdentities/{uid}, matchProfiles, and
// pushTokens/{uid} docs, all of which the client can read/write/delete
// directly per firestore.rules. It deliberately does NOT reach into every
// mood-chat/daily-question/skill-swap/event message the person has ever
// sent, scattered across many collections and subcollections — a true
// full erasure of that needs a server-side Cloud Function that can walk
// and batch-delete across all of them (similar to the push-notification
// functions already in functions/index.js). That's a real, separate,
// larger piece of work, not something to fake here.
export default function AccountSettings() {
  const navigate = useNavigate();
  const { user, userId, loading } = useCurrentUser();
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linkedEmail, setLinkedEmail] = useState(user?.linkedEmail || null);
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState('');
  // Prefilled once `user` loads — see the effect below. Any account
  // created before an earlier fix stored age as a string rather than a
  // number; this reads either shape, and saving here normalizes it to a
  // proper number going forward (see handleSaveProfile).
  const [ageDraft, setAgeDraft] = useState('');
  const [genderDraft, setGenderDraft] = useState('');
  const [profileTouched, setProfileTouched] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [profileError, setProfileError] = useState('');

  useEffect(() => {
    if (!user || profileTouched) return;
    if (user.age !== undefined && user.age !== null && user.age !== '') setAgeDraft(String(user.age));
    if (user.gender) setGenderDraft(user.gender);
  }, [user, profileTouched]);

  if (loading || !user) return <PageSkeleton />;

  // Anonymous accounts (what everyone on Aura starts as) have no password
  // and no way to sign back in on a new device or after clearing cache —
  // clear localStorage and the whole profile, matches, and history are
  // gone for good. Linking a Google account doesn't make the account any
  // less anonymous inside Aura (no name/email is ever shown to other
  // users — this is purely a recovery credential), it just gives this
  // same uid a way back in. See handleRecover in Login.jsx for the other
  // half of this — signing in with the same Google account there resolves
  // straight back to this account instead of creating a new one.
  const handleLinkGoogle = async () => {
    setError('');
    setLinking(true);
    try {
      const linkedUser = await linkGoogleAccount();
      setLinkedEmail(linkedUser.email || 'your Google account');
    } catch (e) {
      console.error('Google link failed', e);
      setError(e?.code === 'auth/credential-already-in-use'
        ? 'That Google account is already linked to a different Aura account.'
        : 'Could not link your Google account. Please try again.');
    } finally {
      setLinking(false);
    }
  };

  // The gap this closes: before this card existed, there was no way
  // anywhere in Aura to correct age or gender once submitted at signup —
  // not here, not on Login's verification step (which only ever displays
  // whatever's already on file, with no editable fields of its own). A
  // typo at signup, or simply turning 18, had no recovery path short of
  // deleting the account and starting over. This writes straight to
  // users/{uid}; firestore.rules' owner-update branch already allows age/
  // gender changes freely (see validAge()) — the fields it locks down
  // (verified, verificationStatus, verifiedSex, verificationExpiresAt) are
  // untouched by this write.
  //
  // Deliberately NOT touched here: an existing Match Finder verification.
  // Changing age doesn't revoke verificationStatus — the verified age from
  // a real ID/selfie check is the actual ground truth, this field is a
  // display/convenience value. Changing gender similarly doesn't revoke
  // verificationStatus, but Match Finder's own save check already requires
  // gender === verifiedSex before a card can be saved — so a gender change
  // here naturally blocks re-saving a Match Finder card until they
  // re-verify with the new value, without this screen needing to know
  // anything about that.
  const handleSaveProfile = async () => {
    setProfileError('');
    setProfileMessage('');
    const numericAge = Number(ageDraft);
    if (!ageDraft || !Number.isFinite(numericAge) || numericAge < MIN_AGE) {
      setProfileError(`Age must be ${MIN_AGE} or older.`);
      return;
    }
    if (!genderDraft) {
      setProfileError('Choose a gender.');
      return;
    }
    setSavingProfile(true);
    try {
      await setDoc(doc(db, COLLECTIONS.users, userId), {
        age: numericAge, gender: genderDraft, updatedAt: new Date().toISOString(),
      }, { merge: true });
      setProfileMessage('Saved.');
    } catch (e) {
      console.error('profile update failed', e);
      setProfileError('Could not save your changes. Please try again.');
    } finally {
      setSavingProfile(false);
    }
  };

  const gatherAccountData = async () => {
    const [identitySnap, cardsSnap] = await Promise.all([
      getDoc(doc(db, 'userIdentities', userId)),
      getDocs(query(collection(db, 'matchProfiles'), where('userId', '==', userId))),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      account: user,
      matchIdentity: identitySnap.exists() ? identitySnap.data() : null,
      matchProfileCards: cardsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      note: 'This export covers your account profile and Match Finder identity/cards. It does not include individual chat messages you\'ve sent across Mood Chat, Daily Question, Skill Swap, or Event Buddy.',
    };
  };

  const handleExport = async () => {
    setError('');
    setExporting(true);
    try {
      const data = await gatherAccountData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `aura-account-data-${userId}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('export failed', e);
      setError('Could not export your data. Check your connection and try again.');
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    if (confirmText.trim().toUpperCase() !== 'DELETE') return;
    setError('');
    setDeleting(true);
    try {
      const cardsSnap = await getDocs(query(collection(db, 'matchProfiles'), where('userId', '==', userId)));
      await Promise.all([
        ...cardsSnap.docs.map((d) => deleteDoc(doc(db, 'matchProfiles', d.id))),
        deleteDoc(doc(db, 'userIdentities', userId)).catch(() => {}),
        deleteDoc(doc(db, 'pushTokens', userId)).catch(() => {}),
        deleteDoc(doc(db, 'users', userId)),
      ]);
      await deleteCurrentFirebaseUser();
      navigate('/');
    } catch (e) {
      console.error('account deletion failed', e);
      setError('Something went wrong deleting your account. Nothing has been changed — please try again, or reload the app first if this keeps happening.');
      setDeleting(false);
    }
  };

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar title="Account settings" onBack={() => navigate('/aura')} />


        <div className="aura-card fade-in" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <UserCog size={18} /> Profile info
          </h2>
          <p className="aura-muted">
            Your age and gender as Aura has them on file. This is also what Match Finder verification checks against, so keep it accurate.
          </p>

          <div className="aura-field">
            <label className="aura-field-label" htmlFor="settings-age">Age</label>
            <input
              id="settings-age"
              className="aura-input"
              type="number"
              inputMode="numeric"
              min={MIN_AGE}
              value={ageDraft}
              onChange={(e) => { setAgeDraft(e.target.value); setProfileTouched(true); setProfileMessage(''); }}
              data-testid="settings-age-input"
            />
          </div>

          <div className="aura-field">
            <span className="aura-field-label">Gender</span>
            <div className="aura-segmented" role="radiogroup" aria-label="Gender">
              {GENDER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={genderDraft === opt.value}
                  onClick={() => { setGenderDraft(opt.value); setProfileTouched(true); setProfileMessage(''); }}
                  className={`aura-segmented-option${genderDraft === opt.value ? ' is-active' : ''}`}
                  data-testid={`settings-gender-${opt.value.replace(/\s+/g, '-').toLowerCase()}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {user?.verificationStatus === 'approved' && genderDraft && genderDraft !== user?.verifiedSex && (
            <p className="aura-muted" style={{ fontSize: '0.82rem' }}>
              Heads up: this differs from the gender your Match Finder verification is on file for. You can still save it, but you&apos;ll need to re-verify with this gender before Match Finder will use it.
            </p>
          )}

          <button
            type="button"
            className="aura-btn aura-btn-primary"
            onClick={handleSaveProfile}
            disabled={savingProfile}
            data-testid="settings-save-profile-btn"
          >
            {savingProfile ? 'Saving…' : 'Save changes'}
          </button>
          {profileMessage && <p role="status" className="aura-field-hint" style={{ margin: '8px 0 0' }}>{profileMessage}</p>}
          {profileError && <p role="alert" className="aura-login-error" style={{ margin: '8px 0 0' }}>{profileError}</p>}
        </div>

        <div className="aura-card fade-in" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldCheck size={18} /> Back up your account
          </h2>
          <p className="aura-muted">
            Aura is anonymous by design — there's no password, no email required. That also means if you clear your browser data, switch phones, or reinstall, there is normally no way back into this exact profile, matches, or history.
          </p>
          <p className="aura-muted">
            Linking a Google account fixes that, without making you any less anonymous inside Aura — nobody else ever sees your name or email, it's only used to get back into this account from a new device.
          </p>
          {linkedEmail ? (
            <p style={{ fontWeight: 600 }} data-testid="linked-account-status">✓ Linked to {linkedEmail}</p>
          ) : (
            <button
              type="button"
              className="aura-btn aura-btn-secondary"
              onClick={handleLinkGoogle}
              disabled={linking}
              data-testid="link-google-btn"
            >
              {linking ? 'Linking…' : 'Link a Google account'}
            </button>
          )}
        </div>

        <div className="aura-card fade-in" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Export your data</h2>
          <p className="aura-muted">
            Download a copy of your account profile and Match Finder identity/cards as a JSON file.
          </p>
          <button
            type="button"
            className="aura-btn aura-btn-secondary"
            onClick={handleExport}
            disabled={exporting}
            data-testid="export-data-btn"
          >
            <Download size={16} style={{ marginRight: 6 }} />
            {exporting ? 'Preparing…' : 'Export my data'}
          </button>
        </div>

        <div className="aura-card fade-in" style={{ marginTop: 16, borderColor: '#ef4444' }}>
          <h2 style={{ marginTop: 0, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={18} /> Delete your account
          </h2>
          <p className="aura-muted">
            This permanently deletes your account profile, Match Finder identity, and match cards, and signs you out for good — this device won't be able to get this data back.
          </p>
          <p className="aura-muted" style={{ fontSize: '0.85rem' }}>
            This does not delete individual messages you've already sent in Mood Chat, Daily Question, Skill Swap, or Event Buddy — those stay as part of the conversations they're part of.
          </p>
          <label className="aura-field-label" htmlFor="delete-confirm">
            Type DELETE to confirm
          </label>
          <input
            id="delete-confirm"
            className="aura-input"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
            data-testid="delete-confirm-input"
          />
          <button
            type="button"
            className="aura-btn"
            style={{ background: '#ef4444', color: '#fff', marginTop: 10 }}
            onClick={handleDelete}
            disabled={deleting || confirmText.trim().toUpperCase() !== 'DELETE'}
            data-testid="delete-account-btn"
          >
            <Trash2 size={16} style={{ marginRight: 6 }} />
            {deleting ? 'Deleting…' : 'Permanently delete my account'}
          </button>
        </div>

        {error && <p className="aura-login-error" style={{ marginTop: 12 }}>{error}</p>}
      </div>
    </div>
  );
}
