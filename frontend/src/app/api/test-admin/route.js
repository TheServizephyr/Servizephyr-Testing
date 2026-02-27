
import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/firebase-admin';

import { verifyAdmin } from '@/lib/verify-admin';

export async function GET(req) {
  try {
    await verifyAdmin(req);
    const auth = await getAuth();
    console.log("Successfully got auth instance.");
    // Attempt a lightweight, authenticated admin operation to verify project connection.
    const user = await auth.getUserByEmail('test@example.com').catch(e => e.code === 'auth/user-not-found' ? null : Promise.reject(e));

    return NextResponse.json({
      message: "✅ Firebase Admin SDK Initialized and Authenticated Successfully!",
      details: "The server-side Firebase environment is configured correctly and can communicate with the correct Firebase project."
    });
  } catch (error) {
    return NextResponse.json({
      message: `❌ Firebase Admin SDK failed to initialize or authenticate.`,
      error: error.message,
      details: "This likely means the service account credentials in your environment variables are incorrect, missing, or pointing to the wrong project."
    }, { status: 500 });
  }
}
