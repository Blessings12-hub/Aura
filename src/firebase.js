// src/firebase.js
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyD3SJuB_zajVYspjfXWccVHoENx6E-HXhk',
  authDomain: 'aura-5693e.firebaseapp.com',
  projectId: 'aura-5693e',
  storageBucket: 'aura-5693e.appspot.com',
  messagingSenderId: '1039578945678',
  appId: '1:1039578945678:web:1a2b3c4d5e6f7g8h9i0j1k',
  measurementId: 'G-1A2B3C4D5E'
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);