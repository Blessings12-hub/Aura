# Aura — the actual actual fix: two lockfiles fighting each other

One file to add/overwrite (`package.json`, unchanged from last time), and
one file you need to **delete yourself** — a zip can't do that part, it can
only add or overwrite files.

## What the build log showed

Two separate install steps happen on every Vercel deploy, and I'd only
accounted for one of them:

1. **The main build install**, governed by `vercel.json`'s
   `"installCommand": "npm install"`. This one worked — the log shows it
   succeeding, adding `firebase-admin` and its dependencies, and the Vite
   build completing cleanly with every expected file in `dist/`.

2. **A separate step where Vercel traces each `/api/*.js` file's imports**
   to figure out what to bundle into each serverless function. This step
   does its own independent dependency install, and — this is the part I
   didn't know until seeing your log — it does **not** respect
   `vercel.json`'s `installCommand`. It auto-detects whichever lockfile
   exists in the repo, found `pnpm-lock.yaml`, and ran
   `pnpm install --frozen-lockfile` for it. `--frozen-lockfile` refuses to
   proceed if the lockfile doesn't exactly match `package.json` — and since
   I'd only updated `package.json` (no network access here to regenerate a
   pnpm lockfile), that check now fails hard:

   ```
   ERR_PNPM_OUTDATED_LOCKFILE ... 1 dependencies were added: firebase-admin@^13.8.0
   ```

Your repo has **two lockfiles** — `package-lock.json` and `pnpm-lock.yaml`
— which is what let this happen. `vercel.json` clearly declares npm as the
intended tool, but step 2 doesn't check that file; it just picks whichever
lockfile it finds, which in this case is the wrong one for your project.

## The fix

- **Delete `pnpm-lock.yaml`** from the repo entirely. With it gone, step 2
  has nothing to auto-detect and falls back to the same npm-based
  resolution that already worked correctly in step 1 — which the log
  already proved works fine for installing `firebase-admin`.
- `package.json` stays as it was in the last patch (`firebase-admin` in
  `dependencies`) — including it again here so this is a complete,
  self-contained fix.

## What to do

1. Delete `pnpm-lock.yaml` from your repo (`git rm pnpm-lock.yaml`, or just
   delete it in your file browser/editor and commit).
2. Overwrite `package.json` with the one in this zip (or re-apply the one
   from last time if you still have it — it's identical).
3. Push and redeploy.

If you want to sanity-check locally first: delete `pnpm-lock.yaml`, run
`npm install`, confirm it completes without errors, then commit whatever
changed in `package-lock.json` alongside it.
