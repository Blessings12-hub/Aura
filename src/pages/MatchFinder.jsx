import {
  useEffect, useMemo, useRef, useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  collection, addDoc, doc, setDoc, updateDoc, getDoc, query, orderBy, onSnapshot, Timestamp, where, deleteDoc, deleteField, limit,
} from '../lib/firestoreClient';
import {
  Heart, Lock, Sparkles, X, Camera, Trash2, Check, MessageCircle,
} from 'lucide-react';
import { db } from '../lib/firestoreClient';
import { getCurrentFirebaseUser } from '../lib/firebaseClient';
import { COLLECTIONS } from '../lib/firestoreClient';
import { sendNotification } from '../lib/sendNotification';
import { subscribe } from '../lib/subscribe';
import { resizePhotoToDataUrl } from '../lib/photoUpload';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useBlockedUsers } from '../hooks/useBlockedUsers';
import { moderateText, MODERATION_MESSAGES } from '../lib/contentFilter';
import { AVATAR_COLORS } from '../constants/moods';
import { submitVerification } from '../lib/verificationService';
import TopBar from '../components/TopBar';
import PageSkeleton from '../components/PageSkeleton';
import Avatar from '../components/Avatar';
import ProfileModal from '../components/ProfileModal';
import SelfieVerification from '../components/SelfieVerification';
import ReportBlockMenu from '../components/ReportBlockMenu';

const pairId = (a, b) => [a, b].sort().join('_');

// Match Finder is the one activity where two people who've never met are
// matched based on age/gender/photo — meaningfully different from an
// anonymous group chat. The account-wide minimum age (set at Login) stays
// 16, but this activity specifically requires 18, enforced both here and
// (more importantly, since client checks are never real security) in
// firestore.rules on matchProfiles and userIdentities.
const MIN_MATCH_AGE = 18;

const GENDER_OPTIONS = [
  { value: 'Female', labelKey: 'female' },
  { value: 'Male', labelKey: 'male' },
  { value: 'Non-binary', labelKey: 'non_binary' },
  { value: 'Prefer not to say', labelKey: 'prefer_not' },
];

export default function MatchFinder() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, userId, loading } = useCurrentUser();
  const blockedUsers = useBlockedUsers(userId);
  const [displayName, setDisplayName] = useState('');
  const [age, setAge] = useState('');
  const [ageConsent, setAgeConsent] = useState(false);
  const [verifying, setVerifying] = useState(false);
  // TIGHTENED, per explicit request: verification is no longer either/or
  // (a fast selfie check OR a document upload). Every submission now
  // needs BOTH — a live-captured selfie AND an ID document file — held
  // here until the person is ready to send them together. See
  // SelfieVerification.jsx (now capture-only, no independent submit) and
  // api/verify-submission.js.
  const [selfieBase64, setSelfieBase64] = useState('');
  const [verificationFile, setVerificationFile] = useState(null);
  const [verifyError, setVerifyError] = useState('');
  const [verifyMessage, setVerifyMessage] = useState('');
  // The live status of this person's OWN verificationRequests/{uid} doc —
  // separate from user.verificationStatus, which only ever reflects the
  // last COMPLETED review. This tracks a request that's still 'pending'
  // (submitted, waiting on a human or the hourly AI fallback) or was
  // 'declined', so the gate below can say something more useful than a
  // blank form.
  const [requestStatus, setRequestStatus] = useState(null);
  const [requestDeclineReason, setRequestDeclineReason] = useState('');
  useEffect(() => {
    if (!userId) return undefined;
    const unsubscribe = onSnapshot(
      doc(db, COLLECTIONS.verificationRequests, userId),
      (snap) => {
        if (!snap.exists()) { setRequestStatus(null); return; }
        const data = snap.data();
        setRequestStatus(data.status || null);
        setRequestDeclineReason(data.declineReason || '');
      },
      () => {}, // No existing request yet reads as permission-denied under
      // some rule orderings — treated the same as "nothing submitted".
    );
    return unsubscribe;
  }, [userId]);
  const handleVerify = async () => {
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
    if (!userId) {
      setVerifyError('Your Firebase session is still loading. Please try again.');
      return;
    }
    if (!age || Number(age) < MIN_MATCH_AGE) {
      setVerifyError(`Enter your age above (${MIN_MATCH_AGE}+) before submitting — it's checked against what's printed on the ID.`);
      return;
    }
    if (!gender) {
      setVerifyError('Choose a gender above before submitting.');
      return;
    }
    setVerifying(true);
    try {
      const result = await submitVerification({
        userId, selfieBase64, idFile: verificationFile, age: Number(age), gender,
      });
      if (result.alreadyVerified) {
        setVerifyMessage("You're already verified! This page will unlock now.");
      } else {
        // Nothing decides instantly anymore — every submission goes to a
        // human first, with an automatic AI fallback after an hour of no
        // action (see api/escalate-verifications.js). The onSnapshot
        // listener above will pick up whatever the eventual decision is
        // and unlock this page on its own; no need to poll or refresh.
        setVerifyMessage('Submitted for review. Most requests are reviewed within an hour — this page will unlock automatically once approved.');
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



  const [gender, setGender] = useState('');
  const [avatarColor, setAvatarColor] = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState('');
  const [removePhoto, setRemovePhoto] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [bio, setBio] = useState('');
  const [hobbies, setHobbies] = useState('');
  const [lookingFor, setLookingFor] = useState('');
  const [myCardId, setMyCardId] = useState(null);
  const [profiles, setProfiles] = useState([]);
  // Split into two slices (one per `where` query) that each get FULLY
  // replaced on every snapshot, then merged below. The old approach kept a
  // single map and only ever merged new data in — a pair that disappeared
  // from Firestore (a cancelled/rejected pending request) would never be
  // removed from local state, leaving stale "ghost" entries behind.
  const [matchesA, setMatchesA] = useState({});
  const [matchesB, setMatchesB] = useState({});
  const matches = useMemo(() => ({ ...matchesA, ...matchesB }), [matchesA, matchesB]); // pairId -> {status, theirId, isInitiator}
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  // Per-pairId "is this request in flight right now" so the button can
  // show real feedback (spinner/disabled) instead of doing nothing
  // visible while the write is in progress.
  const [pendingActions, setPendingActions] = useState({});
  const [actionError, setActionError] = useState('');
  // Identity (age/gender/photo) for people we've actually matched with,
  // fetched separately from userIdentities/{uid} — never bundled into the
  // public card, so it's never sent to a browser until a real match exists.
  const [identities, setIdentities] = useState({}); // uid -> {age, gender, displayName, photoURL}
  const [viewingProfile, setViewingProfile] = useState(null);
  // Whether MY OWN userIdentities doc actually exists in Firestore (name +
  // photo genuinely saved), as opposed to just having those fields typed
  // into the form below. Requesting or accepting a match is gated on this
  // — see requestMatch — so the other person is never left staring at a
  // match with no identity to show for it.
  const [hasSavedIdentity, setHasSavedIdentity] = useState(false);
  const profileEditorRef = useRef(null);

  // Prefill the profile editor (name/age/gender/photo) from whatever the
  // person already has on file — their own userIdentities doc, and the
  // account-level users/{uid} doc (age/gender/avatarColor originally set at
  // Login). Guarded by a ref so it only ever runs once: without it, this
  // effect re-firing on later snapshots would silently overwrite text the
  // person is actively mid-edit on.
  const prefilledIdentityRef = useRef(false);
  useEffect(() => {
    if (!userId || !user || prefilledIdentityRef.current) return;
    prefilledIdentityRef.current = true;
    setAge(user.age ? String(user.age) : '');
    setGender(user.gender || '');
    setAvatarColor(user.avatarColor || AVATAR_COLORS[0]);
    getDoc(doc(db, 'userIdentities', userId)).then((snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      if (data?.displayName) setDisplayName(data.displayName);
      if (data?.age) setAge(String(data.age));
      if (data?.gender) setGender(data.gender);
      if (data?.photoURL) setPhotoDataUrl(data.photoURL);
      if (data?.displayName) setHasSavedIdentity(true);
    }).catch(() => {});
  }, [userId, user]);

  useEffect(() => {
    if (!user?.verificationStatus || user.verificationStatus !== 'approved') return undefined;
    // Persistent by design now (not time-bounded like Mood Chat/Daily
    // Question) — a matching pool that resets every 24h can leave the
    // deck empty during low-traffic hours, which defeats the point of a
    // matching activity. limit() is a safety cap, not a time window: it
    // bounds how much a single busy deck can cost to load, but a card
    // otherwise stays visible until its owner removes it (see
    // removeMyCard below) or deletes their account.
    const q = query(
      collection(db, 'matchProfiles'),
      orderBy('createdAt', 'desc'),
      limit(300),
    );
    return subscribe(
      q,
      (snap) => setProfiles(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => setLoadError(`Profiles could not be loaded. (${err?.code || 'unknown'}: ${err?.message || err})`),
      'match profiles',
    );
    // FIXED: this effect had an empty dependency array, so React only ever
    // evaluated the `user?.verificationStatus` check ONCE, using whatever
    // `user` was on the very first render — which is null before
    // useCurrentUser's Firestore read finishes. That meant the check almost
    // always failed on mount and, because the deps never changed, never ran
    // again: an account that got verified AFTER this component's first
    // render would never see the deck load without a full page reload.
    // Depending on the two fields the check actually reads makes this
    // effect re-run exactly when the answer to "should I be subscribed"
    // could have changed.
  }, [user?.verificationStatus, user?.verificationExpiresAt]);

  // Once profiles have loaded, prefill the bio/hobbies/lookingFor fields
  // from the person's own existing card, if they already posted one — same
  // once-only guard as the identity prefill above.
  const prefilledCardRef = useRef(false);
  useEffect(() => {
    if (!userId || prefilledCardRef.current || profiles.length === 0) return;
    const mine = profiles.find((p) => p.userId === userId);
    if (!mine) return;
    prefilledCardRef.current = true;
    setMyCardId(mine.id);
    setBio(mine.bio || '');
    setHobbies(mine.hobbies || '');
    setLookingFor(mine.lookingFor || '');
  }, [profiles, userId]);

  // listen to matches where I'm involved
  useEffect(() => {
    if (!userId) return undefined;
    const unsubA = subscribe(
      query(collection(db, COLLECTIONS.matchPairs), where('userA', '==', userId)),
      (snap) => {
        const map = {};
        snap.docs.forEach((d) => { const data = d.data(); map[d.id] = { ...data, isInitiator: true, theirId: data.userB }; });
        setMatchesA(map);
      },
      (err) => setLoadError(`Matches could not be loaded. (${err?.code || 'unknown'}: ${err?.message || err})`),
      'match pairs (as userA)',
    );
    const unsubB = subscribe(
      query(collection(db, COLLECTIONS.matchPairs), where('userB', '==', userId)),
      (snap) => {
        const map = {};
        snap.docs.forEach((d) => { const data = d.data(); map[d.id] = { ...data, isInitiator: false, theirId: data.userA }; });
        setMatchesB(map);
      },
      (err) => setLoadError(`Matches could not be loaded. (${err?.code || 'unknown'}: ${err?.message || err})`),
      'match pairs (as userB)',
    );
    return () => { unsubA(); unsubB(); };
  }, [userId]);

  // Once a pair becomes 'matched', fetch the other person's identity doc.
  // Firestore rules only allow this read once matchPairs status === 'matched',
  // so this genuinely fails (silently, per onSnapshot's error handling) for
  // anyone who tries to fetch it before a real match — not just hidden by UI.
  //
  // IMPORTANT: this is keyed off `matches` directly (every pair I'm part of
  // that's reached 'matched'), NOT off whichever cards happen to still be
  // in the public `profiles` deck. A matched partner who never posted their
  // own card (they only ever browsed and requested) would otherwise be
  // invisible here forever — that mismatch was the root cause of "I
  // accepted their request but I have no way to open the chat".
  // Stable, order-independent key for "who am I currently matched with" —
  // only changes when the actual SET of matched uids changes, not on every
  // Firestore snapshot (which recreates the `matches` object reference even
  // when nothing meaningful changed). Depending on this instead of `matches`
  // directly stops the listeners below from being torn down and recreated
  // on every unrelated update.
  const matchedTheirIdsKey = useMemo(
    () => Object.values(matches)
      .filter((m) => m.status === 'matched' && m.theirId)
      .map((m) => m.theirId)
      .sort()
      .join(','),
    [matches],
  );

  useEffect(() => {
    if (!userId || !matchedTheirIdsKey) return undefined;
    const ids = matchedTheirIdsKey.split(',').filter(Boolean);
    const unsubs = ids.map((uid) => onSnapshot(
      doc(db, 'userIdentities', uid),
      (snap) => {
        setIdentities((prev) => ({ ...prev, [uid]: snap.exists() ? snap.data() : prev[uid] }));
      },
      (err) => {
        console.error(`Could not load identity for ${uid}:`, err);
        // Realtime listener hit an error (e.g. a transient permission race
        // right after the match write commits) — fall back to a one-off
        // read so the name/photo doesn't get stuck showing "loading".
        getDoc(doc(db, 'userIdentities', uid))
          .then((s) => { if (s.exists()) setIdentities((prev) => ({ ...prev, [uid]: s.data() })); })
          .catch((e) => console.error(`Fallback identity fetch failed for ${uid}:`, e));
      },
    ));
    return () => unsubs.forEach((u) => u());
  }, [matchedTheirIdsKey, userId]);

  const onPhotoChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPhotoError('');
    try {
      const dataUrl = await resizePhotoToDataUrl(file);
      setPhotoDataUrl(dataUrl);
      setRemovePhoto(false);
    } catch (err) {
      setPhotoError(err?.message || "Couldn't use that photo.");
    }
  };

  const clearPhoto = () => {
    setPhotoDataUrl('');
    setRemovePhoto(true);
  };

  const verificationExpiresAt = user?.verificationExpiresAt?.toMillis
    ? user.verificationExpiresAt.toMillis()
    : Number(user?.verificationExpiresAt || 0);
  const verifiedForMatch = user?.verificationStatus === 'approved'
    && verificationExpiresAt > Date.now()
    && user?.verifiedSex;
  const canSaveProfile = displayName.trim() && bio.trim() && hobbies.trim() && lookingFor.trim()
    && age && Number(age) >= MIN_MATCH_AGE && ageConsent && gender && avatarColor && verifiedForMatch && gender === user.verifiedSex && !saving;

  const saveProfile = async () => {
    if (!userId || !canSaveProfile) return;
    if (Number(age) < MIN_MATCH_AGE) {
      setSaveError(t('match_age_error'));
      return;
    }
    if (!ageConsent) {
      setSaveError(t('match_age_consent_required'));
      return;
    }
    if (user?.verified !== true) {
      setSaveError('Please verify your age first — see the verification step above.');
      return;
    }
    const moderationReason = moderateText(`${bio} ${hobbies} ${lookingFor} ${displayName}`);
    if (moderationReason) {
      setSaveError(MODERATION_MESSAGES[moderationReason]);
      return;
    }
    setSaving(true);
    setSaveError('');
    setSaved(false);
    try {
      const numericAge = Number(age);
      // Public card: sex, age, hobbies, bio, and what you're looking for
      // are all visible to anyone browsing, matched or not — that's the
      // whole point of a browsable deck. The only things that stay
      // gated behind a real, mutual match are your NAME and PHOTO, which
      // never go on this doc (enforced both here and by firestore.rules,
      // which rejects a matchProfiles write containing either field).
      const cardPayload = {
        avatarColor, age: numericAge, gender, ageConfirmed18: true,
        bio: bio.trim(), hobbies: hobbies.trim(), lookingFor: lookingFor.trim(),
      };
      if (myCardId) {
        await updateDoc(doc(db, 'matchProfiles', myCardId), cardPayload);
      } else {
        const ref = await addDoc(collection(db, 'matchProfiles'), {
          userId, ...cardPayload, createdAt: Timestamp.now(),
        });
        setMyCardId(ref.id);
      }
      // Name and photo live in their own doc, keyed by uid, only readable
      // by the owner or a matched partner (see firestore.rules) — this is
      // the part of your profile that unlocks only after a match. Age and
      // gender are mirrored here too, purely so the account-level record
      // stays consistent — they're not gated, since matchProfiles above
      // already shows them to everyone.
      const identityPayload = { displayName: displayName.trim(), age: numericAge, gender, ageConfirmed18: true };
      if (photoDataUrl) identityPayload.photoURL = photoDataUrl;
      else if (removePhoto) identityPayload.photoURL = deleteField();
      await setDoc(doc(db, 'userIdentities', userId), identityPayload, { merge: true });
      setHasSavedIdentity(true);
      // Keep the account-level profile in sync too, since it's the same
      // age/gender/avatarColor originally set at Login and read elsewhere.
      await setDoc(doc(db, 'users', userId), { age: numericAge, gender, avatarColor }, { merge: true });
      setRemovePhoto(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setSaveError(`Couldn't save your profile. (${err?.code || 'unknown'}: ${err?.message || err})`);
    } finally {
      setSaving(false);
    }
  };

  // A card alone isn't enough — myCardId only proves the public bio/hobbies
  // card was posted, not that name/photo were ever actually saved to
  // userIdentities (e.g. someone could in theory have an old card from
  // before that was required). Both are needed before this person can be
  // matched with anyone, so their partner always has a real profile to see.
  const hasCompletedProfile = !!myCardId && hasSavedIdentity;

  // Now that the pool is persistent (see the query above), "delete this
  // card" is the actual off-switch — without it, posting once would mean
  // being visible in Match Finder forever with no way to stop. This only
  // removes the public browsable card; it does NOT delete userIdentities
  // (name/photo) or any existing matches/chats — someone you already
  // matched with keeps that conversation and can still see your identity,
  // this just takes you out of the browsable deck for new matches.
  const [removingCard, setRemovingCard] = useState(false);
  const removeMyCard = async () => {
    if (!myCardId) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm('Remove your card from Match Finder? You can post a new one any time, but existing matches and chats stay untouched either way.')) return;
    setRemovingCard(true);
    try {
      await deleteDoc(doc(db, 'matchProfiles', myCardId));
      setMyCardId(null);
    } catch (err) {
      setSaveError(`Couldn't remove your card. (${err?.code || 'unknown'})`);
    } finally {
      setRemovingCard(false);
    }
  };

  const requestMatch = async (other) => {
    if (!userId || !other?.userId || other.userId === userId) return;
    // Requesting AND accepting both funnel through here — gating it in one
    // place means neither side of a match can ever end up without a saved
    // profile for the other person to see.
    if (!hasCompletedProfile) {
      setActionError(t('save_profile_before_matching'));
      profileEditorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const id = pairId(userId, other.userId);
    if (pendingActions[id]) return; // already in flight — ignore double-taps
    setActionError('');
    setPendingActions((prev) => ({ ...prev, [id]: true }));
    try {
      const ref = doc(db, COLLECTIONS.matchPairs, id);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, {
          userA: userId, userB: other.userId,
          userAColor: avatarColor || user?.avatarColor, userBColor: other.avatarColor,
          userAAccepted: true, userBAccepted: false,
          status: 'pending',
          createdAt: Timestamp.now(),
        });
        sendNotification({
          uid: other.userId,
          title: 'Aura • Match Finder',
          body: 'Someone wants to match with you.',
          path: '/aura/match',
        });
      } else {
        const data = snap.data();
        // if the other person requested first → accept
        if (data.userA === other.userId && !data.userBAccepted && userId === data.userB) {
          await updateDoc(ref, { userBAccepted: true, status: 'matched', matchedAt: Timestamp.now() });
          sendNotification({
            uid: data.userA,
            title: 'Aura • Match Finder',
            body: 'Your match request was accepted!',
            path: `/aura/match/chat/${id}`,
          });
        }
        if (data.userA === userId && !data.userAAccepted) {
          await updateDoc(ref, { userAAccepted: true });
        }
      }
    } catch (err) {
      setActionError(`Couldn't send that request. (${err?.code || 'unknown'}: ${err?.message || err})`);
    } finally {
      setPendingActions((prev) => { const next = { ...prev }; delete next[id]; return next; });
    }
  };

  // Deliberately deletes rather than marking 'rejected': nothing tells the
  // other person they were declined (they just see the request quietly
  // stop being pending), which avoids creating a "who rejected me" signal
  // that could be used to pester someone about it.
  const rejectMatch = async (id) => {
    if (pendingActions[id]) return;
    setActionError('');
    setPendingActions((prev) => ({ ...prev, [id]: true }));
    try {
      await deleteDoc(doc(db, 'matchPairs', id));
    } catch (err) {
      setActionError(`Couldn't do that. (${err?.code || 'unknown'}: ${err?.message || err})`);
    } finally {
      setPendingActions((prev) => { const next = { ...prev }; delete next[id]; return next; });
    }
  };

  const getMatchState = (other) => {
    const id = pairId(userId, other.userId);
    const m = matches[id];
    if (!m) return { status: 'none', id };
    return { status: m.status === 'matched' ? 'matched' : (m.userAAccepted && m.userBAccepted ? 'matched' : 'pending'), id, ...m };
  };

  const openProfile = (uid, fallbackColor) => {
    const identity = identities[uid];
    const card = profiles.find((p) => p.userId === uid);
    setViewingProfile({
      photoURL: identity?.photoURL,
      color: card?.avatarColor || fallbackColor,
      name: identity?.displayName || `Person ${uid?.slice(0, 6)}`,
      age: identity?.age,
      gender: identity?.gender,
      bio: card?.bio,
      hobbies: card?.hobbies,
      lookingFor: card?.lookingFor,
    });
    // If we don't already have their identity cached, go fetch it directly
    // rather than waiting on the background listener — this is the one
    // moment the person is actively looking at this profile, so it should
    // never be left showing a placeholder name if the data is actually
    // available to us.
    if (!identity && uid) {
      getDoc(doc(db, 'userIdentities', uid)).then((snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        setIdentities((prev) => ({ ...prev, [uid]: data }));
        setViewingProfile((prev) => (prev && prev.name?.startsWith('Person ') ? {
          ...prev,
          photoURL: data.photoURL,
          name: data.displayName || prev.name,
          age: data.age,
          gender: data.gender,
        } : prev));
      }).catch((err) => console.error(`Could not load profile for ${uid}:`, err));
    }
  };

  // Someone else's card where THEY requested YOU — distinct from a card
  // where you're the one who sent the request and are waiting. Pulled into
  // their own section below (with their own uid so the Accept button can
  // call requestMatch directly) so it's never rendered as just another
  // "locked" card in the general browse deck — that ambiguity (a request
  // to you looking identical to a request from you) was the actual bug.
  const incomingMatches = Object.entries(matches)
    .filter(([, m]) => !m.isInitiator && m.status !== 'matched')
    .map(([id, m]) => ({ id, ...m }));
  const incomingUids = new Set(incomingMatches.map((m) => m.theirId));

  // Every pair that has actually reached 'matched' — a proper "conversations"
  // list, built straight from matchPairs, that works whether or not the
  // other person ever posted a browsable card themselves.
  const myMatches = Object.entries(matches)
    .filter(([, m]) => m.status === 'matched')
    .map(([id, m]) => ({ id, ...m }))
    .sort((a, b) => (b.matchedAt?.toMillis?.() || 0) - (a.matchedAt?.toMillis?.() || 0));

  if (loading || !user) return <PageSkeleton />;

  // TIGHTENED: this used to be a soft nag — a card wedged into the profile
  // editor while the deck, matches, and every other section still rendered
  // underneath it. An unverified person could browse cards, view matches,
  // and do everything except click Save. Now nothing past this point
  // renders at all until verifiedForMatch is true — the error state is the
  // WHOLE page, not a banner alongside it. This only gates Match Finder:
  // Mood Chat, Daily Question, Skill Swap, Event Buddy, and Letters never
  // call useCurrentUser's verification fields and are unaffected.
  if (!verifiedForMatch) {
    return (
      <div className="aura-page">
        <div className="aura-shell">
          <TopBar title={t('match_finder')} subtitle={t('match_finder_desc')} onBack={() => navigate(-1)} />
          <div className="aura-card aura-section fade-in" data-testid="match-verify-gate">
            <h2 className="aura-title">Verify your age to use Match Finder</h2>
            <p className="aura-muted" style={{ margin: '0 0 12px' }}>
              Match Finder connects you with real people, so it's the one activity on Aura that requires age verification. Capture a selfie and upload a photo of a government-issued ID — a real person reviews the two together, usually within an hour; anything not reviewed by hand within that hour is checked automatically. Both images are kept only until your request is decided, then deleted.
            </p>

            {requestStatus === 'pending' && (
              <p role="alert" className="aura-login-error" data-testid="match-verify-pending" style={{ margin: '0 0 12px' }}>
                Your submission is being reviewed. This page will unlock automatically once it's approved — no need to resubmit or refresh.
              </p>
            )}
            {requestStatus === 'declined' && (
              <p role="alert" className="aura-login-error" data-testid="match-verify-declined" style={{ margin: '0 0 12px' }}>
                {requestDeclineReason || 'Your last submission was declined.'}
                {!/under 18/i.test(requestDeclineReason || '') && ' You can try again below with a clearer photo.'}
              </p>
            )}
            {!requestStatus && (
              <p role="alert" className="aura-login-error" data-testid="match-verify-required" style={{ margin: '0 0 12px' }}>
                You haven&apos;t completed verification yet — Match Finder stays locked until you do.
              </p>
            )}

            <div className="aura-field">
              <label className="aura-field-label" htmlFor="match-age-gate">{t('age')}</label>
              <input
                id="match-age-gate"
                className="aura-input"
                type="number"
                inputMode="numeric"
                min={MIN_MATCH_AGE}
                value={age}
                placeholder={t('age_placeholder')}
                onChange={(e) => setAge(e.target.value)}
                data-testid="match-verify-age-input"
              />
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
                    data-testid={`match-verify-gender-${opt.value.replace(/\s+/g, '-').toLowerCase()}`}
                  >
                    {t(opt.labelKey)}
                  </button>
                ))}
              </div>
            </div>

            <SelfieVerification captured={!!selfieBase64} onCapture={setSelfieBase64} onRetake={() => setSelfieBase64('')} />

            <div className="aura-field">
              <label className="aura-field-label" htmlFor="match-verification-file">Government-issued ID photo</label>
              <input
                id="match-verification-file"
                className="aura-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => { setVerificationFile(event.target.files?.[0] || null); setVerifyError(''); setVerifyMessage(''); }}
                disabled={verifying}
                data-testid="match-verification-file"
              />
            </div>
            <button type="button" className="aura-btn aura-btn-primary" style={{ marginTop: 10 }} onClick={handleVerify} disabled={verifying || !verificationFile || !selfieBase64} data-testid="match-verify-btn">
              {verifying ? 'Submitting…' : 'Submit verification'}
            </button>
            {verifyMessage && <p role="status" className="aura-field-hint" style={{ margin: '8px 0 0' }}>{verifyMessage}</p>}
            {verifyError && <p role="alert" className="aura-login-error" style={{ margin: '8px 0 0' }}>{verifyError}</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar title={t('match_finder')} subtitle={t('match_finder_desc')} onBack={() => navigate(-1)} />

        <div className="aura-card aura-section fade-in" ref={profileEditorRef}>
          <h2 className="aura-title">{t('your_profile')}</h2>
          <p className="aura-muted" style={{ fontSize: '0.82rem', margin: '-6px 0 4px' }}>{t('your_profile_hint')}</p>
          {!hasCompletedProfile && (
            <p className="aura-login-error" style={{ margin: '0 0 10px' }} data-testid="match-profile-required-hint">
              {t('save_profile_before_matching')}
            </p>
          )}

          <div className="profile-editor__photo-row">
            <Avatar color={avatarColor} photoURL={photoDataUrl} size={72} />
            <div className="aura-row" style={{ gap: 8 }}>
              <label className="aura-btn aura-btn-secondary aura-btn-pill" data-testid="match-photo-upload">
                <Camera size={14} /> {photoDataUrl ? t('change_photo') : t('upload_photo')}
                <input type="file" accept="image/*" onChange={onPhotoChange} style={{ display: 'none' }} />
              </label>
              {photoDataUrl && (
                <button type="button" onClick={clearPhoto} className="aura-btn aura-btn-secondary aura-btn-pill" data-testid="match-photo-remove">
                  <Trash2 size={14} /> {t('remove_photo')}
                </button>
              )}
            </div>
          </div>
          {photoError && <p className="aura-login-error" style={{ margin: '6px 0 0' }}>{photoError}</p>}

          <input className="aura-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={t('display_name_ph')} maxLength={40} data-testid="match-name" />

          <div className="aura-row">
            <input className="aura-input" style={{ flex: '1 1 120px' }} type="number" inputMode="numeric" min={MIN_MATCH_AGE} value={age} onChange={(e) => setAge(e.target.value)} placeholder={t('age_placeholder')} data-testid="match-age" />
          </div>
          {age !== '' && Number(age) < MIN_MATCH_AGE && (
            <p className="aura-login-error" style={{ margin: '4px 0 0' }} data-testid="match-age-error">
              {t('match_age_error')}
            </p>
          )}
          <label className="aura-row" style={{ gap: 8, alignItems: 'flex-start', margin: '10px 0 2px', fontSize: '0.82rem', cursor: 'pointer' }} data-testid="match-age-consent-label">
            <input
              type="checkbox"
              checked={ageConsent}
              onChange={(e) => setAgeConsent(e.target.checked)}
              style={{ marginTop: 2 }}
              data-testid="match-age-consent-checkbox"
            />
            <span>{t('match_age_consent')}</span>
          </label>
          <div className="aura-field" style={{ marginBottom: 6 }}>
            <div className="aura-segmented" role="radiogroup" aria-label={t('gender')}>
              {GENDER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={gender === opt.value}
                  onClick={() => setGender(opt.value)}
                  className={`aura-segmented-option${gender === opt.value ? ' is-active' : ''}`}
                  data-testid={`match-gender-${opt.value.replace(/\s+/g, '-').toLowerCase()}`}
                >
                  {t(opt.labelKey)}
                </button>
              ))}
            </div>
          </div>
          <div role="radiogroup" aria-label={t('pick_color')} className="aura-color-row" style={{ marginBottom: 10 }}>
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
                  data-testid={`match-color-${color.replace('#', '')}`}
                  style={{ background: color, outlineColor: active ? 'var(--primary)' : 'transparent' }}
                >
                  <span className="aura-color-chip__check" aria-hidden="true"><Check size={16} strokeWidth={3} /></span>
                </button>
              );
            })}
          </div>

          <input className="aura-input" value={bio} onChange={(e) => setBio(e.target.value)} placeholder={t('bio')} maxLength={300} data-testid="match-bio" />
          <input className="aura-input" value={hobbies} onChange={(e) => setHobbies(e.target.value)} placeholder={t('hobbies')} maxLength={300} data-testid="match-hobbies" />
          <input className="aura-input" value={lookingFor} onChange={(e) => setLookingFor(e.target.value)} placeholder={t('looking_for')} maxLength={300} data-testid="match-looking" />
          <p className="aura-muted" style={{ fontSize: '0.82rem', margin: '2px 0 10px' }}>{t('match_identity_hint')}</p>
          {saveError && <p className="aura-login-error" data-testid="match-save-error">{saveError}</p>}
          <div className="aura-row" style={{ alignItems: 'center' }}>
            <button type="button" onClick={saveProfile} disabled={!canSaveProfile} className="aura-btn aura-btn-primary" data-testid="match-post-btn">
              {saving ? t('loading') : (myCardId ? t('save_profile') : t('post_card'))}
            </button>
            {saved && <span className="aura-muted" data-testid="match-saved-msg">{t('profile_saved')}</span>}
          </div>
          {myCardId && (
            <button
              type="button"
              onClick={removeMyCard}
              disabled={removingCard}
              className="aura-btn aura-btn-secondary"
              style={{ marginTop: 8 }}
              data-testid="match-remove-card-btn"
            >
              {removingCard ? 'Removing…' : 'Remove my card from Match Finder'}
            </button>
          )}
        </div>

        {actionError && <p className="aura-login-error" data-testid="match-action-error">{actionError}</p>}

        {incomingMatches.length > 0 && (
          <>
            <h2 className="aura-title">{t('requests_for_you')} ({incomingMatches.length})</h2>
            <div className="match-deck" style={{ marginBottom: 22 }}>
              {incomingMatches.map((m) => {
                const theirCard = profiles.find((p) => p.userId === m.theirId);
                return (
                  <div key={m.id} className="match-card fade-in" data-testid={`incoming-match-${m.id}`} style={{ borderColor: 'var(--primary)', borderWidth: 2 }}>
                    <div className="aura-row" style={{ gap: 14 }}>
                      <Avatar color={theirCard?.avatarColor || m.userAColor} size={56} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="aura-row" style={{ gap: 8 }}>
                          <strong><Lock size={12} style={{ verticalAlign: -1 }} /> {theirCard ? `${theirCard.age} • ${theirCard.gender}` : t('anonymous_profile')}</strong>
                        </div>
                        {theirCard && <p className="aura-muted" style={{ margin: '6px 0 0' }}>{theirCard.bio}</p>}
                        <p className="aura-muted" style={{ margin: '4px 0 0' }}>{t('wants_to_match_you')}</p>
                      </div>
                    </div>
                    <div className="aura-row" style={{ marginTop: 8 }}>
                      <button
                        type="button"
                        onClick={() => requestMatch({ userId: m.theirId, avatarColor: m.userAColor })}
                        disabled={!!pendingActions[m.id]}
                        className="aura-btn aura-btn-primary"
                        data-testid={`accept-incoming-${m.id}`}
                      >
                        <Heart size={14} /> {pendingActions[m.id] ? t('loading') : t('accept')}
                      </button>
                      <button
                        type="button"
                        onClick={() => rejectMatch(m.id)}
                        disabled={!!pendingActions[m.id]}
                        className="aura-btn aura-btn-secondary"
                        data-testid={`decline-incoming-${m.id}`}
                      >
                        <X size={14} /> {t('decline')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}


        <h2 className="aura-title">{t('your_matches')} ({myMatches.length})</h2>
        {myMatches.length === 0 ? (
          <div className="aura-card" style={{ textAlign: 'center' }}><p className="aura-muted">{t('no_matches_yet')}</p></div>
        ) : (
          <div className="chat-roster" style={{ marginBottom: 22 }} data-testid="my-matches-list">
            {myMatches.map((m) => {
              const identity = identities[m.theirId];
              const theirColor = m.isInitiator ? m.userBColor : m.userAColor;
              const label = identity
                ? `${identity.displayName || 'Person ' + m.theirId?.slice(0, 6)}${identity.age ? ` • ${identity.age}` : ''}${identity.gender ? ` • ${identity.gender}` : ''}`
                : t('loading');
              return (
                <div key={m.id} className="chat-roster__item fade-in" data-testid={`my-match-${m.id}`}>
                  <button type="button" className="chat-roster__avatar-btn" onClick={() => openProfile(m.theirId, theirColor)} aria-label={t('view_profile')} data-testid={`view-profile-${m.id}`}>
                    <Avatar color={theirColor} photoURL={identity?.photoURL} size={52} />
                  </button>
                  <button type="button" className="chat-roster__body" onClick={() => navigate(`/aura/match/chat/${m.id}`, { state: { profile: profiles.find((p) => p.userId === m.theirId) } })} data-testid={`open-match-${m.id}`}>
                    <strong>{label}</strong>
                    <span className="chat-roster__cta"><MessageCircle size={13} /> {t('open_chat')}</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <h2 className="aura-title">{t('available_matches')} ({profiles.length})</h2>
        {loadError && <p className="aura-login-error" data-testid="match-load-error">{loadError}</p>}
        <div className="match-deck">
          {profiles.filter((p) => p.userId !== userId && !blockedUsers.has(p.userId) && !incomingUids.has(p.userId)).map((p, i) => {
            const state = getMatchState(p);
            const matched = state.status === 'matched';
            const identity = matched ? identities[p.userId] : null;
            return (
              <div key={p.id} className={`match-card fade-in delay-${Math.min(i, 3)} ${matched ? '' : 'match-locked'}`} data-testid={`match-card-${p.id}`}>
                <div className="aura-row" style={{ gap: 14, justifyContent: 'space-between' }}>
                  <div className="aura-row" style={{ gap: 14, flex: 1, minWidth: 0 }}>
                    <Avatar color={p.avatarColor} photoURL={matched ? identity?.photoURL : null} size={56} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="aura-row" style={{ gap: 8 }}>
                        <strong>
                          {matched
                            ? (identity ? `${identity.displayName || 'Person ' + p.userId?.slice(0, 6)} • ${p.age} • ${p.gender}` : t('loading'))
                            : `${p.age} • ${p.gender}`}
                        </strong>
                        {!matched && <span className="chip"><Lock size={12} /> {t('name_photo_hidden')}</span>}
                        {matched && <span className="chip" style={{ color: 'var(--success)' }}><Sparkles size={12} /> matched</span>}
                      </div>
                      <p className="aura-muted" style={{ margin: '6px 0 0' }}>{p.bio}</p>
                      <p className="aura-muted" style={{ margin: '4px 0 0' }}><strong>{t('hobbies')}:</strong> {p.hobbies}</p>
                      <p className="aura-muted" style={{ margin: '4px 0 0' }}><strong>{t('looking_for')}:</strong> {p.lookingFor}</p>
                    </div>
                  </div>
                  <ReportBlockMenu
                    userId={userId}
                    otherUserId={p.userId}
                    blocked={blockedUsers.has(p.userId)}
                    context="matchProfile"
                    contextId={p.id}
                    compact
                  />
                </div>

                <div className="aura-row" style={{ marginTop: 8 }}>
                  {matched ? (
                    <>
                      <button type="button" onClick={() => openProfile(p.userId, p.avatarColor)} className="aura-btn aura-btn-secondary" data-testid={`view-profile-deck-${p.id}`}>{t('view_profile')}</button>
                      <button type="button" onClick={() => navigate(`/aura/match/chat/${pairId(userId, p.userId)}`, { state: { profile: p } })} className="aura-btn aura-btn-primary" data-testid={`open-chat-${p.id}`}><Heart size={14} /> {t('start_chat')}</button>
                    </>
                  ) : state.status === 'pending' ? (
                    // If we reach here it must be my own outgoing request —
                    // incoming ones are filtered into the section above —
                    // so this is always the "waiting on them" state now.
                    <>
                      <button type="button" disabled className="aura-btn aura-btn-secondary" data-testid={`pending-${p.id}`}>{t('match_pending')}</button>
                      <button type="button" onClick={() => rejectMatch(state.id)} disabled={!!pendingActions[state.id]} className="aura-btn aura-btn-secondary" data-testid={`cancel-${p.id}`}><X size={14} /> {t('cancel_request')}</button>
                    </>
                  ) : (
                    <button type="button" onClick={() => requestMatch(p)} disabled={!!pendingActions[state.id]} className="aura-btn aura-btn-primary" data-testid={`request-${p.id}`}><Heart size={14} /> {pendingActions[state.id] ? t('loading') : t('request_match')}</button>
                  )}
                </div>
              </div>
            );
          })}
          {profiles.filter((p) => p.userId !== userId && !blockedUsers.has(p.userId) && !incomingUids.has(p.userId)).length === 0 && (
            <div className="aura-card" style={{ textAlign: 'center' }}><p className="aura-muted">{t('empty_no_matches')}</p></div>
          )}
        </div>
      </div>

      {viewingProfile && (
        <ProfileModal
          {...viewingProfile}
          onClose={() => setViewingProfile(null)}
        />
      )}
    </div>
  );
}
