

import { NextResponse } from 'next/server';
import { getFirestore, verifyIdToken } from '@/lib/firebase-admin';
import { cookies } from 'next/headers';
import { getOrCreateGuestProfile, deobfuscateGuestId } from '@/lib/guest-utils';

const normalizePhone = (value) => {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    return digits.slice(-10);
};

const pickPhone = (profileData = {}, fallback = '') => {
    const candidates = [
        profileData?.phone,
        profileData?.phoneNumber,
        profileData?.whatsappNumber,
        profileData?.addresses?.[0]?.phone,
        fallback,
    ];

    for (const candidate of candidates) {
        const normalized = normalizePhone(candidate);
        if (normalized.length === 10) return normalized;
    }

    return normalizePhone(fallback);
};

export async function POST(req) {
    try {
        const firestore = await getFirestore();
        const body = await req.json();
        const { phone, guestId: explicitGuestId, ref } = body || {};
        const guestId = typeof explicitGuestId === 'string' ? explicitGuestId.trim() : explicitGuestId;
        const cookieStore = cookies();
        const cookieGuestId = cookieStore.get('auth_guest_session')?.value?.trim() || null;

        // CRITICAL CHANGE: If ref is provided, prioritize it over logged-in UID
        // This ensures WhatsApp capability URLs work correctly even when user is logged in
        let refId = null;
        if (ref) {
            console.log(`[API /customer/lookup] 🔓 Attempting to deobfuscate ref...`);
            refId = deobfuscateGuestId(ref);
            if (refId) {
                console.log(`[API /customer/lookup] ✅ Deobfuscated ref to userId: ${refId}`);
            } else {
                console.warn(`[API /customer/lookup] ⚠️ Failed to deobfuscate ref: ${ref}`);
            }
        }

        // CRITICAL: UID-FIRST PRIORITY (only if NO ref provided)
        // Check if user is logged in via Authorization header
        const authHeader = req.headers.get('authorization');
        let loggedInUid = null;

        if (authHeader?.startsWith('Bearer ')) {
            try {
                const idToken = authHeader.split('Bearer ')[1];
                const decodedToken = await verifyIdToken(idToken);
                loggedInUid = decodedToken.uid;
                console.log(`[API /customer/lookup] ✅ Logged-in user detected: ${loggedInUid}`);
            } catch (e) {
                console.warn(`[API /customer/lookup] Invalid auth token:`, e.message);
            }
        }

        // PRIORITY LOGIC:
        // 1. If ref provided → use refId (WhatsApp capability URL)
        // 2. Else if logged in → use loggedInUid
        const targetUserId = refId || guestId || cookieGuestId || loggedInUid;

        if (targetUserId) {
            const source = refId
                ? 'ref'
                : (guestId ? 'payload_guestId' : (cookieGuestId ? 'cookie_guestId' : 'auth'));
            console.log(`[API /customer/lookup] Target User: ${targetUserId} (source: ${source})`);

            // Try guest_profiles first
            const guestDoc = await firestore.collection('guest_profiles').doc(targetUserId).get();
            if (guestDoc.exists) {
                const guestData = guestDoc.data();
                console.log(`[API /customer/lookup] ✅ Guest profile found with ${guestData.addresses?.length || 0} addresses`);
                return NextResponse.json({
                    name: guestData.name || 'Guest',
                    phone: pickPhone(guestData),
                    addresses: guestData.addresses || [],
                    isVerified: false,
                    isGuest: true
                }, { status: 200 });
            }

            // Fallback to users collection
            const userDoc = await firestore.collection('users').doc(targetUserId).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                console.log(`[API /customer/lookup] ✅ User found. Addresses: ${userData.addresses?.length || 0}`);
                return NextResponse.json({
                    name: userData.name || 'User',
                    phone: pickPhone(userData),
                    addresses: userData.addresses || [],
                    isVerified: true,
                    isGuest: false
                }, { status: 200 });
            }

            console.warn(`[API /customer/lookup] ❌ Profile not found: ${targetUserId}`);
            return NextResponse.json({ message: 'User not found.' }, { status: 404 });
        }

        console.log(`[API /customer/lookup] 📊 State: GuestID=${guestId ? 'Yes' : 'No'}, Phone=${phone ? 'Yes' : 'No'}, Ref=${ref ? 'Yes' : 'No'}`);

        // --- GUEST PROFILE LOOKUP ---
        if (guestId) {
            console.log(`[API /customer/lookup] 🔍 Looking up by guestId: ${guestId}`);
            console.log(`[API /customer/lookup] Fetching Guest Profile: ${guestId}`);
            const guestDoc = await firestore.collection('guest_profiles').doc(guestId).get();

            if (guestDoc.exists) {
                const guestData = guestDoc.data();
                console.log(`[API /customer/lookup] ✅ Guest profile found with ${guestData.addresses?.length || 0} addresses`);
                return NextResponse.json({
                    name: guestData.name || 'Guest',
                    phone: pickPhone(guestData),
                    addresses: guestData.addresses || [],
                    isVerified: false,
                    isGuest: true
                }, { status: 200 });
            } else {
                console.warn(`[API /customer/lookup] ⚠️ Guest Profile not found: ${guestId}. Checking 'users' collection (Migration Fallback)...`);

                // FALLBACK: Check if this ID is actually a UID (migrated user)
                const userDoc = await firestore.collection('users').doc(guestId).get();
                if (userDoc.exists) {
                    const userData = userDoc.data();
                    console.log(`[API /customer/lookup] ✅ Found migrated user profile via ref: ${guestId} with ${userData.addresses?.length || 0} addresses`);
                    return NextResponse.json({
                        name: userData.name || 'User',
                        phone: pickPhone(userData),
                        addresses: userData.addresses || [],
                        isVerified: true,
                        isGuest: false
                    }, { status: 200 });
                }

                console.error(`[API /customer/lookup] ❌ Profile not found in guest_profiles OR users with ID: ${guestId}`);
                return NextResponse.json({ message: 'Guest profile not found.' }, { status: 404 });
            }
        }

        // --- LEGACY PHONE LOOKUP ---
        if (!phone) {
            console.error(`[API /customer/lookup] ❌ No user identifier provided (no guestId and no phone)`);
            return NextResponse.json({ message: 'User identifier required.' }, { status: 400 });
        }

        const normalizedPhone = phone.length > 10 ? phone.slice(-10) : phone;
        console.log(`[API /customer/lookup] 📞 Phone Lookup (UID-first): ${normalizedPhone}`);

        // CRITICAL: Use UID-first priority via getOrCreateGuestProfile
        const profileResult = await getOrCreateGuestProfile(firestore, normalizedPhone);
        const userId = profileResult.userId;

        let userData;
        if (profileResult.isGuest) {
            // Guest profile
            const guestDoc = await firestore.collection('guest_profiles').doc(userId).get();
            if (guestDoc.exists) {
                userData = guestDoc.data();
                return NextResponse.json({
                    name: userData.name || 'Guest',
                    phone: pickPhone(userData, normalizedPhone),
                    addresses: userData.addresses || [],
                    isVerified: false,
                    isGuest: true
                }, { status: 200 });
            }
        } else {
            // Logged-in user (UID)
            const userDoc = await firestore.collection('users').doc(userId).get();
            if (userDoc.exists) {
                userData = userDoc.data();
                return NextResponse.json({
                    name: userData.name,
                    phone: pickPhone(userData, normalizedPhone),
                    addresses: userData.addresses || [],
                    isVerified: true,
                    isGuest: false
                }, { status: 200 });
            }
        }

        return NextResponse.json({ message: 'User not found.' }, { status: 404 });

    } catch (error) {
        console.error('CUSTOMER LOOKUP API ERROR:', error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
