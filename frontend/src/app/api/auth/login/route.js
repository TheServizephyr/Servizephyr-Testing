
import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/firebase-admin';

export async function POST(req) {
  try {
    const auth = await getAuth();

    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ message: 'Email and password are required.' }, { status: 400 });
    }

    const userRecord = await auth.getUserByEmail(email);

    if (!userRecord) {
        return NextResponse.json({ message: 'Invalid credentials. User not found.' }, { status: 401 });
    }
    
    if (!userRecord.emailVerified) {
        return NextResponse.json({ message: 'Your account is not verified. Please check your email for a verification link.' }, { status: 403 });
    }
    
    const role = userRecord.customClaims?.role || null;
    const isNewUser = !role;

    return NextResponse.json({
      message: 'Server acknowledged login. Client should now have ID token.',
      role,
      isNewUser,
    }, { status: 200 });

  } catch (error) {
    console.error('LOGIN ERROR:', error);
    if (error.code === 'auth/user-not-found') {
        return NextResponse.json({ message: 'Invalid credentials. User not found.' }, { status: 401 });
    }
    // Specific check for the audience error to provide a clearer message
    if (error.code === 'auth/argument-error' && error.message.includes('Firebase ID token has incorrect "aud" (audience) claim')) {
        return NextResponse.json({ message: `Critical Backend Mismatch: ${error.message}` }, { status: 500 });
    }
    return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
  }
}
