importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyD3SJuB_zajVYspjfXWccVHoENx6E-HXhk",
  authDomain: "aura-5693e.firebaseapp.com",
  projectId: "aura-5693e",
  storageBucket: "aura-5693e.firebasestorage.app",
  messagingSenderId: "1028269030459",
  appId: "1:1028269030459:web:43762becb2ccccb61c301e"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || 'Aura';
  const options = {
    body: payload?.notification?.body || 'You have a new update',
    icon: '/icon-192.png'
  };

  self.registration.showNotification(title, options);
});

// ---------------------------------------------------------------------
// Offline caching. This used to live in a separate public/service-worker.js
// that was never actually registered anywhere in the app — so there was
// no offline support at all, for anyone, ever. It's merged into THIS file
// (rather than registered as a second service worker) because two service
// workers both trying to control the same scope ('/') can fight over
// which one is actually active; Firebase's own docs support adding custom
// install/activate/fetch logic directly alongside messaging in one file,
// which is what this does.
//
// Deliberately conservative, because a badly-behaved caching service
// worker is worse than none — it can trap someone on a stale, broken
// version of the app after you've already fixed the bug. The rule this
// follows: never let a cached HTML document decide what loads. Vite gives
// every JS/CSS file a content hash per build, so those are safe to cache
// aggressively (a stale hashed file is just never referenced again by a
// new build); the HTML document itself has no hash and is what points at
// those files, so it's always fetched from the network first, with the
// cache used only as an offline fallback.
//
// CACHE_VERSION: bump this string if this caching strategy itself ever
// changes, so old caches get cleaned up on the next activate.
const CACHE_VERSION = 'aura-cache-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll([
      '/',
      '/manifest.json',
      '/icon-192.png',
      '/icon-512.png',
    ]).catch(() => {})), // tolerate a missing icon filename rather than fail install entirely
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((names) => Promise.all(
        names.filter((n) => n !== CACHE_VERSION).map((n) => caches.delete(n)),
      )),
    ]),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only ever handle same-origin GET requests — never intercept Firestore/
  // Firebase Auth/RTDB calls, or anything cross-origin. Getting this wrong
  // is a common way a "helpful" service worker breaks a real-time app.
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  const isNavigation = request.mode === 'navigate';
  const isHashedAsset = request.url.includes('/assets/');

  if (isHashedAsset) {
    // Content-hashed by Vite — safe to serve from cache first, and cache
    // whatever wasn't already there for next time.
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        return res;
      })),
    );
    return;
  }

  if (isNavigation) {
    // Network first, always — this is the one request that decides which
    // hashed JS/CSS the page loads, so a stale cached copy here is exactly
    // how someone gets stuck on a broken old version. Cache is only a
    // fallback for genuinely being offline.
    event.respondWith(
      fetch(request).catch(() => caches.match('/')),
    );
  }
});