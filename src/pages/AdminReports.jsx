import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  collection, query, orderBy, onSnapshot, doc, getDoc, updateDoc, Timestamp,
} from '../lib/appwriteFirestoreCompat';
import { ShieldAlert, Check, Trash2, Ban, ShieldOff } from 'lucide-react';
import { db } from '../firebase';
import {
  databases, databaseId, APPWRITE_COLLECTIONS, Query, subscribeToCollection,
} from '../lib/appwriteClient';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useIsAdmin } from '../hooks/useIsAdmin';
import TopBar from '../components/TopBar';
import PageSkeleton from '../components/PageSkeleton';

// Reports are write-only for everyone except an admin (see isAdmin() in
// firestore.rules) — this is the one screen that can actually read them.
// There's no self-service way to reach this screen either: getting here
// requires an /admins/{uid} doc that only the project owner can create,
// directly in the Firebase Console.
export default function AdminReports() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { userId, loading } = useCurrentUser();
  const { isAdmin, checked } = useIsAdmin(userId);
  const [reports, setReports] = useState([]);
  const [verificationRequests, setVerificationRequests] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [bannedStatus, setBannedStatus] = useState({}); // { [uid]: true | false }

  // Reports now live in Appwrite. There's no single onSnapshot equivalent,
  // so this does one initial listDocuments() then keeps the list fresh via
  // subscribeToCollection (which re-lists on every realtime event on this
  // collection — fine at report volumes, would need pagination at scale).
  useEffect(() => {
    if (!isAdmin) return undefined;
    let active = true;
    const queries = [Query.orderDesc('createdAt'), Query.limit(100)];
    const applyResult = (result) => { if (active) setReports(result.documents); };
    const onLoadError = () => { if (active) setLoadError('Reports could not be loaded. Check your connection and try again.'); };
    databases.listDocuments(databaseId, APPWRITE_COLLECTIONS.reports, queries).then(applyResult).catch(onLoadError);
    const unsub = subscribeToCollection(APPWRITE_COLLECTIONS.reports, queries, applyResult, onLoadError);
    return () => { active = false; unsub(); };
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return undefined;
    const q = query(collection(db, 'verificationRequests'), orderBy('submittedAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setVerificationRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, () => setLoadError('Verification requests could not be loaded.'));
    return () => unsub();
  }, [isAdmin]);

  const reviewVerification = async (request, status) => {
    setBusyId(request.id);
    try {
      await updateDoc(doc(db, 'verificationRequests', request.id), {
        status,
        reviewedAt: Timestamp.now(),
        reviewerId: userId,
      });
      await updateDoc(doc(db, 'users', request.id), {
        verified: status === 'approved',
        verificationStatus: status,
        verifiedSex: request.gender || '',
        verifiedAt: Timestamp.now(),
        verificationExpiresAt: Timestamp.fromMillis(Date.now() + 365 * 24 * 60 * 60 * 1000),
      });
    } catch (err) {
      setLoadError(`Couldn't update verification. (${err?.code || 'unknown'})`);
    } finally {
      setBusyId(null);
    }
  };

  const markReviewed = async (id) => {
    setBusyId(id);
    try {
      await databases.updateDocument(databaseId, APPWRITE_COLLECTIONS.reports, id, {
        status: 'reviewed',
        reviewedAt: new Date().toISOString(),
      });
    } catch (err) {
      setLoadError(`Couldn't update that report. (${err?.code || 'unknown'})`);
    } finally {
      setBusyId(null);
    }
  };

  const removeReport = async (id) => {
    setBusyId(id);
    try {
      await databases.deleteDocument(databaseId, APPWRITE_COLLECTIONS.reports, id);
    } catch (err) {
      setLoadError(`Couldn't delete that report. (${err?.code || 'unknown'})`);
    } finally {
      setBusyId(null);
    }
  };

  // Reads current status right before writing rather than pre-fetching
  // every reported user's ban status on page load — keeps this screen's
  // read cost proportional to actions actually taken, not report volume.
  const toggleBan = async (report) => {
    const targetUid = report.reportedId;
    if (!targetUid) return;
    setBusyId(report.$id);
    try {
      const snap = await getDoc(doc(db, 'users', targetUid));
      const currentlyBanned = snap.exists() && snap.data()?.banned === true;
      const nextBanned = !currentlyBanned;
      if (nextBanned) {
        // eslint-disable-next-line no-alert
        const confirmed = window.confirm(`Ban this user? They'll be signed out and blocked from using Aura until unbanned.`);
        if (!confirmed) { setBusyId(null); return; }
      }
      await updateDoc(doc(db, 'users', targetUid), {
        banned: nextBanned,
        banReason: nextBanned ? `Reported for: ${report.reason}` : null,
        bannedAt: nextBanned ? Timestamp.now() : null,
      });
      setBannedStatus((prev) => ({ ...prev, [targetUid]: nextBanned }));
    } catch (err) {
      setLoadError(`Couldn't update ban status. (${err?.code || 'unknown'})`);
    } finally {
      setBusyId(null);
    }
  };

  if (loading || !checked) return <PageSkeleton />;

  if (!isAdmin) {
    return (
      <div className="aura-page">
        <div className="aura-shell">
          <TopBar title={t('admin_reports')} onBack={() => navigate(-1)} />
          <div className="aura-card aura-section fade-in" style={{ textAlign: 'center' }}>
            <ShieldAlert size={28} style={{ marginBottom: 8 }} />
            <p className="aura-muted">{t('admin_not_authorized')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar title={t('admin_reports')} subtitle={`${reports.length} total`} onBack={() => navigate(-1)} />
        {loadError && <p className="aura-login-error" data-testid="admin-reports-error">{loadError}</p>}
        <section className="aura-card" style={{ marginBottom: 16 }} data-testid="verification-review-queue">
          <h2 style={{ marginTop: 0 }}>Manual verification requests</h2>
          <p className="aura-muted">Review the user&apos;s submitted age and gender using your approved manual process. Do not store identity documents in Aura.</p>
          {verificationRequests.filter((r) => r.status === 'pending').length === 0 ? <p className="aura-muted">No pending verification requests.</p> : verificationRequests.filter((r) => r.status === 'pending').map((r) => (
            <div key={r.id} className="aura-row" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--aura-border)', padding: '12px 0' }}>
              <div><strong>{r.id.slice(0, 10)}</strong><div className="aura-muted">Age {r.age || '—'} · {r.gender || '—'}</div></div>
              <div className="aura-row"><button type="button" className="aura-btn aura-btn-secondary" disabled={busyId === r.id} onClick={() => reviewVerification(r, 'declined')}>Decline</button><button type="button" className="aura-btn" disabled={busyId === r.id} onClick={() => reviewVerification(r, 'approved')}>Approve</button></div>
            </div>
          ))}
        </section>
        {reports.length === 0 ? (
          <div className="aura-card" style={{ textAlign: 'center' }}>
            <p className="aura-muted">{t('admin_no_reports')}</p>
          </div>
        ) : (
          <div className="aura-grid" data-testid="admin-reports-list">
            {reports.map((r) => (
              <div key={r.$id} className="aura-card fade-in" data-testid={`report-${r.$id}`}>
                <div className="aura-row" style={{ justifyContent: 'space-between' }}>
                  <span className="chip">{r.context || 'unknown'}{r.contextId ? ` • ${r.contextId}` : ''}</span>
                  <span className={`chip${r.status === 'reviewed' ? '' : ' chip--live'}`}>{r.status === 'reviewed' ? t('admin_reviewed') : t('admin_open')}</span>
                </div>
                <p style={{ margin: '10px 0 4px' }}><strong>{t('report_reason')}:</strong> {t(`report_reason_${r.reason}`, r.reason)}</p>
                {r.details && <p className="aura-muted" style={{ margin: '0 0 8px' }}>{r.details}</p>}
                <p className="aura-muted" style={{ fontSize: '0.8rem', margin: 0 }}>
                  Reporter {r.reporterId?.slice(0, 8)} → Reported {r.reportedId?.slice(0, 8)}
                </p>
                <p className="aura-muted" style={{ fontSize: '0.75rem', margin: '2px 0 12px' }}>
                  {r.createdAt ? new Date(r.createdAt).toLocaleString() : ''}
                </p>
                <div className="aura-row">
                  {r.status !== 'reviewed' && (
                    <button type="button" className="aura-btn aura-btn-secondary" style={{ flex: 1 }} disabled={busyId === r.$id} onClick={() => markReviewed(r.$id)} data-testid={`mark-reviewed-${r.$id}`}>
                      <Check size={14} /> {t('admin_mark_reviewed')}
                    </button>
                  )}
                  <button type="button" className="aura-btn aura-btn-secondary" style={{ flex: 1 }} disabled={busyId === r.$id} onClick={() => removeReport(r.$id)} data-testid={`delete-report-${r.$id}`}>
                    <Trash2 size={14} /> {t('delete')}
                  </button>
                </div>
                <button
                  type="button"
                  className="aura-btn"
                  style={{ width: '100%', marginTop: 8, background: bannedStatus[r.reportedId] ? undefined : '#ef4444', color: bannedStatus[r.reportedId] ? undefined : '#fff' }}
                  disabled={busyId === r.$id || !r.reportedId}
                  onClick={() => toggleBan(r)}
                  data-testid={`toggle-ban-${r.$id}`}
                >
                  {bannedStatus[r.reportedId] ? <ShieldOff size={14} /> : <Ban size={14} />}
                  {' '}
                  {bannedStatus[r.reportedId] ? 'Unban this user' : 'Ban / unban reported user'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
