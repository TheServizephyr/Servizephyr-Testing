
import { NextResponse } from 'next/server';
import { getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';
import { nanoid } from 'nanoid';
import { checkIpRateLimit } from '@/lib/rateLimiter';
import { obfuscateGuestId } from '@/lib/guest-utils';

export async function POST(req) {
    console.log("[API][generate-session-token] POST request received.");
    const firestore = await getFirestore();

    try {
        const { tableId, restaurantId } = await req.json();

        // --- DINE-IN TOKEN GENERATION ---
        if (tableId && restaurantId) {
            console.log(`[API][generate-session-token] Dine-in token request for table: ${tableId}`);

            const forwardedFor = req.headers.get('x-forwarded-for') || '';
            const clientIp = forwardedFor.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
            const rate = await checkIpRateLimit(clientIp, 12);
            if (!rate.allowed) {
                console.warn(`[API][generate-session-token] Rate limit exceeded for IP ${clientIp}`);
                return NextResponse.json({ message: 'Too many requests. Please try again shortly.' }, { status: 429 });
            }

            // Validate table exists for this restaurant to prevent token spam against random IDs.
            const normalizedTableId = String(tableId).trim().toUpperCase();
            const [exactTableDoc, normalizedTableDoc] = await Promise.all([
                firestore.collection('restaurants').doc(restaurantId).collection('tables').doc(String(tableId)).get(),
                firestore.collection('restaurants').doc(restaurantId).collection('tables').doc(normalizedTableId).get(),
            ]);

            if (!exactTableDoc.exists && !normalizedTableDoc.exists) {
                return NextResponse.json({ message: 'Invalid table for this restaurant.' }, { status: 404 });
            }
            
            // Check if there's already an active token for this table
            const tokensRef = firestore.collection('auth_tokens');
            const effectiveTableId = normalizedTableDoc.exists ? normalizedTableId : String(tableId);
            const activeTokenQuery = await tokensRef
                .where('tableId', '==', effectiveTableId)
                .where('restaurantId', '==', restaurantId)
                .where('expiresAt', '>', new Date())
                .limit(1)
                .get();

            if (!activeTokenQuery.empty) {
                console.error(`[API][generate-session-token] Active session already exists for table ${effectiveTableId}. Blocking new session.`);
                return NextResponse.json({ message: `This table is currently occupied. Please use the original device or see the host for assistance.` }, { status: 409 }); // 409 Conflict
            }

            const token = nanoid(32); // Longer token for security
            const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000); // 6-hour validity for dine-in

            const authTokenRef = firestore.collection('auth_tokens').doc(token);
            await authTokenRef.set({
                tableId: effectiveTableId,
                restaurantId: restaurantId,
                expiresAt: expiresAt,
                type: 'dine-in'
            });
            
            console.log(`[API][generate-session-token] Generated new DINE-IN token for table: ${effectiveTableId}`);
            return NextResponse.json({ token, expiresAt }, { status: 200 });
        }


        // --- WHATSAPP TOKEN GENERATION (existing logic) ---
        const uid = await verifyAndGetUid(req); // This will throw if not authenticated
        const userRef = firestore.collection('users').doc(uid);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            console.error(`[API][generate-session-token] User profile not found for UID: ${uid}`);
            return NextResponse.json({ message: 'User profile not found. Please complete your profile.' }, { status: 404 });
        }
        
        const userData = userDoc.data();
        const phone = userData.phone;

        if (!phone) {
            console.error(`[API][generate-session-token] Phone number not found for user UID: ${uid}`);
            return NextResponse.json({ message: 'Phone number not found in your profile. Please update it.' }, { status: 400 });
        }

        const token = nanoid(24);
        const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2-hour validity

        const authTokenRef = firestore.collection('auth_tokens').doc(token);
        const ref = obfuscateGuestId(uid);
        await authTokenRef.set({
            phone: phone,
            expiresAt: expiresAt,
            uid: uid, // legacy compatibility
            userId: uid, // ref-based verification support
            type: 'whatsapp'
        });
        
        console.log(`[API][generate-session-token] Generated new WHATSAPP token for phone: ${phone}`);
        return NextResponse.json({ phone, ref, token, expiresAt }, { status: 200 });

    } catch (error) {
        console.error('GENERATE SESSION TOKEN API ERROR:', error);
        // If verifyAndGetUid fails, it will have a status property
        if (error.status) {
            return NextResponse.json({ message: error.message }, { status: error.status });
        }
        // Handle cases where body parsing might fail or other errors
        if (error instanceof SyntaxError) {
             return NextResponse.json({ message: 'Invalid request body.' }, { status: 400 });
        }
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
