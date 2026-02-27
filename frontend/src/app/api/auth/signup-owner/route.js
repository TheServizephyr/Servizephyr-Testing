
import { NextResponse } from 'next/server';

// This API route is deprecated and no longer used in the new, simplified authentication flow.
// The new flow uses Google Sign-In and a single 'complete-profile' endpoint.
// This file is kept to avoid 404 errors but its functionality is disabled.
export async function POST(req) {
    return NextResponse.json({
      message: 'This signup method is deprecated. Please use Google Sign-In on the homepage.',
    }, { status: 410 }); // 410 Gone
}
