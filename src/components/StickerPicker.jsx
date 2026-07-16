import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  collection, addDoc, deleteDoc, doc, query, orderBy, Timestamp,
} from 'firebase/firestore';
import { Plus, X, Trash2 } from 'lucide-react';
import { db } from '../firebase';
import { subscribe } from '../lib/subscribe';
import { makeStickerDataUrl } from '../lib/stickers';

// A person's personal sticker pack, stored at userStickers/{uid}/items —
// readable/writable only by its owner (see firestore.rules). Stickers are
// added either from a plain photo (resized/cut to a small transparent PNG)
// or from an image file exported out of WhatsApp's own share/save sheet
// (see lib/stickers.js for why that's the practical version of "import
// from WhatsApp" a web app can actually do).
export default function StickerPicker({ userId, onSelect, onClose }) {
  const { t } = useTranslation();
  const [stickers, setStickers] = useState([]);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!userId) return undefined;
    return subscribe(
      query(collection(db, 'userStickers', userId, 'items'), orderBy('createdAt', 'desc')),
      (snap) => setStickers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setError("Couldn't load your stickers. Check your connection and try again."),
      `sticker pack (${userId})`,
    );
  }, [userId]);

  const handleAdd = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setAdding(true);
    try {
      const dataUrl = await makeStickerDataUrl(file);
      await addDoc(collection(db, 'userStickers', userId, 'items'), {
        dataUrl, createdAt: Timestamp.now(),
      });
    } catch (err) {
      setError(err?.message || "Couldn't add that sticker.");
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (e, stickerId) => {
    e.stopPropagation();
    // eslint-disable-next-line no-alert
    if (!window.confirm(t('delete_sticker_confirm'))) return;
    setDeletingId(stickerId);
    try {
      await deleteDoc(doc(db, 'userStickers', userId, 'items', stickerId));
    } catch (err) {
      setError(err?.message || "Couldn't delete that sticker.");
    } finally {
      setDeletingId('');
    }
  };

  return (
    <div className="aura-modal-backdrop" onClick={onClose} data-testid="sticker-picker-backdrop">
      <div className="aura-modal sticker-picker fade-in" onClick={(e) => e.stopPropagation()} data-testid="sticker-picker">
        <div className="sticker-picker__header">
          <h2 className="aura-title" style={{ fontSize: '1.1rem', margin: 0 }}>{t('stickers')}</h2>
          <button type="button" className="aura-btn aura-btn-secondary aura-btn-pill" onClick={onClose} aria-label={t('close')} data-testid="sticker-picker-close">
            <X size={16} />
          </button>
        </div>

        <p className="aura-muted sticker-picker__hint">{t('import_from_whatsapp_hint')}</p>

        <input
          type="file"
          accept="image/*,.webp"
          ref={fileInputRef}
          onChange={handleAdd}
          style={{ display: 'none' }}
          data-testid="sticker-file-input"
        />

        {error && <p className="chat-card__error aura-login-error">{error}</p>}

        <div className="sticker-picker__grid" data-testid="sticker-grid">
          <button
            type="button"
            className="sticker-picker__add"
            onClick={() => fileInputRef.current?.click()}
            disabled={adding}
            aria-label={t('add_sticker')}
            data-testid="add-sticker-btn"
            title={t('make_sticker_from_photo')}
          >
            <Plus size={22} />
            <span>{adding ? t('creating_sticker') : t('add_sticker')}</span>
          </button>

          {stickers.map((s) => (
            <div key={s.id} className="sticker-picker__tile" data-testid={`sticker-tile-${s.id}`}>
              <button
                type="button"
                className="sticker-picker__pick"
                onClick={() => onSelect(s.dataUrl)}
                aria-label={t('send_sticker')}
                data-testid={`sticker-pick-${s.id}`}
              >
                <img src={s.dataUrl} alt="" className="sticker-picker__img" />
              </button>
              <button
                type="button"
                className="sticker-picker__delete"
                onClick={(e) => handleDelete(e, s.id)}
                disabled={deletingId === s.id}
                aria-label={t('delete_sticker')}
                data-testid={`sticker-delete-${s.id}`}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}

          {stickers.length === 0 && (
            <p className="aura-muted sticker-picker__empty" data-testid="sticker-empty-state">{t('no_stickers_yet')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
