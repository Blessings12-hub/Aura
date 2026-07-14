# Aura

> A mood-based social app for anonymous chat, matching, and shared activities.

Aura helps people connect by mood, chat safely, and join lightweight activities
with others. No accounts, no persistent profiles — everything is tied to an
anonymous session.

[![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=000)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=fff)](https://vite.dev/)
[![Firebase](https://img.shields.io/badge/Firebase-12-ffca28?logo=firebase&logoColor=000)](https://firebase.google.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

---

## Activities

| Activity | What it is |
| --- | --- |
| **Mood Chat** | Anonymous real-time group chat for everyone currently feeling the same mood. |
| **Daily Question** | A prompt that rotates daily. Answers land in a shared, date-scoped thread. |
| **Event Buddy** | Post an event (concert, dinner, walk); others request to join, host accepts, group chat opens. |
| **Match Finder** | Create a hidden profile (name, age, bio); browse anonymous cards; identity reveals only on a mutual match, which opens a private chat. |
| **Skill Swap** | Offer a skill and what you want to learn; match with someone, chat, and optionally start a video call once both sides consent. |
| **Collab Studio** | A shared canvas people draw on together in real time, with a live chat panel alongside it. |

## Tech stack

- **React 19** + **Vite 8** — UI and dev tooling
- **React Router 7** — client-side routing
- **Firebase** — Firestore (data), Realtime Database (presence), Storage (voice notes), Auth (anonymous), Cloud Messaging (push notifications), WebRTC signalled over Firestore (Skill Swap video calls)
- **react-i18next** — multi-language support
- **PWA** — installable, offline-cached shell via a service worker

## Project layout

```
aura/
├── public/                     # Static assets, manifest, service workers
│   ├── manifest.json
│   ├── service-worker.js
│   └── firebase-messaging-sw.js
├── src/
│   ├── components/             # Reusable UI components
│   ├── constants/               # Static data (moods, activities, questions)
│   ├── context/                 # Theme, auth-gate, presence providers
│   ├── hooks/                   # useCurrentUser, useAuthUid, etc.
│   ├── locales/                 # i18n translation files
│   ├── notifications/           # Push notification setup
│   ├── pages/                   # One file per route
│   ├── styles/                  # Global theme (theme.css)
│   ├── firebase.js              # Firebase initialisation (reads from env)
│   ├── firebase-messaging.js    # FCM helpers
│   ├── i18n.js                  # i18next setup
│   ├── App.jsx                  # Router + providers
│   └── main.jsx                 # App entry point
├── scripts/
│   └── make_logo.py             # Logo generation utility
├── firestore.rules              # Firestore security rules
└── vite.config.js
```

## Getting started

### Prerequisites

- Node.js 20+
- A Firebase project ([create one](https://console.firebase.google.com/)) with
  Firestore, Realtime Database, Storage, Anonymous Auth, and (optional) Cloud
  Messaging enabled.

### 1. Install

```bash
git clone https://github.com/Blessings12-hub/Aura.git
cd Aura
npm install
```

### 2. Configure Firebase

```bash
cp .env.example .env
```

Fill in `.env` with values from **Firebase Console → Project settings →
General → Your apps → Web app**:

```env
  apiKey: "AIzaSyD3SJuB_zajVYspjfXWccVHoENx6E-HXhk",
  authDomain: "aura-5693e.firebaseapp.com",
  databaseURL: "https://aura-5693e-default-rtdb.firebaseio.com",
  projectId: "aura-5693e",
  storageBucket: "aura-5693e.firebasestorage.app",
  messagingSenderId: "1028269030459",
  appId: "1:1028269030459:web:43762becb2ccccb61c301e",
  measurementId: "G-9PG36HYYR7"
```

> **Note on the service worker.** `public/firebase-messaging-sw.js` can't read
> Vite env vars (it runs outside the bundler), so it's edited directly with
> your public Firebase config. These values are safe to ship to the browser —
> Firebase's web config is not a secret — but access is still controlled by
> your Firestore security rules and, optionally, HTTP-referrer restrictions
> in the Google Cloud Console.

### 3. Deploy Firestore rules

```bash
firebase deploy --only firestore:rules
```

### 4. Run

```bash
npm run dev       # start dev server
npm run build     # production build
npm run preview   # preview the production build
npm run lint      # oxlint
```

## Data model

Firestore collections actually used by the app:

| Collection | Purpose |
| --- | --- |
| `users/{uid}` | Age, gender, avatar colour. |
| `userIdentities/{uid}` | Gated identity (name, age, gender) — only readable by the owner or a matched partner. |
| `chats/{mood}/messages/{id}` | Mood Chat messages (text and voice). |
| `dailyQuestions/{date}/answers/{id}` | Daily Question answers, scoped by date. |
| `eventBuddy/{id}`, `eventJoins/{id}`, `eventChats/{id}` | Events, join requests, and their group chats. |
| `matchProfiles/{id}` | Public, anonymous Match Finder cards. |
| `matchPairs/{id}`, `matchChats/{id}` | Confirmed matches and their private chat. |
| `skillSwaps/{id}`, `swapPairs/{id}`, `swapChats/{id}` | Skill Swap offers, matches, and chat. |
| `skillSwapCalls/{pairId}` | WebRTC offer/answer/ICE candidates for Skill Swap video calls. |
| `collabStudio/{id}` | Strokes drawn on the shared Collab Studio canvas. |
| `collabChatMessages/{id}` | Live chat alongside the Collab Studio canvas. |
| `collabCursors/{uid}` | Live cursor positions on the shared canvas. |

## Privacy model

- Anonymous Firebase Auth — no email, phone, or social login required.
- Stored per user: age, gender, an avatar colour, and (for Match Finder) a name — the latter gated behind `userIdentities` and only revealed to a matched partner.
- IDs shown to other users are truncated (`Person abc123`).
- No analytics or third-party trackers are configured by default.

## Contributing

Pull requests are welcome. Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md)
before opening one.

## License

[MIT](./LICENSE) © Blessings12-hub
