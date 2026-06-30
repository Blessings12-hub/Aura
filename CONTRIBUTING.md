
Action: file_editor create /app/aura_repo/CONTRIBUTING.md --file-text "# Contributing to Aura

Thanks for taking the time to contribute. The bar is small but the project
should stay tidy, so a few ground rules:

## Before you start

1. Open an issue describing the bug or feature first — it saves rework.
2. Fork the repo, branch from `main`, name the branch
   `feat/<short-name>` or `fix/<short-name>`.

## Local setup

```bash
npm install
cp .env.example .env   # then fill in your Firebase config
npm run dev
```

If you don't have a Firebase project handy, create a free one — Aura will
not run without it.

## Style

- **No emoji as icons.** Use [`lucide-react`](https://lucide.dev/) instead.
  Emoji are fine in copy (`\"Hello 👋\"`), never as UI affordances.
- **Prefer CSS classes** in `src/styles/theme.css` over inline `style={{ }}`
  blobs. A few inline styles are fine; a 40-line one is not.
- **Reuse hooks.** `useCurrentUser` and friends live in `src/hooks/` —
  don't copy-paste the same Firestore `loadUser` block into a new page.
- **One component per file**, default export, PascalCase filename.
- Run `npm run lint` before opening a PR.

## Commits

Conventional Commits are encouraged but not enforced:

```
feat(match): add swipe gesture to profile cards
fix(collab): persist full stroke instead of last point
docs(readme): clarify VAPID key setup
```

## Pull requests

- Keep PRs focused. One concern per PR.
- Update `README.md` or `REVIEW.md` if you change behaviour or data shape.
- A short before/after screenshot helps for UI changes.

## Security

If you find a vulnerability (especially around Firestore rules or auth),
please **do not** open a public issue. Email the maintainer first.
"
Observation: Create successful: /app/aura_repo/CONTRIBUTING.md