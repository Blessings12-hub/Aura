# Aura — fix: selfie camera never opened

One file: `src/components/SelfieVerification.jsx`. Extract over
`Aura-main/`, replacing the version from the last patch.

## The bug

`startCamera` did this, in this order:

```js
const stream = await navigator.mediaDevices.getUserMedia(...);
streamRef.current = stream;
if (videoRef.current) {                 // <-- always null here
  videoRef.current.srcObject = stream;
  await videoRef.current.play();
}
setCameraOn(true);                       // <-- THIS is what mounts <video>
```

The `<video>` element only exists in the DOM once `cameraOn` is `true` — but
`videoRef.current.srcObject = stream` runs *before* `setCameraOn(true)`, so
at that point `videoRef.current` is still `null`. The `if` guard silently
skips the whole block, `setCameraOn(true)` then renders a `<video>` with
nothing ever attached to it, and the result is a permanently blank box.

This is why it looked like a permissions problem: `getUserMedia` actually
succeeded every time — the browser's permission prompt fired, the stream
was granted — it just never reached the screen. Nothing here depended on
device, browser, or network, which is why it failed identically on both
phone and desktop, every single time. A real permission denial or
HTTPS/insecure-context problem would have looked different (and now does,
see below) — this was a plain ordering bug.

## The fix

Acquire the stream, call `setCameraOn(true)` to mount the `<video>`, and
attach the stream in a `useEffect` keyed on `cameraOn` that runs once that
element actually exists:

```js
useEffect(() => {
  if (cameraOn && videoRef.current && streamRef.current) {
    videoRef.current.srcObject = streamRef.current;
    videoRef.current.play().catch(...);
  }
}, [cameraOn]);
```

## Also improved while I was in there

The `catch` block used to fold every possible failure — permission denied,
no camera present, an insecure context — into one generic "camera isn't
available" message, which is part of why this was hard to diagnose from the
symptom alone. It now checks `err.name` and shows a specific message for
`NotAllowedError`/`SecurityError` (permission denied — check browser/site
settings) versus `NotFoundError` (no camera on this device), and logs the
real error name to the console either way. If something else is still wrong
after this fix, the browser console will now say which of these it actually
is instead of one indistinguishable bucket.
