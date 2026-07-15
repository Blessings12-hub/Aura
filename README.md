# Aura

> A mood-based social app for anonymous chat, matching, and shared activities.

Aura helps people connect by mood, chat safely, and join lightweight activities
with others. Every real account is an anonymous Firebase session — no email,
phone, or name is required to use the app at all.

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
| **Event Buddy** | Post an event (concert, dinner, walk); others request to join, host accepts, a WhatsApp-style 1:1 chat opens. |
| **Match Finder** | Post a card with your sex, age, hobbies, bio, and what you're looking for — visible to everyone browsing. Your **name and photo** stay hidden until a mutual match, which opens a private chat and reveals them. See [Match Finder in detail](#match-finder-in-detail) below. |
| **Skill Swap** | Offer a skill and what you want to learn; match with someone anonymously, chat, and start a real WebRTC video call once both sides accept. |
| **Collab Studio** | A shared canvas people draw on together in real time, with a live chat panel alongside it. |

### Match Finder in detail

Match Finder is deliberately *not* fully anonymous the way Skill Swap and
Event Buddy are — it's built around browsing profiles, so hiding everything
would make the browsing deck useless. The split is:

- **Always public** (shown on your card to anyone browsing, matched or not):
  your sex, age, hobbies, short bio, and what you're looking for.
- **Gated behind a mutual match**: your **name** and **photo**. Nobody sees
  either of these until you've both requested/accepted each other — at
  which point their card unlocks fully (photo included) and a private chat
  opens between you.

Practically, this means:

1. You fill out **"Your profile"** once (name, age, sex, avatar colour, an
   optional photo, bio, hobbies, what you're looking for) and save it. This
   both posts/updates your public card and stores your gated identity.
2. Other people browsing see your age, sex, bio, hobbies, and looking-for —
   but not your name or photo — until they request a match and you accept
   (or vice versa).
3. Once matched, both sides can tap the other's name — in the "Your
   matches" list, the browse deck, or the chat header — to open a read-only
   profile card showing their photo, name, age, sex, bio, hobbies, and
   looking-for. The chat itself opens as a private, WhatsApp-style room.

This is enforced server-side, not just hidden in the UI: `firestore.rules`
rejects any write to a public `matchProfiles` card that tries to include a
`displayName` or `photoURL` field — those two fields only ever exist in
`userIdentities/{uid}`, which is readable only by its owner or a confirmed
match (see [Data model](#data-model)).

### Conversations, not a lucky scan

Match Finder and Skill Swap both show a **"Your matches" / "Your swaps"**
list — a proper conversation list, built directly from the match/swap
pairing itself rather than from whichever public cards still happen to be
posted. Earlier, "who can I chat with" was worked out by scanning the
browse deck for a card belonging to your match; if your match never posted
their own card (they only ever browsed and requested), you'd have no way to
find the conversation even though they could message you freely. That's
fixed — a match is always reachable from the "Your matches"/"Your swaps"
list, whether or not the other person's card still exists.

You'll also get an in-app notification (see `IncomingRequestWatcher`) when
one of your own outgoing requests gets accepted, when someone requests or
accepts a Skill Swap video call, and when an Event Buddy host accepts your
join request — not just when someone new is waiting on *you*.

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
│   │   ├── Avatar.jsx           # Colour-circle avatar, or a photo once one is set
│   │   ├── ProfileModal.jsx     # Read-only "contact card" for a matched partner
│   │   ├── IncomingRequestWatcher.jsx  # Global notification watcher (see below)
│   │   └── ...
│   ├── constants/               # Static data (moods, activities, questions)
│   ├── context/                 # Theme, auth-gate, presence providers
│   ├── hooks/                   # useCurrentUser, useAuthUid, etc.
│   ├── lib/
│   │   ├── photoUpload.js       # Client-side resize of a picked photo to a small base64 JPEG
│   │   └── ...
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
├── functions/                    # Cloud Functions (push notifications)
│   ├── index.js
│   └── package.json
├── tests/
│   └── firestore.rules.test.js  # Security rules test suite
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
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_DATABASE_URL=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_MEASUREMENT_ID=...
VITE_FIREBASE_VAPID_KEY=...
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

Do this after **every** pull that touches `firestore.rules` — the app and
the rules are versioned together, and a stale ruleset will reject writes
the current UI expects to succeed (or, worse, silently allow ones it no
longer should). If you're picking up the Match Finder profile/photo
changes described in this README, re-deploying rules is required, not
optional — the client now writes `age`/`gender` onto public
`matchProfiles` cards and `photoURL` onto `userIdentities`, and both need
the matching rules in place to be accepted.

### 4. (Optional) Deploy push notifications

Match/swap/event requests notify the recipient in-app while they have Aura
open (see `IncomingRequestWatcher`), but reaching a closed tab or a
different device needs a server-side trigger:

```bash
cd functions && npm install && cd ..
firebase deploy --only functions
```

Requires the **Blaze** (pay-as-you-go) plan — Firestore-triggered Cloud
Functions aren't available on the free Spark plan. See the comment at the
top of `functions/index.js` for what each function does.

### 5. Run

```bash
npm run dev       # start dev server
npm run build     # production build
npm run preview   # preview the production build
npm run lint      # oxlint
npm run test:rules # Firestore security rules test suite (needs Firebase CLI)
```

## Data model

Firestore collections actually used by the app:

| Collection | Purpose |
| --- | --- |
| `users/{uid}` | Age, gender, avatar colour — the account-level record originally set at Login. |
| `userIdentities/{uid}` | The part of a Match Finder profile that's gated behind a match: **displayName and photoURL**. Age/gender are mirrored here too for consistency, but they're not what this collection protects (see below). Readable only by the owner or a matched partner. |
| `chats/{mood}/messages/{id}` | Mood Chat messages (text and voice). |
| `dailyQuestions/{date}/answers/{id}` | Daily Question answers, scoped by date. |
| `eventBuddy/{id}`, `eventJoins/{id}`, `eventChats/{id}` | Events, join requests, and their 1:1 chats. |
| `matchProfiles/{id}` | Public Match Finder cards — **avatarColor, age, gender, bio, hobbies, lookingFor**. Browsable by anyone signed in; never contains `displayName` or `photoURL` (enforced by `firestore.rules`, not just the UI). |
| `matchPairs/{id}`, `matchChats/{id}` | Confirmed matches and their private chat. |
| `skillSwaps/{id}`, `swapPairs/{id}`, `swapChats/{id}` | Skill Swap offers, matches, and chat — fully anonymous, no identity fields at all. |
| `skillSwapCalls/{pairId}` | WebRTC offer/answer/ICE candidates for Skill Swap video calls. |
| `collabStudio/{id}` | Strokes drawn on the shared Collab Studio canvas. |
| `collabChatMessages/{id}` | Live chat alongside the Collab Studio canvas. |
| `collabCursors/{uid}` | Live cursor positions on the shared canvas. |
| `blocks/{blockerUid_blockedUid}` | A user's personal block list — asymmetric, readable only by the blocker. |
| `reports/{id}` | User reports — write-only from the client; reviewed via `/aura/admin/reports` or the console. |
| `admins/{uid}` | Grants access to the admin reports view. Not self-service — added manually via the Firebase Console. |
| `pushTokens/{uid}` | FCM device token for push notifications, owner-only. Consumed by `functions/index.js`. |

## Privacy model

- Anonymous Firebase Auth — no email, phone, or social login required.
- **Skill Swap and Event Buddy** are fully anonymous: no age, gender, name,
  or photo is ever attached to a post, a match, or a message. People are
  shown as `Person abc123` (a truncated uid) throughout.
- **Match Finder** is a deliberate exception: age and gender are shown on
  your public card to anyone browsing. Only your **name and photo** are
  gated, unlocking for a specific person only once you've both matched.
  This boundary is enforced by `firestore.rules`, not just the UI — see
  [Match Finder in detail](#match-finder-in-detail).
- A Match Finder photo, if you add one, is resized client-side to a small
  JPEG (`src/lib/photoUpload.js`) and stored as a base64 data URL on your
  gated `userIdentities` doc — there's no separate Storage bucket or public
  URL for it, and it's subject to the same match-gated read rule as your
  name.
- No analytics or third-party trackers are configured by default.

## Contributing

Pull requests are welcome. Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md)
before opening one.

## License

[MIT](./LICENSE) © Blessings12-hub
