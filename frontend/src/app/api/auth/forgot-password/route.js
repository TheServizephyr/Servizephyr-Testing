
import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/firebase-admin';

export async function POST(req) {
  try {
    const auth = await getAuth();

    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ message: 'Email is required.' }, { status: 400 });
    }
    
    await auth.generatePasswordResetLink(email);
    
    return NextResponse.json({ message: 'If an account with this email exists, a reset link has been sent.' }, { status: 200 });

  } catch (error) {
    console.error('FORGOT PASSWORD ERROR:', error);
    if (error.code === 'auth/user-not-found') {
        return NextResponse.json({ message: 'If an account with this email exists, a reset link has been sent.' }, { status: 200 });
    }
    return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
  }
}
