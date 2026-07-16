// Shared helpers for sending voice notes, pictures, audio files, and
// generic files inside 1:1 chats (starting with Match Chat).
//
// There's no Firebase Storage bucket in play here (see firebase.js/
// photoUpload.js — Storage now requires the paid Blaze plan even for
// free-tier usage as of Feb 2026), so every attachment ships as a base64
// data URL embedded directly in the Firestore message document. That
// means every helper below has to enforce a hard byte ceiling well under
// Firestore's 1 MiB document limit — there's no server-side resizing or
// CDN to fall back on.

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

export const MAX_RECORDING_SECONDS = 60;

// Firestore hard-caps a document at 1 MiB. Base64 inflates raw bytes by
// ~33%, and the message doc also carries a few other small fields (userId,
// timestamps, reply/pin metadata later on) — 900,000 characters (~660KB
// raw) leaves comfortable headroom. This matches the voiceUrl cap already
// enforced server-side in firestore.rules for Mood Chat, and the same cap
// is now enforced there for matchChats too.
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
