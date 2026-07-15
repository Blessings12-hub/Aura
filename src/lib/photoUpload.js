// Turns a picked <input type="file"> image into a small base64 JPEG data
// URL, sized down client-side. Profile photos are stored directly on the
// Firestore identity doc (no Storage bucket involved), so keeping this
// small matters: Firestore documents cap out at 1 MiB, and firestore.rules
// enforces a hard ceiling on the photoURL field's length (see
// userIdentities in firestore.rules) as a server-side backstop for this.
//
// Resizing happens via an offscreen <canvas> — draw the image scaled down,
// then re-encode as JPEG at a modest quality. This routinely turns a
// multi-megabyte phone photo into well under 100KB.
const MAX_DIMENSION = 320;
const JPEG_QUALITY = 0.72;

export function resizePhotoToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith('image/')) {
      reject(new Error('Please choose an image file.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.onload = () => {
        const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
