# Logo update

Replaced the app icon/logo everywhere it's referenced, generated from your
uploaded image (padded to a perfect square using mirrored edges so the
gradient background stays seamless — nothing was cropped or stretched).

## Files changed
- `public/icon-512.png` — 512×512, used for PWA install / Android home screen
- `public/icon-192.png` — 192×192, used for PWA + browser tab + notifications icon
- `public/apple-touch-icon.png` — 180×180, iOS "Add to Home Screen" icon
- `public/favicon-32.png` — 32×32, browser tab fallback
- `public/icon-source.svg` / `public/favicon.svg` — vector-wrapped version of the
  same artwork (SVG containing the embedded image) so the "any size" manifest
  entry and modern-browser tab icon stay crisp at any resolution
- `index.html` — added an SVG favicon `<link>` so desktop browsers use the
  crisp vector version instead of just the 192px PNG at small sizes

`manifest.json` didn't need changes — it already pointed at `icon-192.png`,
`icon-512.png`, and `icon-source.svg` by filename, so it now picks up the
new artwork automatically.

## Note on maskable icons
Android's "maskable" icon spec crops into a circle/rounded-square and expects
the important content within the center ~80% safe zone. Your logo already
has generous padding around the knot shape, so it should survive that crop
fine — but worth checking on an actual Android device after deploying, since
I can't render Android's mask locally.
