# Aura

> A mood-based social app for anonymous chat, matching, and shared activities.

Aura helps people connect by mood, chat safely, and join lightweight activities
with others. Every real account is an anonymous Firebase session — no email,
phone, or name is required to use the app at all, though you can optionally
link a Google account later purely so you can get back into your own account
from a new device (see [Account recovery](#account-recovery)).

[![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=000)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=fff)](https://vite.dev/)
[![Firebase](https://img.shields.io/badge/Firebase-12-ffca28?logo=firebase&logoColor=000)](https://firebase.google.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

---

## Activities

| Activity | What it is |
| --- | --- |
| **Mood Chat** | Anonymous real-time group chat for everyone currently feeling the same mood. |
| **Daily Question** | A prompt that rotates daily. Answers land in a shared, date-scoped thread — react with a heart, and the most-reacted answer gets pinned as "today's top answer." |
| **Event Buddy** | Post an event (concert, dinner, walk); others request to join, host accepts, a WhatsApp-style 1:1 chat opens. |
| **Match Finder** | Post a card with your sex, age, hobbies, bio, and what you're looking for — visible to everyone browsing. Your **name and photo** stay hidden until a mutual match, which opens a private chat and reveals them. Requires ID verification before your card can go live — see [Match Finder in detail](#match-finder-in-detail). |
| **Skill Swap** | Offer a skill and what you want to learn; match with someone anonymously, chat, and start a real WebRTC video call once both sides accept. |
| **Anonymous Letters** | Write a letter to a stranger, or answer one someone else wrote. One reply per letter, fully async — no live chat pressure. Replaced Collab Studio (see below). |

> **Why Collab Studio was replaced.** Every other activity here is built
> around some kind of shared vulnerability between strangers — a mood, a
> daily prompt, a match, a skill, an event. The old shared-canvas Collab
> Studio was well built, but it wasn't really *about* anonymity or feeling
> the way the rest of the app is — it could've been a feature in almost any
> generic app. Anonymous Letters leans into the same async, low-pressure
> theme as Daily Question instead.

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

Before any of that, though, Match Finder requires two things `firestore.rules`
actually enforces server-side, not just the UI:

1. **18+, with explicit consent.** A checkbox confirming you're 18 or older
   is required on every profile save — stricter than the account-wide
   minimum age set at Login (currently 16, used by every other activity).
2. **ID verification**, via [Didit](https://didit.me)'s free tier. A Cloud
   Function (`createDiditSession`) starts a hosted KYC/ID-check flow; a
   second function (`diditWebhook`) verifies Didit's signed result and sets
   `verified: true` on your account — a flag only that server-side function
   can ever set, never the client. Your card can't be created or updated
   until `verified` is `true`. See the setup comment above `diditApiKey` in
   `functions/index.js` for exact configuration steps.

Once verified and matched:

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

`firestore.rules` rejects any write to a public `matchProfiles` card that
tries to include a `displayName` or `photoURL` field — those two fields
only ever exist in `userIdentities/{uid}`, which is readable only by its
owner or a confirmed match (see [Data model](#data-model)).

### Conversations, not a lucky scan

Match Finder and Skill Swap both show a **"Your matches" / "Your swaps"**
list — a proper conversation list, built directly from the match/swap
pairing itself rather than from whichever public cards still happen to be
posted. A match is always reachable from that list, whether or not the
other person's card still exists.

You'll also get an in-app notification (see `IncomingRequestWatcher`) when
one of your own outgoing requests gets accepted, when someone requests or
accepts a Skill Swap video call, and when an Event Buddy host accepts your
join request. If Cloud Functions are deployed (see
[Push notifications](#4-optional-deploy-push-notifications--age-verification)),
these also arrive as a real push notification that deep-links straight to
the relevant conversation, even if Aura isn't open.

### Account recovery

Aura is anonymous by design — no password ever exists. That means clearing
your browser data, switching phones, or reinstalling normally loses your
profile, matches, and history for good, with nothing to recover. **Account
Settings** (`/aura/settings`, reachable from the gear icon on Home) offers
an optional fix: linking a Google account to your existing anonymous
session via Firebase's account-linking, purely as a recovery credential —
nobody else on Aura ever sees that email, and linking doesn't change how
anonymous you are inside the app. Do it once, and signing in with that same
Google account from Login later resolves straight back to your original
account instead of starting a new one.

The same screen also has **self-service data export** (a JSON download of
your account/identity/match-card data) and **account deletion**. Deletion
removes your account, Match Finder identity, cards, and push token, and
signs you out for good — it does *not* retroactively scrub individual
messages you've already sent across the chat-based activities, since those
are spread across many collections; a true full erasure would need a
scheduled Cloud Function to walk and delete across all of them, which isn't
built yet.

### Moderation & abuse prevention

- **Reporting**: any message can be reported; reviewed at `/aura/admin/reports`.
- **Banning**: an admin can ban the user behind any report directly from
  that screen. A ban is enforced in two places — the account's own
  `banned` flag is checked live app-wide (a banned session sees a full-screen
  "suspended" notice, everywhere, immediately — see `PresenceRoot.jsx`),
  and `firestore.rules` independently blocks a banned account from posting
  in Mood Chat, Match Finder, and Anonymous Letters even if someone bypassed
  the UI entirely. `banned` (like `verified`) can only ever be set by an
  admin account, never by the account's own owner.
- **Rate limiting**: sending a message anywhere bumps a shared
  `users/{uid}.lastMessageAt` timestamp in the same atomic batch as the
  message itself; `firestore.rules` rejects a new message unless enough
  time has passed since that timestamp — enforced server-side, not just by
  the client-side send-button cooldown, and shared across every activity
  that's adopted this pattern (Mood Chat, Daily Question, Match Chat,
  Skill Swap Chat, Event Chat) so alternating between activities doesn't
  dodge the limit.
- **App Check** (optional, off by default): proves requests come from a
  real instance of this app, not a script hitting Firestore's API directly
  with config values copied out of the public bundle. See the comment
  block above `initializeAppCheck` in `src/firebase.js` before enabling
  enforcement — turning it on before the app is actually issuing valid
  tokens will lock out real users.

## Tech stack

- **React 19** + **Vite 8** — UI and dev tooling (using Vite's Rolldown/Rust bundler)
- **React Router 7** — client-side routing, with route-based code-splitting
  (`React.lazy`) for every page except Login and Home
- **Firebase** — Firestore (data), Realtime Database (presence), Auth
  (anonymous + optional Google linking), Cloud Messaging (push
  notifications), Cloud Functions (push delivery, Didit verification),
  App Check (optional bot/script protection), WebRTC signalled over
  Firestore (Skill Swap & Match Finder video calls)
- **Didit** — third-party ID verification for Match Finder (free tier)
- **react-i18next** — multi-language support (10 languages, English as fallback)
- **Sentry** — error monitoring, loaded via CDN script tag rather than an
  npm dependency (see the comment in `index.html`)
- **GitHub Actions** — CI (`lint` + `build`) on every push/PR to `main`
- **PWA** — installable, with real offline caching for the app shell and
  Vite's content-hashed JS/CSS bundles, merged into the same service worker
  that handles push notifications (`public/firebase-messaging-sw.js`)

## Project layout

```
aura/
├── .github/workflows/ci.yml    # Lint + build check on every push/PR
├── public/                     # Static assets, manifest
│   ├── manifest.json
│   └── firebase-messaging-sw.js  # Push notifications + offline caching, one file
├── src/
│   ├── components/             # Reusable UI components
│   │   ├── Avatar.jsx           # Colour-circle avatar, or a photo once one is set
│   │   ├── ProfileModal.jsx     # Read-only "contact card" for a matched partner
│   │   ├── IncomingRequestWatcher.jsx  # Global notification watcher (see below)
│   │   └── ...
│   ├── constants/               # Static data (moods, daily questions)
│   ├── context/                 # Theme, auth-gate, presence + ban-check provider
│   ├── hooks/                   # useCurrentUser, useIsAdmin, useSendCooldown, etc.
│   ├── lib/
│   │   ├── photoUpload.js       # Client-side resize of a picked photo to a small base64 JPEG
│   │   ├── streak.js            # Daily Question streak + general app-usage streak
│   │   └── ...
│   ├── locales/                 # i18n translation files (en is the source of truth)
│   ├── notifications/           # Push notification setup
│   ├── pages/                   # One file per route
│   │   ├── AccountSettings.jsx  # Export data, link Google, delete account
│   │   ├── AnonymousLetters.jsx # Replaces CollabStudio.jsx
│   │   └── ...
│   ├── styles/                  # Global theme (theme.css)
│   ├── firebase.js              # Firebase initialisation (reads from env, App Check setup)
│   ├── firebase-messaging.js    # FCM helpers
│   ├── i18n.js                  # i18next setup
│   ├── App.jsx                  # Router + providers, route-level code-splitting
│   └── main.jsx                 # App entry point, service worker registration
├── scripts/
│   └── make_logo.py             # Logo generation utility
├── functions/                    # Cloud Functions — push notifications + Didit verification
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
  Firestore, Realtime Database, Anonymous Auth, and (optional) Google Auth,
  Cloud Messaging, and App Check enabled.
- The **Blaze** (pay-as-you-go) plan if you want push notifications or
  Match Finder's ID verification — both need Cloud Functions, which aren't
  available on the free Spark plan. Free-tier usage on Blaze is realistically
  $0/month at small scale; it's a billing-enabled switch, not an automatic
  charge. Everything else in the app runs fine on Spark.

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

# Optional — App Check (see src/firebase.js for setup + when NOT to enforce yet)
VITE_FIREBASE_RECAPTCHA_SITE_KEY=

# Optional — TURN server for Skill Swap / Match Finder video calls.
# Without these, calls fall back to a free public TURN service that isn't
# reliable at real scale. See src/hooks/useVideoCall.js.
VITE_TURN_URLS=
VITE_TURN_USERNAME=
VITE_TURN_CREDENTIAL=
```

> **Note on the service worker.** `public/firebase-messaging-sw.js` can't read
> Vite env vars (it runs outside the bundler), so its Firebase config is
> edited directly in the file. These values are safe to ship to the browser —
> Firebase's web config is not a secret — but access is still controlled by
> your Firestore security rules and App Check.

### 3. Deploy Firestore rules

```bash
firebase deploy --only firestore:rules
```

Do this after **every** pull that touches `firestore.rules` — the app and
the rules are versioned together, and a stale ruleset will reject writes
the current UI expects to succeed (or, worse, silently allow ones it no
longer should). Use Firebase Console → Firestore Database → Rules → **Rules
Playground** to test a rules change before publishing, especially for
anything touching the cooldown or ban logic — both use fairly advanced
rules syntax (`getAfter()`, `diff().affectedKeys()`) that's easy to get
subtly wrong.

### 4. (Optional) Deploy push notifications + age verification

Both of these are Cloud Functions and need the **Blaze** plan:

```bash
cd functions && npm install && cd ..
firebase deploy --only functions
```

- **Push notifications** work immediately after deploy — see the comment
  block at the top of `functions/index.js`.
- **Match Finder's ID verification** needs additional one-time setup at
  [didit.me](https://didit.me) (free tier) before it'll actually work — full
  steps are in the comment block directly above `diditApiKey` in
  `functions/index.js`, including the two secrets you'll need to set with
  `firebase functions:secrets:set` before deploying.

### 5. Run

```bash
npm run dev       # start dev server
npm run build     # production build
npm run preview   # preview the production build
npm run lint      # oxlint
```

> `tests/firestore.rules.test.js` exists but currently has no test runner
> wired up in `package.json` (no vitest/jest/mocha) — it can't actually be
> run yet. Rules changes should be verified in Rules Playground in the
> meantime.

## Data model

Firestore collections actually used by the app:

| Collection | Purpose |
| --- | --- |
| `users/{uid}` | Age, gender, avatar colour, and account-level flags: `verified` (Match Finder ID check, server-set only), `banned`/`banReason`/`bannedAt` (admin-set only), `lastMessageAt` (shared rate-limit timestamp), `dailyStreak`/`appStreak` and related fields. |
| `userIdentities/{uid}` | The part of a Match Finder profile that's gated behind a match: **displayName and photoURL**. Age/gender are mirrored here too. Readable only by the owner or a matched partner. |
| `chats/{mood}/messages/{id}` | Mood Chat messages (text, sticker, voice) — rolling 24h window, capped to the most recent 150 live. |
| `dailyQuestions/{date}/answers/{id}` | Daily Question answers, scoped by date, with a `reactions` map (uid → true) for the top-answer feature. |
| `eventBuddy/{id}`, `eventJoins/{id}`, `eventChats/{id}` | Events (query scoped to upcoming only), join requests, and their 1:1 chats. |
| `matchProfiles/{id}` | Public Match Finder cards — **avatarColor, age, gender, bio, hobbies, lookingFor**. Requires `verified: true` and the 18+/consent flag to create. Never contains `displayName` or `photoURL` (enforced by `firestore.rules`). |
| `matchPairs/{id}`, `matchChats/{id}` | Confirmed matches and their private chat. |
| `letters/{id}` | Anonymous Letters — `status` moves `open` → `delivered` → `replied`; `recipientId` set only on claim, `replyText` set only once. |
| `skillSwaps/{id}`, `swapPairs/{id}`, `swapChats/{id}` | Skill Swap offers, matches, and chat — fully anonymous, no identity fields at all. |
| `skillSwapCalls/{pairId}`, `matchCalls/{pairId}` | WebRTC offer/answer/ICE candidates for video calls. |
| `blocks/{blockerUid_blockedUid}` | A user's personal block list — asymmetric, readable only by the blocker. |
| `reports/{id}` | User reports — write-only from the client; reviewed and actioned (including bans) via `/aura/admin/reports`. |
| `admins/{uid}` | Grants access to the admin reports view. Not self-service — added manually via the Firebase Console. |
| `pushTokens/{uid}` | FCM device token for push notifications, owner-only. Consumed by `functions/index.js`. |

## Privacy model

- Anonymous Firebase Auth — no email, phone, or social login required to
  use the app. Google linking is available but strictly opt-in and used
  only for account recovery (see [Account recovery](#account-recovery)).
- **Skill Swap and Event Buddy** are fully anonymous: no age, gender, name,
  or photo is ever attached to a post, a match, or a message. People are
  shown as `Person abc123` (a truncated uid) throughout.
- **Match Finder** is a deliberate exception: age and gender are shown on
  your public card to anyone browsing. Only your **name and photo** are
  gated, unlocking for a specific person only once you've both matched —
  and getting a card live at all requires ID verification first. See
  [Match Finder in detail](#match-finder-in-detail).
- A Match Finder photo, if you add one, is resized client-side to a small
  JPEG (`src/lib/photoUpload.js`) and stored as a base64 data URL on your
  gated `userIdentities` doc — there's no separate Storage bucket or public
  URL for it (Aura currently runs on Firebase's free Spark plan for
  everything except the two Blaze-gated features above; Storage would need
  Blaze too, so this stays base64-in-Firestore for now), and it's subject
  to the same match-gated read rule as your name.
- No analytics or third-party trackers beyond optional Sentry error
  monitoring, which is off until you add your own key.

## Contributing

Pull requests are welcome. Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md)
before opening one.

## License

[MIT](./LICENSE) © Blessings12-hub
