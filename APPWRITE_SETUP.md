# Aura Appwrite setup

Aura now uses Appwrite Cloud Free for authentication and app data. It does not require Firebase hosting, Supabase, Didit, or a paid hosting plan. The verification flow is intentionally manual: a user submits age/gender, and an Aura admin approves or declines the request.

## 1. Create the free project

1. Create an account at https://cloud.appwrite.io and create a project.
2. Add a Web platform. Use your Vercel production domain and the exact preview domain used during testing.
3. Copy the project ID into `VITE_APPWRITE_PROJECT_ID`.
4. Keep the endpoint as `https://cloud.appwrite.io/v1` unless Appwrite gives you a different endpoint.

## 2. Create the database

Create one database and copy its ID into `VITE_APPWRITE_DATABASE_ID`. Create these collections:

- `users` (ID can be `users`)
- `verificationRequests` (ID can be `verificationRequests`)
- `reports` (ID can be `reports`)

Each collection should allow the signed-in user to read/write only its own documents. For the admin review queue, use an Appwrite Team named `aura-admins`; give the team read/update access to verification requests and reports. Do not make these collections public.

For the `users` collection, add string attributes for `age`, `gender`, `avatarColor`, `verificationStatus`, `verified`, `verifiedAt`, and `verificationExpiresAt`. For verification requests, add `uid`, `age`, `gender`, `status`, `submittedAt`, `reviewedAt`, and `reviewerId`. Appwrite permits extra fields only when attributes exist, so create them before testing.

## 3. Configure the app

In Vercel project settings, add these variables for Preview and Production:

```text
VITE_APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
VITE_APPWRITE_PROJECT_ID=your_project_id
VITE_APPWRITE_DATABASE_ID=your_database_id
VITE_APPWRITE_USERS_COLLECTION_ID=users
VITE_APPWRITE_VERIFICATION_COLLECTION_ID=verificationRequests
VITE_APPWRITE_REPORTS_COLLECTION_ID=reports
```

Redeploy after saving variables. The browser SDK has no secret key; never put an Appwrite API key in a `VITE_` variable.

## 4. Activate manual verification

1. In Appwrite Teams, create `aura-admins` and add each reviewer.
2. Set collection permissions so only team members can list/review verification requests.
3. Users submit their age and gender from Aura's onboarding form.
4. An admin opens Aura's admin reports page, checks the identity using your own approved process, and selects Approve or Decline.
5. The user returns to Aura and sees the updated verification status.

Aura does not store identity documents in this flow. If document upload is later required, create a private Appwrite Storage bucket with a strict file-size/type limit and grant access only to the submitting user and `aura-admins`.

## 5. Cutover checklist

Test a new anonymous session, profile creation, refresh/session recovery, verification submission, admin review, chat, media, and sign-out. Export the legacy Firebase data before deleting the old project. Appwrite's Free plan has quotas and inactivity limits; monitor usage and export backups regularly. It is free for a pilot, not an unlimited-free guarantee.
