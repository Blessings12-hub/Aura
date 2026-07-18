// Helpers for a person's sticker pack (Mood Chat, Daily Question, Match
// Chat). Same reasoning as chatMedia.js: no Storage bucket, so every
// sticker ships as a base64 data URL — either saved into the user's
// personal pack (userStickers/{uid}/items/{id}) for reuse, or sent inline
// on a chat message exactly like a photo.
//
// Three kinds of sticker live in the same pack, distinguished by `type`:
//   'image'  — a still PNG made from a photo (optionally cropped to a
//              square or circle cut-out).
//   'gif'    — an imported animated GIF or animated WebP, kept as-is so
//              the animation survives (an earlier version of this file
//              flattened everything through a <canvas>, which only ever
//              captures a single frame — that's why old "WhatsApp
//              stickers" imported here used to freeze).
//   'video'  — a short looping clip, either recorded in-app from the
//              camera or imported as a video file — the "live sticker"
//              option, sent/rendered as a small muted looping <video>.
//
// "Pull from WhatsApp / TikTok": neither app exposes a public API for a
// third-party site to reach into someone's sticker pack and pull stickers
// out directly — there's no legitimate way around that from a web app.
// What *does* work, and is what people actually do today to reuse a
// sticker elsewhere, is exporting it out of the source app first (WhatsApp's
// own "Save to gallery" / share sheet exports a .webp image; TikTok's
// share/save exports an .mp4 clip), then picking that file here. The
// pickers below accept those exports directly.

export const STICKER_TYPES = { IMAGE: 'image', GIF: 'gif', VIDEO: 'video' };

export const STICKER_SHAPES = { ORIGINAL: 'original', SQUARE: 'square', CIRCLE: 'circle' };

// WhatsApp's own sticker canvas is 512x512 — matching it keeps imported
// WhatsApp stickers pixel-crisp instead of getting re-blurred by a
// mismatched resize, and is plenty for a sticker made from a photo too.
const STICKER_MAX_DIMENSION = 512;

// Stickers live inside a Firestore doc (userStickers/{uid}/items/{id}),
// same 1 MiB document ceiling as everywhere else in this app. Well under
// that with room for many stickers in the pack list query.
export const MAX_STICKER_DATA_URL_CHARS = 260000;

// Animated stickers (gif/webp/video) can't be losslessly re-encoded to a
// smaller size from the browser alone the way a still photo can, so
// instead of silently degrading them there's a firmer cap on the *source*
// file, checked before it's even read — fails fast with a clear message
// pointing at compressing the file first, rather than a slow read that
// gets rejected at the end anyway.
export const MAX_ANIMATED_SOURCE_BYTES = 550 * 1024;
export const MAX_ANIMATED_STICKER_DATA_URL_CHARS = 750000;

function cropRectForShape(img, shape) {
  if (shape === STICKER_SHAPES.ORIGINAL) {
    return {
      sx: 0, sy: 0, sw: img.width, sh: img.height, outW: img.width, outH: img.height,
    };
  }
  // Square/circle both start from a centered square crop of the image.
  const side = Math.min(img.width, img.height);
  return {
    sx: (img.width - side) / 2,
    sy: (img.height - side) / 2,
    sw: side,
    sh: side,
    outW: side,
    outH: side,
  };
}

// Makes a still sticker (PNG, alpha preserved) from a photo. `shape`
// controls the crop: 'original' keeps the photo's own aspect ratio,
// 'square' center-crops to a square, 'circle' does the same then clips it
// to a circle — three quick presets rather than a full crop/rotate editor,
// since a sticker is meant to be made in a couple of taps.
export function makeStickerDataUrl(file, shape = STICKER_SHAPES.ORIGINAL) {
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
        const draw = (dim) => {
          const crop = cropRectForShape(img, shape);
          const scale = Math.min(1, dim / Math.max(crop.outW, crop.outH));
          const w = Math.max(1, Math.round(crop.outW * scale));
          const h = Math.max(1, Math.round(crop.outH * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          // No fill — leave the canvas transparent so a sticker's cut-out
          // edges stay see-through instead of gaining a white/black box,
          // same as a real WhatsApp sticker.
          ctx.clearRect(0, 0, w, h);
          if (shape === STICKER_SHAPES.CIRCLE) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(w / 2, h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();
          }
          ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, w, h);
          if (shape === STICKER_SHAPES.CIRCLE) ctx.restore();
          // PNG (not JPEG) to keep the alpha channel — a sticker without
          // transparency is just a small square photo.
          return canvas.toDataURL('image/png');
        };

        let dim = STICKER_MAX_DIMENSION;
        let dataUrl = draw(dim);
        // A very busy image can still land over budget even at 512px —
        // step the dimension down instead of failing outright.
        while (dataUrl.length > MAX_STICKER_DATA_URL_CHARS && dim > 128) {
          dim -= 64;
          dataUrl = draw(dim);
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

// Reads an animated GIF/WebP (or a short video file) straight through as a
// base64 data URL, with no canvas step in between — a canvas only ever
// captures the current frame, so running an animated file through one the
// way makeStickerDataUrl() does for photos would silently freeze it on
// frame one. The trade-off is there's no client-side re-compression
// available for these formats, so the source file itself is capped
// (MAX_ANIMATED_SOURCE_BYTES) and checked before reading rather than after.
export function readAnimatedStickerDataUrl(file, type) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error('No file selected.')); return; }
    const isVideo = type === STICKER_TYPES.VIDEO;
    const validMime = isVideo
      ? file.type?.startsWith('video/')
      : (file.type === 'image/gif' || file.type === 'image/webp');
    if (!validMime) {
      reject(new Error(isVideo
        ? 'Please choose a video file (e.g. an exported TikTok .mp4 clip).'
        : 'Please choose an animated GIF or animated WebP (e.g. an exported WhatsApp sticker).'));
      return;
    }
    if (file.size > MAX_ANIMATED_SOURCE_BYTES) {
      reject(new Error(`That file is too large (max ${Math.round(MAX_ANIMATED_SOURCE_BYTES / 1024)}KB) — try a shorter clip or a smaller export.`));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      if (reader.result.length > MAX_ANIMATED_STICKER_DATA_URL_CHARS) {
        reject(new Error('That file is too large to save as a sticker — try a shorter or smaller one.'));
        return;
      }
      resolve({ dataUrl: reader.result, mime: file.type });
    };
    reader.readAsDataURL(file);
  });
}

// Converts a recorded live-sticker Blob (from MediaRecorder, see
// StickerPicker's camera recorder) to a capped base64 data URL — same
// budget as an imported video file.
export function blobToStickerDataUrl(blob) {
  return new Promise((resolve, reject) => {
    if (!blob) { reject(new Error('Nothing was recorded.')); return; }
    if (blob.size > MAX_ANIMATED_SOURCE_BYTES) {
      reject(new Error('That recording was too long to save — try a shorter clip.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that recording.'));
    reader.onload = () => {
      if (reader.result.length > MAX_ANIMATED_STICKER_DATA_URL_CHARS) {
        reject(new Error('That recording was too long to save — try a shorter clip.'));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(blob);
  });
}
