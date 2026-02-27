

import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { cookies } from 'next/headers';
import { deobfuscateGuestId } from '@/lib/guest-utils';

export async function POST(req) {
    console.log("[API verify-token] POST request received.");
    try {
        const firestore = await getFirestore();
        const { phone, token, tableId, ref } = await req.json();
        console.log(`[API verify-token] Payload - Token: ${token ? 'Yes' : 'No'}, Ref: ${ref ? 'Yes' : 'No'}, Phone: ${phone ? 'Yes' : 'No'}, Table: ${tableId ? 'Yes' : 'No'}`);

        if (!token) {
            return NextResponse.json({ message: 'Session token is required.' }, { status: 400 });
        }

        const tokenRef = firestore.collection('auth_tokens').doc(token);
        const tokenDoc = await tokenRef.get();

        if (!tokenDoc.exists) {
            console.warn('[API verify-token] Token not found.');
            return NextResponse.json({ message: 'Invalid or expired session token.' }, { status: 403 });
        }

        const tokenData = tokenDoc.data();
        const expiresAt = tokenData.expiresAt.toDate();

        if (new Date() > expiresAt) {
            console.warn('[API verify-token] Token expired.');
            await tokenRef.delete();
            return NextResponse.json({ message: 'Your session has expired. Please request a new link.' }, { status: 403 });
        }

        // --- DINE-IN FLOW (Unchanged) ---
        if (tokenData.type === 'dine-in') {
            if (!tableId || tokenData.tableId !== tableId) {
                return NextResponse.json({ message: 'Invalid table for this session.' }, { status: 403 });
            }
            return NextResponse.json({ message: 'Token is valid.', type: 'dine-in' }, { status: 200 });
        }

        // --- GUEST IDENTITY FLOW (New) ---
        if (ref) {
            const guestId = deobfuscateGuestId(ref);
            if (!guestId) {
                console.error("[API verify-token] Failed to deobfuscate ref.");
                return NextResponse.json({ message: 'Invalid link format.' }, { status: 400 });
            }

            // Verify Token belongs to this Guest
            // CRITICAL: Support both new userId field and legacy guestId field
            const tokenUserId = tokenData.userId || tokenData.guestId;
            if (tokenUserId !== guestId) {
                console.warn(`[API verify-token] Guest ID mismatch. Token: ${tokenUserId}, Ref: ${guestId}`);
                return NextResponse.json({ message: 'Invalid session link.' }, { status: 403 });
            }

            // SET HTTP-ONLY COOKIE
            cookies().set({
                name: 'auth_guest_session',
                value: String(guestId), // Store Guest ID (or could be a signed session JWT in future)
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                path: '/',
                maxAge: 60 * 60 * 24 * 7 // 7 Days
            });

            console.log(`[API verify-token] GUEST Session verified for ${guestId}. Cookie set.`);
            return NextResponse.json({
                message: 'Token is valid.',
                type: 'guest',
                guestId: guestId // Return to frontend for non-sensitive state
            }, { status: 200 });
        }

        // --- LEGACY PHONE FLOW & NEW USERID FLOW (Backward Compatibility) ---
        if (tokenData.type === 'whatsapp' || tokenData.type === 'tracking') {
            // Support both new userId field and legacy phone field
            const tokenPhone = tokenData.phone;

            if (tokenPhone && (!phone || tokenPhone !== phone)) {
                console.warn(`[API verify-token] Phone mismatch for legacy token.`);
                return NextResponse.json({ message: 'Invalid session.' }, { status: 403 });
            }
            // Even for legacy, let's try to upgrade them to a cookie if possible
            // But we don't have a guestId here easily without migration. 
            // We just allow them to proceed as before.
            console.log(`[API verify-token] LEGACY Phone session verified.`);
            return NextResponse.json({ message: 'Token is valid.', type: 'legacy_phone' }, { status: 200 });
        }

        return NextResponse.json({ message: 'Unknown token type.' }, { status: 400 });

    } catch (error) {
        console.error('[API verify-token] Error:', error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
