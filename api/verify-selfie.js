// api/verify-selfie.js
//
// RETIRED. This was the instant "quick check" fast path — a confident
// selfie alone could approve someone in seconds. That's gone on explicit
// request: every verification now requires a selfie AND an ID document
// together, reviewed by a person or, after an hour, by AI. See
// api/verify-submission.js and api/escalate-verifications.js.
//
// Left in place as a stub rather than silently deleted so this URL can't
// be replayed to bypass the new policy, and so an explicit 410 is
// unambiguous to anyone who finds it still responding, rather than a
// plain 404 that could be mistaken for "not deployed yet."
//
// You can delete this file entirely whenever convenient — nothing in the
// client calls it anymore.
export default function handler(req, res) {
  res.status(410).json({
    error: 'This endpoint has been retired. Verification now requires a selfie and an ID document submitted together via /api/verify-submission.',
  });
}
