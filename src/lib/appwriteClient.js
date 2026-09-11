import { Account, Client, Databases, ID, Permission, Query, Role, Storage } from 'appwrite';

const endpoint = import.meta.env.VITE_APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1';
const projectId = import.meta.env.VITE_APPWRITE_PROJECT_ID;
const databaseId = import.meta.env.VITE_APPWRITE_DATABASE_ID;

export const appwriteConfigured = Boolean(projectId && databaseId);
export const appwriteClient = new Client().setEndpoint(endpoint);
if (projectId) appwriteClient.setProject(projectId);

export const account = new Account(appwriteClient);
export const databases = new Databases(appwriteClient);
export const storage = new Storage(appwriteClient);
export { ID, Query };

// Grants read/update/delete of a document to exactly one user (by their
// Appwrite account $id) and no one else. Pass this as the permissions
// argument to createDocument/updateDocument so a document's owner is the
// only account (besides collection-level roles like aura-admins) that can
// read or change it. Requires "Document Security" to be turned ON for the
// collection in the Appwrite console — without that, per-document
// permissions like these are ignored and only collection-level
// permissions apply.
export function ownerPermissions(uid) {
  return [
    Permission.read(Role.user(uid)),
    Permission.update(Role.user(uid)),
    Permission.delete(Role.user(uid)),
  ];
}

export const APPWRITE_COLLECTIONS = {
  users: import.meta.env.VITE_APPWRITE_USERS_COLLECTION_ID || 'users',
  verificationRequests: import.meta.env.VITE_APPWRITE_VERIFICATION_COLLECTION_ID || 'verificationRequests',
  reports: import.meta.env.VITE_APPWRITE_REPORTS_COLLECTION_ID || 'reports',
  presence: import.meta.env.VITE_APPWRITE_PRESENCE_COLLECTION_ID || 'presence',
  matchPairs: import.meta.env.VITE_APPWRITE_MATCH_PAIRS_COLLECTION_ID || 'matchPairs',
  matchProfiles: import.meta.env.VITE_APPWRITE_MATCH_PROFILES_COLLECTION_ID || 'matchProfiles',
  userIdentities: import.meta.env.VITE_APPWRITE_USER_IDENTITIES_COLLECTION_ID || 'userIdentities',
  swapPairs: import.meta.env.VITE_APPWRITE_SWAP_PAIRS_COLLECTION_ID || 'swapPairs',
  skillSwaps: import.meta.env.VITE_APPWRITE_SKILL_SWAPS_COLLECTION_ID || 'skillSwaps',
  eventJoins: import.meta.env.VITE_APPWRITE_EVENT_JOINS_COLLECTION_ID || 'eventJoins',
  reportsLegacy: import.meta.env.VITE_APPWRITE_REPORTS_COLLECTION_ID || 'reports',
};

export const APPWRITE_MEDIA_BUCKET_ID = import.meta.env.VITE_APPWRITE_MEDIA_BUCKET_ID;

export async function listCollection(collectionId, queries = []) {
  requireAppwrite();
  return databases.listDocuments(databaseId, collectionId, queries);
}

export async function upsertDocument(collectionId, documentId, data, permissions) {
  requireAppwrite();
  try {
    return await databases.updateDocument(databaseId, collectionId, documentId, data);
  } catch (error) {
    if (error?.code !== 404) throw error;
    try {
      return await databases.createDocument(databaseId, collectionId, documentId, data, permissions);
    } catch (createError) {
      // Another tab/request may have created the same deterministic document
      // between the update and create calls. Retry the update instead of
      // surfacing Appwrite's duplicate-document error to the user.
      const isDuplicate = createError?.code === 409
        || createError?.type === 'document_already_exists'
        || /already exists/i.test(createError?.message || createError?.response || '');
      if (isDuplicate) {
        return databases.updateDocument(databaseId, collectionId, documentId, data);
      }
      throw createError;
    }
  }
}

export function requireAppwrite() {
  if (!appwriteConfigured) {
    throw new Error('Aura is not connected to Appwrite. Add VITE_APPWRITE_PROJECT_ID and VITE_APPWRITE_DATABASE_ID.');
  }
}

export async function getCurrentAccount() {
  requireAppwrite();
  try { return await account.get(); } catch (error) {
    if (error?.code === 401) return null;
    throw error;
  }
}

export async function ensureAnonymousSession() {
  requireAppwrite();
  const existing = await getCurrentAccount();
  if (existing) return existing;
  return account.createAnonymousSession();
}

export function subscribeToDocument(collectionId, documentId, onData, _onError) {
  requireAppwrite();
  return appwriteClient.subscribe(
    `databases.${databaseId}.collections.${collectionId}.documents.${documentId}`,
    (event) => onData(event.payload),
  );
}

export function subscribeToCollection(collectionId, queries, onData, onError) {
  requireAppwrite();
  return appwriteClient.subscribe(
    `databases.${databaseId}.collections.${collectionId}.documents`,
    async () => {
      try { onData(await databases.listDocuments(databaseId, collectionId, queries)); } catch (error) { onError?.(error); }
    },
  );
}

export { databaseId };
