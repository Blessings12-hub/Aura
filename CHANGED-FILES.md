# Aura — verification now gates the whole app, not just Match Finder

Five files. Extract over `Aura-main/`, on top of all previous patches. No
firestore.rules or new env vars needed — this is entirely client-side
routing plus reusing the endpoints already built.

## Read this part first — a real consequence of this change

Match Finder's verification (both the document and selfie paths) hard-
requires 18+. That threshold didn't change. But `MIN_AGE` in `Login.jsx` —
the age Aura has always accepted at signup — is still **16**.

Before this patch, that gap didn't matter: a 16-17 year old could sign up
and use Mood Chat, Daily Question, Skill Swap, Event Buddy, and Letters
freely, and would only hit the 18+ wall if they specifically went looking
for Match Finder. Now that verification gates entry to the whole app, that
same 16-17 year old signs up, lands on the verification step, and **can
never pass it** — every path through it requires 18+. They're not blocked
from one activity anymore; they're permanently locked out of the app
entirely, with no path forward, using an age Aura's own signup form still
accepts.

I didn't change `MIN_AGE` myself — that's a real product decision about who
Aura is for, not something to change silently as a side effect of a routing
fix. Two honest options, not a recommendation either way:
- **Raise `MIN_AGE` to 18** in `Login.jsx` (one line) so the signup form
  itself is honest about who can actually get in.
- **Keep `MIN_AGE` at 16** and accept that Aura is now, in practice, an
  18+ product, with 16-17 year olds able to start signup but not finish it
  — which will generate confused/frustrated users and support questions if
  it isn't communicated somewhere before they get to that point.

I'd want to know this before shipping it, so I'm telling you now rather
than after.

## What changed

**`src/components/RequireVerifiedAccount.jsx`** (new) — the actual
enforcement. Checks Firebase auth, then live-subscribes to `users/{uid}`,
and redirects to `/login` unless there's a profile AND it's approved and
unexpired. This exists because Login.jsx's own check only runs when Login
itself mounts — without a route-level guard, a bookmarked or shared link
straight to `/aura/chat` (or any other activity) would skip it entirely.

**`src/App.jsx`** — every activity route (`/aura`, chat, Match Finder,
Daily Question, Skill Swap, Event Buddy, Letters, and their sub-routes) now
uses `RequireVerifiedAccount` instead of the login-only `RequireLogin`.
Two routes deliberately still use login-only: **Account Settings**, so a
pending/declined account can still reach account-level actions (link
Google, delete the account) instead of being fully stuck; and **Admin
Reports**, so an admin reviewing other people's requests isn't locked out
of that screen by their own verification status. Neither page's actual
data access loosened — `firestore.rules` still governs what each can read
and write regardless of which route guard got them there.

**`src/pages/Login.jsx`** — this is where most of the real work is:

- The post-signup screen from the last patch was skippable (a "Continue to
  Aura" button). That's gone. It's now a genuine block: nothing past it
  without a real approval.
- It's no longer only for brand-new signups. The bootstrap check now
  routes a *returning* account that exists but isn't verified straight
  into this same screen too, prefilled with whatever age/gender they
  already have on file — reached either fresh after signing up, or by
  `RequireVerifiedAccount` redirecting them back here from anywhere else
  in the app.
- It now shows the same three-state status (nothing submitted / pending /
  declined, with the decline reason) that Match Finder's gate shows, read
  live from `verificationRequests/{uid}` — so both places genuinely behave
  the same way now, not just visually similar.
- It live-subscribes to `users/{uid}` while sitting on this screen, so an
  approval that lands while someone's waiting — the selfie check resolving
  in a few seconds, or a document getting approved later — continues
  straight into the app on its own, no manual refresh.
- Landing target changed from `/aura/match` to `/aura` once verified, for
  consistency with the original routing-bug fix (the hub is the correct
  landing spot; there's no longer a special reason to land specifically in
  Match Finder once everything requires the same check).

**Small correctness fix, applied to both Login and MatchFinder's gates:**
the "declined" message used to always say "you can try again below with a
clearer photo" — which is actively misleading when the decline reason is
an age floor (`"indicates an age under 18"`) rather than a bad photo. A
clearer photo of an ID that genuinely shows someone under 18 will just get
declined again. Both screens now only show the retry suggestion when the
decline reason isn't an age-floor one.

**Note:** Match Finder's own internal gate (`verifiedForMatch`, from the
patch before last) is now redundant in practice — the router blocks
unverified users before that page ever mounts. I left it in place rather
than ripping it out; it's harmless as a second layer and costs nothing to
keep.
