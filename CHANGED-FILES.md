# Aura — standalone admin panel (outside the app)

Two files: `api/admin-panel.js` (secured endpoint) and
`public/admin-panel.html` (the page itself — plain static HTML, no build
step, no React, no Firebase Auth). Once deployed it's live at:

**https://aura-blush-zeta.vercel.app/admin-panel.html**

## Setup

Generate a secret, same idea as `CRON_SECRET` — here's one ready to use:

```
ea2b9ebcce6bca10c50b8538892bdc1521ae9b5998fcebc43cb5d0077e990cec
```

Add it to Vercel → Settings → Environment Variables as
**`ADMIN_PANEL_SECRET`**, then redeploy. That's the only setup step. No
Firestore `admins` collection, no signing into Aura itself, nothing tied
to a browser or device — just this one page and this one secret.

Open the URL above, paste the secret in once (it's remembered in that
browser after), and you'll see the same pending queue as the in-app Admin
Reports screen: age/gender, how long ago it was submitted, a "View
photos" button that loads the selfie + ID on demand, and Approve/Decline.
Either button does exactly what the in-app version does — writes the
decision, deletes the stored images immediately, and notifies the
applicant.

**This is a second door into the same room, not a separate system** — it
reads and writes the exact same Firestore documents as everything else
already built. Use whichever is more convenient at the time; they'll
never conflict since a request only gets decided once regardless of
which path does it.

**Treat that secret like a password.** Anyone who has it can approve or
decline any pending request. It's deliberately a different value from
`CRON_SECRET` — this one gets typed into a browser and sits in that
browser's localStorage, a different exposure profile than a value that
only ever lives inside Vercel/GitHub's own secret stores.

---

## Why the automatic hour-later approval hasn't fired

Worth checking these in order — I can't see your GitHub/Vercel dashboards,
so this is where to look rather than something I can diagnose blind:

1. **Did the GitHub Actions workflow actually run at all?** Your repo →
   Actions tab → look for "Verification escalation" in the list. If it's
   not there, the workflow file (`.github/workflows/verification-escalation.yml`
   from the earlier patch) may not have been pushed/merged to your default
   branch yet — scheduled workflows only trigger once the file exists there.
   You can also trigger it manually right now: open the workflow in the
   Actions tab → "Run workflow" button (this works because the file
   includes `workflow_dispatch`) — no need to wait for the next hour to
   test it.

2. **If it ran but shows as failed** (red X in the Actions tab), click
   into that run and read the logged response — the workflow prints the
   HTTP status and body from `api/escalate-verifications.js`. The most
   likely causes, both self-explanatory once you see the actual error:
   - `CRON_SECRET` mismatched or missing in one of the two places (Vercel
     env var / GitHub repo secret) — shows as `401 Unauthorized`.
   - The Firestore composite index from `firestore.indexes.json` was
     never deployed — shows as an index-required error with a direct link
     to create it.

3. **If it ran successfully (green check) but nothing got decided:**
   check whether `GROQ_API_KEY` is actually set in Vercel. This is a
   silent one by design — if it's missing, `analyzeSubmission()` returns
   `null`, the decision logic has nothing to act on, and the request just
   stays `pending` forever with no error anywhere. The workflow would show
   success (the endpoint ran fine, it just had nothing to decide with).

The standalone panel above works regardless of which of these turns out
to be the cause — it doesn't depend on the GitHub Action, `CRON_SECRET`,
or `GROQ_API_KEY` at all, only `ADMIN_PANEL_SECRET` and Firebase
credentials that are already working (confirmed, since the rest of
verification is functioning).
