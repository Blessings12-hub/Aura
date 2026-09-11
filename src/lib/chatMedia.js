// Shared helpers for sending voice notes, pictures, audio files, and
// generic files inside chats.
//
// Voice notes upload to a private Appwrite Storage bucket. Vercel serves the
// static frontend; Appwrite owns authenticated media and application data.
// Pictures, live stickers, and generic file attachments remain compact data
// URLs until their chat records are migrated to Appwrite Databases.

// MediaRecorder's actual output codec depends entirely on what the
// browser supports — same reasoning as MoodChat.jsx's voice notes.
const VOICE_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];

export function pickSupportedVoiceMimeType() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  return VOICE_MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

export const MAX_RECORDING_SECONDS = 300;

// Raw byte ceiling for the recorded blob before upload. Configure the same
// limit on the private Appwrite bucket; client checks are only fast-fail UX.
export const MAX_VOICE_BLOB_BYTES = 8 * 1024 * 1024;

// Uploads a recorded voice note to a private Appwrite Storage bucket.
// The returned URL is a preview URL; Appwrite permissions remain the source
// of truth, so the bucket must not be configured for public access.
export async function uploadVoiceNote(blob, mimeType, uid) {
  const { ID, requireAppwrite, storage } = await import('./appwriteClient');
  requireAppwrite();
  if (blob.size > MAX_VOICE_BLOB_BYTES) {
    throw new Error(`That recording is too large to send (max ${Math.round(MAX_VOICE_BLOB_BYTES / 1024 / 1024)}MB).`);
  }
  const bucketId = import.meta.env.VITE_APPWRITE_MEDIA_BUCKET_ID;
  if (!bucketId) throw new Error('Voice notes need VITE_APPWRITE_MEDIA_BUCKET_ID configured.');
  const ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
  const file = new File([blob], `${uid}-${Date.now()}.${ext}`, { type: mimeType });
  const uploaded = await storage.createFile(bucketId, ID.unique(), file);
  return storage.getFileView(bucketId, uploaded.$id).toString();
}

// Live stickers (short looping video clips, TikTok-style) — same
// MediaRecorder approach as voice notes, just pointed at a video track
// instead of audio. Kept deliberately short: a sticker is meant to be
// glanced at and reused, not a video message, and a longer clip would
// blow the data-URL budget below fast since video is far denser than audio.
const VIDEO_MIME_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
];

export function pickSupportedVideoMimeType() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  return VIDEO_MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

export const MAX_LIVE_STICKER_SECONDS = 5;

// Firestore hard-caps a document at 1 MiB. Base64 inflates raw bytes by
// ~33%, and the message doc also carries a few other small fields (userId,
// timestamps, reply/pin metadata later on) — 900,000 characters (~660KB
// raw) leaves comfortable headroom. Used for fileUrl (stickers/images) —
// voiceUrl no longer shares this cap now that it's a short Supabase
// Storage URL instead of embedded base64 (see firestore.rules, which now
// checks voiceUrl against a much smaller URL-appropriate length).
export const MAX_DATA_URL_CHARS = 900000;

// Raw byte ceiling checked *before* reading a picked file, so a large
// video or archive fails fast with a clear message instead of a FileReader
// pass completing only to be rejected afterwards.
export const MAX_ATTACHMENT_BYTES = 650 * 1024;

export function formatFileSize(bytes) {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Generic "read this picked file as a data URL" — used for audio files and
// arbitrary files from the file manager, neither of which can be
// compressed the way an image can.
export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error('No file selected.')); return; }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      reject(new Error(
        `That file is too large to send here (max ${Math.round(MAX_ATTACHMENT_BYTES / 1024)}KB — `
        + "there's no cloud storage on this plan, so attachments travel as part of the message itself).",
      ));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

// Chat photos are shown larger than the tiny profile-photo avatar
// (src/lib/photoUpload.js caps at 320px, tuned for a round avatar) since
// these are viewed close to full-size in the conversation itself. 1280px
// keeps real photos legible while comfortably fitting the data-URL budget.
const CHAT_IMAGE_MAX_DIMENSION = 1280;
const CHAT_IMAGE_JPEG_QUALITY = 0.78;

export function resizeChatImageToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith('image/')) {
      reject(new Error('Please choose an image file.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.onload = () => {
        const scale = Math.min(1, CHAT_IMAGE_MAX_DIMENSION / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        let quality = CHAT_IMAGE_JPEG_QUALITY;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        // Belt-and-suspenders: a very busy/high-resolution photo can still
        // land over budget after the dimension cap alone — step quality
        // down instead of failing outright before giving up.
        while (dataUrl.length > MAX_DATA_URL_CHARS && quality > 0.35) {
          quality -= 0.1;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        if (dataUrl.length > MAX_DATA_URL_CHARS) {
          reject(new Error('That image is too large to send even after compression — try a smaller photo.'));
          return;
        }
        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
