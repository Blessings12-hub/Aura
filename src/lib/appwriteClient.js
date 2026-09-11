import { Account, Client, Databases, ID, Query, Storage } from 'appwrite';

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

export const APPWRITE_COLLECTIONS = {
  users: import.meta.env.VITE_APPWRITE_USERS_COLLECTION_ID || 'users',
  verificationRequests: import.meta.env.VITE_APPWRITE_VERIFICATION_COLLECTION_ID || 'verificationRequests',
  reports: import.meta.env.VITE_APPWRITE_REPORTS_COLLECTION_ID || 'reports',
};

export const APPWRITE_MEDIA_BUCKET_ID = import.meta.env.VITE_APPWRITE_MEDIA_BUCKET_ID;

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

export function subscribeToDocument(collectionId, documentId, onData, onError) {
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
