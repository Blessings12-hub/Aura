# Aura — the actual fix: firebase-admin was never installed

One file: `package.json`. This is the real fix — the previous patch's
try/catch improvements were correct but couldn't reach this, and I should
have checked this first instead of guessing at runtime causes.

## What was actually wrong

`api/verify-document.js`, `api/verify-selfie.js`, and the earlier
`api/send-notification.js` all do:

```js
import { initializeApp, cert, getApps } from 'firebase-admin/app';
```

`firebase-admin` is not listed in `package.json`'s `dependencies` — I
checked, and it's genuinely absent from both `package-lock.json` and
`pnpm-lock.yaml` too, zero mentions in either. It was never installed.

That import fails to resolve *before your function's code ever runs* —
not a runtime error inside the handler, a failure to load the module at
all. That's a level earlier than any try/catch I wrote last time could
reach, which is exactly why wrapping the handler body in error handling
didn't change anything: the function was never starting.

This also explains the exact symptom: Vercel calls this
`FUNCTION_INVOCATION_FAILED` and returns a plain 500 with no custom body
— matching "HTTP 500" precisely, and identically on both endpoints, since
both have the same missing import.

## The fix

Added `"firebase-admin": "^13.8.0"` to `dependencies`. That's the whole
change — one line.

## What you need to do

`vercel.json` has `"installCommand": "npm install"`, not `npm ci`, so
Vercel will resolve and install this fresh on your next deploy without
needing a pre-updated lockfile — just push this change and redeploy.

If you want to test locally first: run `npm install` in the project root
(this updates `package-lock.json` to include it too — worth committing
that afterward, though not strictly required for Vercel's build to work).

I can't run `npm install` myself here to regenerate the lockfile for you —
my environment has network access disabled, so I can't fetch the package.
That's the one step only you can do.

## Sorry for the runaround

The try/catch patch from last message wasn't wrong, exactly — it's still
worth having, since it'll surface a clear message instead of a silent
crash for any *future* problem that happens inside the function. But I
should have checked whether the dependency was actually installed before
reaching for runtime error-handling theories. This is the fix.
