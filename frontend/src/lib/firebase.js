// This file is now a bridge to the centralized Firebase initialization.
// It ensures that any component importing from 'lib/firebase' gets the
// same, correctly initialized instances.

import { initializeFirebase } from '@/firebase';
import { GoogleAuthProvider } from 'firebase/auth';

// Correctly initialize services and export them.
const { firebaseApp, auth, firestore, storage, rtdb } = initializeFirebase();
const googleProvider = new GoogleAuthProvider();
const db = firestore; // Alias for consistency with older code if needed
const app = firebaseApp;

export { app, auth, googleProvider, db, storage, rtdb };
