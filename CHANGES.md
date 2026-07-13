# Temporary: show real Firestore errors on-screen

Since you're on mobile and can't easily open dev tools, I changed the error
messages in Collab Studio, Match Finder, and Skill Swap to show the actual
Firestore error code and message on the screen, instead of the generic
"could not be loaded" text.

Apply this, reload the broken page, and send me back exactly what it now
says — something like:

    Chat could not be loaded. (permission-denied: Missing or insufficient permissions.)

or

    Profiles could not be loaded. (failed-precondition: The query requires an index...)

That tells us exactly what's wrong. Once we've fixed the real issue, say
the word and I'll revert these three files back to the plain user-facing
message — this version is diagnostic only, not meant to ship long-term.
