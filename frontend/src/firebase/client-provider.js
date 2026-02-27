'use client';

import React from 'react';
import { FirebaseProvider } from '@/firebase/provider';
import { initializeFirebase } from '@/firebase';

// Initialize Firebase services once at the module level.
// This is the critical fix to prevent re-initialization on re-renders.
const firebaseServices = initializeFirebase();

export function FirebaseClientProvider({ children }) {
  // Now, we provide the stable, pre-initialized services to the provider.
  return (
    <FirebaseProvider
      firebaseApp={firebaseServices.firebaseApp}
      auth={firebaseServices.auth}
      firestore={firebaseServices.firestore}
    >
      {children}
    </FirebaseProvider>
  );
}
