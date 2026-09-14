import { ID, APPWRITE_COLLECTIONS, APPWRITE_MEDIA_BUCKET_ID, databases, databaseId, ownerPermissions, requireAppwrite, storage } from './appwriteClient';

const ocrFunctionUrl = import.meta.env.VITE_OCR_FUNCTION_URL;

export async function submitIdentityDocument({ userId, file }) {
  requireAppwrite();
  if (!file || !userId) throw new Error('A verification document is required.');
  if (!APPWRITE_MEDIA_BUCKET_ID) throw new Error('Verification storage is not configured.');
  if (!ocrFunctionUrl) throw new Error('OCR verification is not configured yet.');

  const uploaded = await storage.createFile(APPWRITE_MEDIA_BUCKET_ID, ID.unique(), file, ownerPermissions(userId));
  const response = await fetch(ocrFunctionUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, fileId: uploaded.$id }),
  });
  if (!response.ok) throw new Error('OCR verification could not process this document.');
  const result = await response.json();
  await databases.updateDocument(databaseId, APPWRITE_COLLECTIONS.verificationRequests, userId, {
    documentFileId: uploaded.$id,
    ocrStatus: result.status || 'pending',
    ocrDateOfBirth: result.dateOfBirth || '',
    ocrConfidence: Number(result.confidence || 0),
  });
  return result;
}
