# Voice notes — no Firebase Storage needed

You're right that Storage requires the Blaze plan now (Google changed this
Feb 2026, even free-tier Storage usage needs a linked billing account).
This rewrite drops Storage entirely — voice notes now save straight into
the Firestore chat message itself as base64, no separate file/bucket
involved. That means:

- **`storage.rules` is no longer needed for this feature** — you can leave
  it unpublished, this doesn't touch it at all anymore
- Recording auto-stops at **60 seconds**, with a live countdown on the
  record button, so it stays safely under Firestore's 1MB-per-document
  limit (base64 inflates raw audio ~33%, so an unbounded recording could
  have blown past that)
- If a recording somehow still comes out oversized (codec/bitrate varies
  by browser), it's rejected up front with a clear message asking for a
  shorter one, instead of a cryptic Firestore error

## Trade-off worth knowing
Base64-in-Firestore counts against your Firestore read/write quota and
storage quota (1 GiB free on Spark) a bit more heavily than plain text
messages would, since audio is inherently bigger. For a small-friends-group
test phase this won't matter. If Aura grows and voice notes get heavy
use, upgrading to Blaze just for Storage (the free quota is still $0 until
you exceed it — 5GB storage, 100GB egress/month) would be worth
reconsidering then, since it's a one-time willingness-to-link-a-card
decision, not an automatic cost.
