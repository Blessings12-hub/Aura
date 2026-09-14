// src/lib/firestoreClient.js
//
// Real Firebase Firestore, replacing what firestoreClient.js used
// to fake on top of Appwrite. Every consumer file in this app was already
// written against the standard `firebase/firestore` function names
// (collection, doc, getDoc, setDoc, onSnapshot, query, where, ...) because
// that's what the compat layer mimicked — so this file just re-exports the
// real thing, backed by a real Firestore instance, and nothing downstream
// has to change its call sites, only its import path.
import { getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  runTransaction,
  writeBatch,
  deleteField,
  increment,
  Timestamp,
} from 'firebase/firestore';
import { firebaseConfigured } from './firebaseClient';

export const db = firebaseConfigured ? getFirestore(getApp()) : null;

export function requireFirestore() {
  if (!db) {
    throw new Error('Aura is not connected to Firebase. Add the VITE_FIREBASE_* web app variables.');
  }
  return db;
}

// Collection name map — kept only so call sites that used to import
// APPWRITE_COLLECTIONS.xyz can swap to COLLECTIONS.xyz with a one-line
// import change instead of hardcoding strings everywhere.
export const COLLECTIONS = {
  users: 'users',
  verificationRequests: 'verificationRequests',
  reports: 'reports',
  presence: 'presence',
  matchPairs: 'matchPairs',
  matchProfiles: 'matchProfiles',
  userIdentities: 'userIdentities',
  swapPairs: 'swapPairs',
  skillSwaps: 'skillSwaps',
  eventJoins: 'eventJoins',
};

// Appwrite required an explicit permissions array per document. Firestore
// security instead lives entirely in firestore.rules, so this is a no-op
// kept only so call sites that still pass ownerPermissions(uid) as an
// argument don't need to be edited too — it's simply ignored downstream.
export function ownerPermissions() {
  return undefined;
}

// Matches the old Appwrite upsertDocument(collectionId, documentId, data)
// helper used directly (outside the compat layer) by a few presence/report
// call sites — set with merge:true does the same "update or create" job.
export async function upsertDocument(collectionName, documentId, data) {
  requireFirestore();
  await setDoc(doc(db, collectionName, documentId), data, { merge: true });
}

export {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  runTransaction,
  writeBatch,
  deleteField,
  increment,
  Timestamp,
};
