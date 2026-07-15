# Daily Question streak + return-visit nudge

## 1. Streak tracking (new: `src/lib/streak.js`)
Answering today's question now updates a streak counter on your `users/{uid}`
doc: `dailyStreak`, `dailyStreakBest`, `dailyStreakLastDate`. Logic:
- Already answered today → no change (posting 5 messages in one sitting
  doesn't inflate the streak)
- Answered yesterday, not yet today → streak +1
- Any bigger gap, or first time ever → streak resets to 1

No new Firestore rules needed — this writes to `users/{uid}`, which your
existing rules already let the owner update freely.

The streak shows as a 🔥 chip next to the question number in Daily Question
itself once you have one going.

## 2. Return-visit nudge (new: `src/components/DailyQuestionNudge.jsx`)
Shows on Home, above the activity grid, **only when you haven't answered
today's question yet** — silent otherwise. Two states:
- **Streak on the line** (amber, flame icon): "Your 5-day streak ends
  today" — this is the strongest pull, so it's used whenever there's an
  actual streak at risk
- **No streak yet** (green, question icon): shows today's actual question
  text as the hook, so it's not just a generic "come back" nag

Tapping it goes straight into Daily Question.

## 3. What I didn't build: an actual daily push notification
A true "it's 9am, come answer today's question" push while the app is
closed needs something to trigger it on a schedule — which normally means
a Cloud Function + Cloud Scheduler. I didn't build that, because:
- You're mobile-only with no way to `firebase deploy` functions right now
- Cloud Scheduler typically needs Blaze billing enabled regardless of
  actual usage, same pattern as the Storage issue

**The realistic path that needs zero code deployment**, entirely from your
phone's browser:
1. Firebase Console → **Engage → Messaging**
2. **New campaign → Notifications**
3. Write something like "Today's question is up 🔥" with a link into
   `/aura/question`
4. Under the scheduling step, Firebase lets you send later or set up a
   recurring send to an audience — I'd recommend testing this manually
   (send-now) a few times first to confirm delivery actually works end to
   end, before trusting a recurring schedule to run unattended. I'm not
   fully certain of the exact recurring-frequency options in the current
   console UI, so worth confirming what's actually available before
   relying on it daily.

This requires your existing FCM setup (already in the app) to be
registering device tokens, which it already does via the notification
opt-in banner on Home.
