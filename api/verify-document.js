// api/verify-document.js
//
// RETIRED. This endpoint used to accept a document-only submission and
// could auto-approve on its own — exactly the fast path that was removed
// on explicit request in favor of requiring a selfie AND a document,
// reviewed by a person (or, after an hour, by AI looking at both images
// together). See api/verify-submission.js and
// api/escalate-verifications.js for the current flow.
//
// This file is left in the repo, stubbed out, rather than silently
// deleted, for one specific reason: if it had simply been removed and you
// forgot to delete it yourself, the URL would 404 — safe, but easy to
// mistake for "not deployed yet" rather than "intentionally gone" if you
// ever went looking. Returning an explicit 410 Gone makes the retirement
// unambiguous to anyone (including a future version of me) who finds this
// URL still responding.
//
// You can delete this file entirely whenever convenient — nothing in the
// client calls it anymore.
export default function handler(req, res) {
  res.status(410).json({
    error: 'This endpoint has been retired. Verification now requires a selfie and an ID document submitted together via /api/verify-submission.',
  });
}
