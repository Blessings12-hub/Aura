import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Avatar from './Avatar';

// Read-only "contact info" style panel — the person you've matched with,
// shown next to their name the way a chat app shows a contact card. Opened
// from the Matches list or by tapping the chat header; never editable here,
// since the only profile anyone can edit is their own (see the profile
// editor built into MatchFinder's "your card" panel).
export default function ProfileModal({ onClose, photoURL, color, name, age, gender, bio, hobbies, lookingFor }) {
  const { t } = useTranslation();
  return (
    <div className="aura-modal-backdrop" onClick={onClose} data-testid="profile-modal-backdrop">
      <div className="aura-modal profile-modal fade-in" onClick={(e) => e.stopPropagation()} data-testid="profile-modal">
        <button type="button" className="aura-btn aura-btn-secondary aura-btn-pill profile-modal__close" onClick={onClose} aria-label={t('close')} data-testid="profile-modal-close">
          <X size={16} />
        </button>
        <div className="profile-modal__header">
          <Avatar color={color} photoURL={photoURL} size={84} />
          <h2 className="aura-title" style={{ fontSize: '1.4rem', margin: '10px 0 0' }} data-testid="profile-modal-name">{name}</h2>
          {(age || gender) && <p className="aura-muted" style={{ margin: '2px 0 0' }}>{[age, gender].filter(Boolean).join(' • ')}</p>}
        </div>
        {bio && (
          <div className="profile-modal__section">
            <span className="aura-field-label">{t('bio')}</span>
            <p style={{ margin: '4px 0 0' }}>{bio}</p>
          </div>
        )}
        {hobbies && (
          <div className="profile-modal__section">
            <span className="aura-field-label">{t('hobbies')}</span>
            <p style={{ margin: '4px 0 0' }}>{hobbies}</p>
          </div>
        )}
        {lookingFor && (
          <div className="profile-modal__section">
            <span className="aura-field-label">{t('looking_for')}</span>
            <p style={{ margin: '4px 0 0' }}>{lookingFor}</p>
          </div>
        )}
      </div>
    </div>
  );
}
