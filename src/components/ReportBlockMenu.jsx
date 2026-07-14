import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreVertical, Ban, Flag, ShieldCheck } from 'lucide-react';
import { blockUser, unblockUser, reportUser } from '../lib/blocking';

const REPORT_REASONS = ['harassment', 'sexual_content', 'spam_or_scam', 'underage', 'other'];

// Drop this into TopBar's `right` slot (or anywhere) on any screen where
// the person is dealing with one specific other user — 1:1 chats are the
// main case. Handles both the block/unblock toggle and the report flow
// as a single self-contained modal.
export default function ReportBlockMenu({
  userId, otherUserId, blocked, context, contextId, onBlockedChange, compact = false,
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [done, setDone] = useState(false);
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!userId || !otherUserId || userId === otherUserId) return null;

  const resetAndClose = () => {
    setOpen(false); setReporting(false); setDone(false); setError(''); setReason(''); setDetails('');
  };

  const handleBlockToggle = async () => {
    setBusy(true); setError('');
    try {
      if (blocked) await unblockUser(userId, otherUserId);
      else await blockUser(userId, otherUserId);
      onBlockedChange?.(!blocked);
      resetAndClose();
    } catch (err) {
      setError(`${t('action_failed')} (${err?.code || 'unknown'})`);
    } finally {
      setBusy(false);
    }
  };

  const submitReport = async () => {
    if (!reason) return;
    setBusy(true); setError('');
    try {
      await reportUser(userId, otherUserId, { context, contextId, reason, details });
      setDone(true);
    } catch (err) {
      setError(`${t('action_failed')} (${err?.code || 'unknown'})`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={compact ? 'message__safety-btn' : 'aura-btn aura-btn-secondary aura-btn-pill'}
        onClick={() => setOpen(true)}
        aria-label={t('safety_options')}
        title={t('safety_options')}
        data-testid="safety-menu-btn"
      >
        <MoreVertical size={compact ? 13 : 14} />
      </button>

      {open && (
        <div className="aura-modal-backdrop" onClick={resetAndClose}>
          <div className="aura-modal fade-in" onClick={(e) => e.stopPropagation()} data-testid="safety-menu">
            {error && <p className="aura-login-error">{error}</p>}

            {done ? (
              <div style={{ textAlign: 'center' }}>
                <ShieldCheck size={28} style={{ color: 'var(--success)', marginBottom: 8 }} />
                <p className="aura-muted" style={{ margin: '0 0 16px' }}>{t('report_submitted')}</p>
                <button type="button" className="aura-btn aura-btn-primary" style={{ width: '100%' }} onClick={resetAndClose}>
                  {t('close')}
                </button>
              </div>
            ) : reporting ? (
              <>
                <h2 className="aura-title" style={{ marginTop: 0 }}>{t('report_user')}</h2>
                <div className="aura-field">
                  <span className="aura-field-label">{t('report_reason')}</span>
                  <div className="aura-segmented" role="radiogroup" style={{ flexWrap: 'wrap' }}>
                    {REPORT_REASONS.map((r) => (
                      <button
                        key={r}
                        type="button"
                        role="radio"
                        aria-checked={reason === r}
                        onClick={() => setReason(r)}
                        className={`aura-segmented-option${reason === r ? ' is-active' : ''}`}
                        data-testid={`report-reason-${r}`}
                      >
                        {t(`report_reason_${r}`)}
                      </button>
                    ))}
                  </div>
                </div>
                <textarea
                  className="aura-input"
                  style={{ minHeight: 80, marginTop: 10, width: '100%', resize: 'vertical' }}
                  placeholder={t('report_details_ph')}
                  value={details}
                  maxLength={1000}
                  onChange={(e) => setDetails(e.target.value)}
                  data-testid="report-details-input"
                />
                <div className="aura-row" style={{ marginTop: 14 }}>
                  <button type="button" className="aura-btn aura-btn-secondary" style={{ flex: 1 }} onClick={() => setReporting(false)} disabled={busy}>
                    {t('cancel')}
                  </button>
                  <button type="button" className="aura-btn aura-btn-primary" style={{ flex: 1 }} onClick={submitReport} disabled={busy || !reason} data-testid="submit-report-btn">
                    {t('submit_report')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="aura-title" style={{ marginTop: 0 }}>{t('safety_options')}</h2>
                <button
                  type="button"
                  className="aura-btn aura-btn-secondary"
                  style={{ width: '100%', marginBottom: 10, justifyContent: 'flex-start' }}
                  onClick={handleBlockToggle}
                  disabled={busy}
                  data-testid="block-user-btn"
                >
                  <Ban size={16} /> {blocked ? t('unblock_user') : t('block_user')}
                </button>
                <button
                  type="button"
                  className="aura-btn aura-btn-secondary"
                  style={{ width: '100%', marginBottom: 10, justifyContent: 'flex-start' }}
                  onClick={() => setReporting(true)}
                  data-testid="open-report-btn"
                >
                  <Flag size={16} /> {t('report_user')}
                </button>
                <button type="button" className="aura-btn aura-btn-secondary" style={{ width: '100%' }} onClick={resetAndClose}>
                  {t('cancel')}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
