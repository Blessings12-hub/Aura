// Helpers for a person's sticker pack (Match Chat). Same reasoning as
// chatMedia.js: no Storage bucket, so every sticker ships as a base64
// data URL — either saved into the user's personal pack (userStickers/{uid}/
// items/{id}) for reuse, or sent inline on a chat message exactly like a
// photo.
//
// "Import from WhatsApp": WhatsApp keeps its sticker packs inside its own
// app sandbox with no public export API, so a web app can't reach in and
// pull them directly. What *does* work — and is what people actually do
// today to reuse a WhatsApp sticker elsewhere — is sharing/saving the
// sticker out of WhatsApp first (WhatsApp's own "Save to gallery" / share
// sheet exports it as a .webp image), then picking that file here. The
// picker below accepts those .webp exports alongside ordinary photos.

// WhatsApp's own sticker canvas is 512x512 — matching it keeps imported
// WhatsApp stickers pixel-crisp instead of getting re-blurred by a
// mismatched resize, and is plenty for a sticker made from a photo too.
const STICKER_MAX_DIMENSION = 512;

// Stickers live inside a Firestore doc (userStickers/{uid}/items/{id}),
// same 1 MiB document ceiling as everywhere else in this app. Well under
// that with room for many stickers in the pack list query.
export const MAX_STICKER_DATA_URL_CHARS = 260000;

export function makeStickerDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith('image/')) {
      reject(new Error('Please choose an image or .webp sticker file.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.onload = () => {
        const scale = Math.min(1, STICKER_MAX_DIMENSION / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        // No fill — leave the canvas transparent so a sticker's cut-out
        // edges stay see-through instead of gaining a white/black box,
        // same as a real WhatsApp sticker.
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        // PNG (not JPEG) to keep the alpha channel — a sticker without
        // transparency is just a small square photo.
        let dataUrl = canvas.toDataURL('image/png');
        // A very busy image can still land over budget even at 512px —
        // step the dimension down instead of failing outright.
        let dim = STICKER_MAX_DIMENSION;
        while (dataUrl.length > MAX_STICKER_DATA_URL_CHARS && dim > 128) {
          dim -= 64;
          const s = Math.min(1, dim / Math.max(img.width, img.height));
          canvas.width = Math.max(1, Math.round(img.width * s));
          canvas.height = Math.max(1, Math.round(img.height * s));
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          dataUrl = canvas.toDataURL('image/png');
        }
        if (dataUrl.length > MAX_STICKER_DATA_URL_CHARS) {
          reject(new Error('That image is too detailed to make into a sticker — try a simpler one.'));
          return;
        }
        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
