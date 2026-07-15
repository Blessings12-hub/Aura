# Voice notes fix

## Root cause
Firebase Storage has its own separate security rules, independent from
both Firestore's and Realtime Database's. `storage.rules` exists in your
repo already (with a comment predicting exactly this problem) but has
never been published, so every voice note upload has been silently denied
this whole time.

## Publish it
1. Firebase Console → **Storage** (separate section from Firestore and
   Realtime Database)
2. If you've never opened this before, you may need to click **Get
   Started** first to actually create the Storage bucket
3. Tab along the top → **Rules**
4. Replace the contents with the attached `storage.rules`
5. **Publish**

## Also fixed in code
The app has a fallback for when upload fails (encodes the recording as
base64 and stores it directly in the chat message instead) — but that
fallback had no error handling of its own, so if it ALSO failed, nothing
would show up at all. Now it:
- Actually reports an error if it fails
- Refuses upfront (with a message asking for a shorter recording) rather
  than silently trying to save something too big — Firestore documents
  have a hard 1MB limit, and base64 inflates the raw audio by about a
  third, so a long recording could blow past that even on a good
  connection

Once `storage.rules` is published, voice notes should upload properly
through the real path and this fallback shouldn't normally trigger at all.
