import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  collection, addDoc, deleteDoc, doc, query, orderBy, Timestamp,
} from '../lib/appwriteFirestoreCompat';
import {
  Plus, X, Trash2, Camera, Upload, Square as StopIcon,
} from 'lucide-react';
import { db } from '../lib/appwriteFirestoreCompat';
import { subscribe } from '../lib/subscribe';
import {
  makeStickerDataUrl, readAnimatedStickerDataUrl, blobToStickerDataUrl,
  STICKER_TYPES, STICKER_SHAPES,
} from '../lib/stickers';
import { pickSupportedVideoMimeType, MAX_LIVE_STICKER_SECONDS } from '../lib/chatMedia';

// A person's personal sticker pack, stored at userStickers/{uid}/items —
// readable/writable only by its owner (see firestore.rules). Three kinds
// of sticker share the same pack (see lib/stickers.js for why):
//   - a still image made from a photo, optionally cropped to a square or
//     circle;
//   - an imported animated GIF/WebP (e.g. a WhatsApp sticker exported via
//     its own share/save sheet — WhatsApp has no public export API, so
//     that's the real-world equivalent of "import from WhatsApp" a web
//     app can do);
//   - a short looping "live" clip, either recorded right here with the
//     camera or imported as a video file (e.g. a TikTok clip exported via
//     its own share/save sheet, for the same reason).
export default function StickerPicker({ userId, onSelect, onClose }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState('stickers'); // 'stickers' | 'live'
  const [stickers, setStickers] = useState([]);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState('');

  // --- Still sticker: pick a photo, then choose a crop shape -----------
  const [pendingFile, setPendingFile] = useState(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState('');
  const [shape, setShape] = useState(STICKER_SHAPES.ORIGINAL);
  const [savingShape, setSavingShape] = useState(false);
  const imageFileInputRef = useRef(null);

  // --- Live sticker: import a gif/webp/video, or record one -----------
  const [importing, setImporting] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [liveRecording, setLiveRecording] = useState(false);
  const [liveSeconds, setLiveSeconds] = useState(0);
  const [livePreviewUrl, setLivePreviewUrl] = useState('');
  const [savingLive, setSavingLive] = useState(false);
  const animatedFileInputRef = useRef(null);
  const liveVideoRef = useRef(null);
  const streamRef = useRef(null);
  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const liveBlobRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!userId) return undefined;
    return subscribe(
      query(collection(db, 'userStickers', userId, 'items'), orderBy('createdAt', 'desc')),
      (snap) => setStickers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setError("Couldn't load your stickers. Check your connection and try again."),
      `sticker pack (${userId})`,
    );
  }, [userId]);

  const stopCameraStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const discardLivePreview = () => {
    if (livePreviewUrl) URL.revokeObjectURL(livePreviewUrl);
    liveBlobRef.current = null;
    setLivePreviewUrl('');
  };

  const discardPendingImage = () => {
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    setPendingFile(null);
    setPendingPreviewUrl('');
    setShape(STICKER_SHAPES.ORIGINAL);
  };

  // Full teardown on unmount — release the camera and any object URLs
  // rather than leaving the camera light on or leaking memory.
  useEffect(() => () => {
    clearInterval(timerRef.current);
    if (recRef.current) { try { recRef.current.stop(); } catch { /* already stopped */ } }
    stopCameraStream();
    if (livePreviewUrl) URL.revokeObjectURL(livePreviewUrl);
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = () => {
    stopCameraStream();
    discardLivePreview();
    discardPendingImage();
    onClose();
  };

  const switchTab = (next) => {
    if (next === tab) return;
    stopCameraStream();
    discardLivePreview();
    discardPendingImage();
    setError('');
    setTab(next);
  };

  // --- Still sticker flow ------------------------------------------------
  const handlePickImage = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    discardPendingImage();
    setPendingFile(file);
    setPendingPreviewUrl(URL.createObjectURL(file));
  };

  const handleSaveShapeSticker = async () => {
    if (!pendingFile) return;
    setSavingShape(true);
    setError('');
    try {
      const dataUrl = await makeStickerDataUrl(pendingFile, shape);
      await addDoc(collection(db, 'userStickers', userId, 'items'), {
        type: STICKER_TYPES.IMAGE, dataUrl, createdAt: Timestamp.now(),
      });
      discardPendingImage();
    } catch (err) {
      setError(err?.message || "Couldn't add that sticker.");
    } finally {
      setSavingShape(false);
    }
  };

  // --- Live sticker: import ----------------------------------------------
  const handleImportAnimated = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setImporting(true);
    try {
      const type = file.type?.startsWith('video/') ? STICKER_TYPES.VIDEO : STICKER_TYPES.GIF;
      const { dataUrl, mime } = await readAnimatedStickerDataUrl(file, type);
      await addDoc(collection(db, 'userStickers', userId, 'items'), {
        type, dataUrl, mime, createdAt: Timestamp.now(),
      });
    } catch (err) {
      setError(err?.message || "Couldn't import that sticker.");
    } finally {
      setImporting(false);
    }
  };

  // --- Live sticker: record -----------------------------------------------
  const startCamera = async () => {
    setError('');
    discardLivePreview();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      streamRef.current = stream;
      setCameraActive(true);
      requestAnimationFrame(() => {
        if (liveVideoRef.current) liveVideoRef.current.srcObject = stream;
      });
    } catch (e) {
      console.error('camera permission failed', e);
      setError(t('camera_error'));
    }
  };

  const stopLiveRecording = () => {
    clearInterval(timerRef.current);
    if (recRef.current) {
      recRef.current.stop();
      recRef.current = null;
    }
    setLiveRecording(false);
  };

  const startLiveRecording = () => {
    if (!streamRef.current) return;
    const mimeType = pickSupportedVideoMimeType();
    const rec = mimeType ? new MediaRecorder(streamRef.current, { mimeType }) : new MediaRecorder(streamRef.current);
    chunksRef.current = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
    rec.onstop = () => {
      clearInterval(timerRef.current);
      setLiveSeconds(0);
      const actualType = rec.mimeType || mimeType || 'video/webm';
      const blob = new Blob(chunksRef.current, { type: actualType });
      liveBlobRef.current = blob;
      setLivePreviewUrl(URL.createObjectURL(blob));
      stopCameraStream();
    };
    rec.start();
    recRef.current = rec;
    setLiveRecording(true);
    setLiveSeconds(0);
    timerRef.current = setInterval(() => {
      setLiveSeconds((s) => {
        if (s + 1 >= MAX_LIVE_STICKER_SECONDS) {
          stopLiveRecording();
          return MAX_LIVE_STICKER_SECONDS;
        }
        return s + 1;
      });
    }, 1000);
  };

  const handleSaveLiveSticker = async () => {
    if (!liveBlobRef.current) return;
    setSavingLive(true);
    setError('');
    try {
      const dataUrl = await blobToStickerDataUrl(liveBlobRef.current);
      await addDoc(collection(db, 'userStickers', userId, 'items'), {
        type: STICKER_TYPES.VIDEO, dataUrl, mime: liveBlobRef.current.type || 'video/webm', createdAt: Timestamp.now(),
      });
      discardLivePreview();
    } catch (err) {
      setError(err?.message || "Couldn't save that live sticker.");
    } finally {
      setSavingLive(false);
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

  const pickSticker = (s) => onSelect({
    dataUrl: s.dataUrl,
    mime: s.mime || 'image/png',
    type: s.type || STICKER_TYPES.IMAGE,
  });

  const isLiveType = (s) => s.type === STICKER_TYPES.VIDEO || s.type === STICKER_TYPES.GIF;
  const imageStickers = stickers.filter((s) => !isLiveType(s));
  const liveStickers = stickers.filter(isLiveType);

  return (
    <div className="aura-modal-backdrop" onClick={handleClose} data-testid="sticker-picker-backdrop">
      <div className="aura-modal sticker-picker fade-in" onClick={(e) => e.stopPropagation()} data-testid="sticker-picker">
        <div className="sticker-picker__header">
          <h2 className="aura-title" style={{ fontSize: '1.1rem', margin: 0 }}>{t('stickers')}</h2>
          <button type="button" className="aura-btn aura-btn-secondary aura-btn-pill" onClick={handleClose} aria-label={t('close')} data-testid="sticker-picker-close">
            <X size={16} />
          </button>
        </div>

        <div className="aura-row" style={{ gap: 8, margin: '0 0 8px' }}>
          <button
            type="button"
            className={`aura-btn aura-btn-pill ${tab === 'stickers' ? 'aura-btn-primary' : 'aura-btn-secondary'}`}
            onClick={() => switchTab('stickers')}
            data-testid="sticker-tab-stickers"
          >
            {t('stickers_tab_stickers')}
          </button>
          <button
            type="button"
            className={`aura-btn aura-btn-pill ${tab === 'live' ? 'aura-btn-primary' : 'aura-btn-secondary'}`}
            onClick={() => switchTab('live')}
            data-testid="sticker-tab-live"
          >
            {t('stickers_tab_live')}
          </button>
        </div>

        {error && <p className="chat-card__error aura-login-error">{error}</p>}

        {tab === 'stickers' ? (
          <>
            <p className="aura-muted sticker-picker__hint">{t('import_from_whatsapp_hint')}</p>

            <input
              type="file"
              accept="image/*,.webp"
              ref={imageFileInputRef}
              onChange={handlePickImage}
              style={{ display: 'none' }}
              data-testid="sticker-file-input"
            />

            {pendingFile ? (
              <div className="sticker-picker__pending" data-testid="sticker-shape-step">
                <div className="sticker-picker__pending-preview">
                  <img src={pendingPreviewUrl} alt="" className="sticker-picker__pending-img" />
                </div>
                <p className="aura-muted" style={{ margin: '6px 0' }}>{t('choose_sticker_shape')}</p>
                <div className="aura-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  {[STICKER_SHAPES.ORIGINAL, STICKER_SHAPES.SQUARE, STICKER_SHAPES.CIRCLE].map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`aura-btn aura-btn-pill ${shape === s ? 'aura-btn-primary' : 'aura-btn-secondary'}`}
                      onClick={() => setShape(s)}
                      data-testid={`sticker-shape-${s}`}
                    >
                      {t(`sticker_shape_${s}`)}
                    </button>
                  ))}
                </div>
                <div className="aura-row" style={{ gap: 8, marginTop: 10 }}>
                  <button type="button" className="aura-btn aura-btn-primary" onClick={handleSaveShapeSticker} disabled={savingShape} data-testid="sticker-save-shape-btn">
                    {savingShape ? t('creating_sticker') : t('save_sticker')}
                  </button>
                  <button type="button" className="aura-btn aura-btn-secondary" onClick={discardPendingImage} disabled={savingShape} data-testid="sticker-discard-shape-btn">
                    {t('discard')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="sticker-picker__grid" data-testid="sticker-grid">
                <button
                  type="button"
                  className="sticker-picker__add"
                  onClick={() => imageFileInputRef.current?.click()}
                  aria-label={t('add_sticker')}
                  data-testid="add-sticker-btn"
                  title={t('make_sticker_from_photo')}
                >
                  <Plus size={22} />
                  <span>{t('add_sticker')}</span>
                </button>

                {imageStickers.map((s) => (
                  <div key={s.id} className="sticker-picker__tile" data-testid={`sticker-tile-${s.id}`}>
                    <button
                      type="button"
                      className="sticker-picker__pick"
                      onClick={() => pickSticker(s)}
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

                {imageStickers.length === 0 && (
                  <p className="aura-muted sticker-picker__empty" data-testid="sticker-empty-state">{t('no_stickers_yet')}</p>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <p className="aura-muted sticker-picker__hint">{t('live_sticker_hint')}</p>

            <input
              type="file"
              accept="image/gif,image/webp,video/*"
              ref={animatedFileInputRef}
              onChange={handleImportAnimated}
              style={{ display: 'none' }}
              data-testid="live-sticker-file-input"
            />

            {livePreviewUrl ? (
              <div className="sticker-picker__pending" data-testid="live-sticker-preview-step">
                <video src={livePreviewUrl} className="sticker-picker__pending-img" muted autoPlay loop playsInline />
                <div className="aura-row" style={{ gap: 8, marginTop: 10 }}>
                  <button type="button" className="aura-btn aura-btn-primary" onClick={handleSaveLiveSticker} disabled={savingLive} data-testid="live-sticker-save-btn">
                    {savingLive ? t('creating_live_sticker') : t('save_sticker')}
                  </button>
                  <button type="button" className="aura-btn aura-btn-secondary" onClick={discardLivePreview} disabled={savingLive} data-testid="live-sticker-discard-btn">
                    {t('discard')}
                  </button>
                </div>
              </div>
            ) : cameraActive ? (
              <div className="sticker-picker__pending" data-testid="live-sticker-camera-step">
                <video ref={liveVideoRef} className="sticker-picker__pending-img" muted autoPlay playsInline />
                <div className="aura-row" style={{ gap: 8, marginTop: 10 }}>
                  {liveRecording ? (
                    <button type="button" className="aura-btn aura-btn-danger" onClick={stopLiveRecording} data-testid="live-sticker-stop-btn">
                      <StopIcon size={16} /> {t('stop_recording')} ({Math.max(0, MAX_LIVE_STICKER_SECONDS - liveSeconds)}s)
                    </button>
                  ) : (
                    <button type="button" className="aura-btn aura-btn-primary" onClick={startLiveRecording} data-testid="live-sticker-start-btn">
                      <Camera size={16} /> {t('record_live_sticker')}
                    </button>
                  )}
                  <button type="button" className="aura-btn aura-btn-secondary" onClick={stopCameraStream} disabled={liveRecording} data-testid="live-sticker-cancel-camera-btn">
                    {t('discard')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="sticker-picker__grid" data-testid="live-sticker-grid">
                <button
                  type="button"
                  className="sticker-picker__add"
                  onClick={startCamera}
                  aria-label={t('record_live_sticker')}
                  data-testid="record-live-sticker-btn"
                  title={t('record_live_sticker')}
                >
                  <Camera size={22} />
                  <span>{t('record_live_sticker')}</span>
                </button>
                <button
                  type="button"
                  className="sticker-picker__add"
                  onClick={() => animatedFileInputRef.current?.click()}
                  disabled={importing}
                  aria-label={t('import_live_sticker')}
                  data-testid="import-live-sticker-btn"
                  title={t('import_live_sticker')}
                >
                  <Upload size={22} />
                  <span>{importing ? t('creating_live_sticker') : t('import_live_sticker')}</span>
                </button>

                {liveStickers.map((s) => (
                  <div key={s.id} className="sticker-picker__tile" data-testid={`sticker-tile-${s.id}`}>
                    <button
                      type="button"
                      className="sticker-picker__pick"
                      onClick={() => pickSticker(s)}
                      aria-label={t('send_sticker')}
                      data-testid={`sticker-pick-${s.id}`}
                    >
                      {s.type === STICKER_TYPES.VIDEO ? (
                        <video src={s.dataUrl} className="sticker-picker__img" muted autoPlay loop playsInline />
                      ) : (
                        <img src={s.dataUrl} alt="" className="sticker-picker__img" />
                      )}
                      <span className="sticker-picker__live-badge">{t('live_sticker_badge')}</span>
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

                {liveStickers.length === 0 && (
                  <p className="aura-muted sticker-picker__empty" data-testid="live-sticker-empty-state">{t('no_live_stickers_yet')}</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
