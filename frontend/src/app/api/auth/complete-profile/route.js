

import { NextResponse } from 'next/server';
import { getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { generateDisplayId } from '@/lib/id-utils';
import { migrateGuestToUser } from '@/lib/guest-utils';


export async function POST(req) {
    try {
        const uid = await verifyAndGetUid(req); // Use the new helper
        const firestore = await getFirestore();

        const { finalUserData, businessData, businessType } = await req.json();

        // --- VALIDATION ---
        if (!finalUserData || !finalUserData.role || !finalUserData.phone) {
            return NextResponse.json({ message: 'User role and phone are missing in payload.' }, { status: 400 });
        }

        const isBusinessOwner =
            finalUserData.role === 'restaurant-owner' ||
            finalUserData.role === 'shop-owner' ||
            finalUserData.role === 'store-owner' ||
            finalUserData.role === 'street-vendor';

        if (isBusinessOwner && !businessData) {
            return NextResponse.json({ message: 'Business data is required for owners.' }, { status: 400 });
        }
        if (businessData && (!businessData.address || !businessData.address.street || !businessData.address.city)) {
            return NextResponse.json({ message: 'A structured address is required for businesses.' }, { status: 400 });
        }

        const normalizedPhone = finalUserData.phone.slice(-10);
        const masterUserRef = firestore.collection('users').doc(uid);

        // CRITICAL: Create user document FIRST before migration
        // Migration needs the user document to exist to update it
        let mergedUserData = { ...finalUserData };
        const nowForId = new Date();

        // Add Customer ID to User Profile
        if (!mergedUserData.customerId) {
            mergedUserData.customerId = generateDisplayId('CS_', nowForId);
        }

        mergedUserData.createdAt = FieldValue.serverTimestamp();

        // Create user document immediately (not in batch)
        await masterUserRef.set(mergedUserData, { merge: true });
        console.log(`[PROFILE COMPLETION] User document created for UID ${uid}`);

        // --- NOW MIGRATE GUEST PROFILE TO UID ---
        // User document exists, migration can update it
        console.log(`[PROFILE COMPLETION] Checking for guest profile migration for ${normalizedPhone}...`);
        const migrationResult = await migrateGuestToUser(firestore, uid, finalUserData.phone, finalUserData);

        if (migrationResult.migrated) {
            console.log(`[PROFILE COMPLETION] ✅ Guest profile migrated! GuestId: ${migrationResult.guestId}, Addresses: ${migrationResult.addressesMigrated}, Orders: ${migrationResult.ordersMigrated}, Restaurants: ${migrationResult.restaurantsMigrated}`);
        } else {
            console.log(`[PROFILE COMPLETION] No guest profile found to migrate.`);
        }

        // Now use batch for remaining operations
        const batch = firestore.batch();

        if (finalUserData.role === 'rider') {
            const driverRef = firestore.collection('drivers').doc(uid);
            batch.set(driverRef, {
                uid: uid,
                role: 'rider',
                email: finalUserData.email,
                name: finalUserData.name,
                phone: finalUserData.phone,
                profilePictureUrl: finalUserData.profilePictureUrl,
                createdAt: FieldValue.serverTimestamp(),
                status: 'offline',
                currentLocation: null,
                currentRestaurantId: null,
                allowInCommunityPool: false,
                walletBalance: 0,
            }, { merge: true });
            console.log(`[PROFILE COMPLETION] Rider Action: New rider profile for UID ${uid} added to 'drivers' collection.`);
        }
        else if (isBusinessOwner && businessData) {
            const normalizedBusinessType = businessType === 'shop' ? 'store' : businessType;
            let collectionName;
            if (normalizedBusinessType === 'restaurant') collectionName = 'restaurants';
            else if (normalizedBusinessType === 'store') collectionName = 'shops';
            else if (normalizedBusinessType === 'street-vendor') collectionName = 'street_vendors';

            const businessId = businessData.name.replace(/\s+/g, '-').toLowerCase();
            const businessRef = firestore.collection(collectionName).doc(businessId);

            const finalBusinessData = {
                ...businessData,
                businessType: normalizedBusinessType,
                ownerId: uid, // CRITICAL: Owner's user ID for RBAC and team management
                merchantId: generateDisplayId('RS_', nowForId), // ✅ NEW: Merchant ID
                createdAt: FieldValue.serverTimestamp(),
                // CRITICAL FIX: Set approval status so security restrictions work!
                approvalStatus: 'pending', // New accounts need admin approval
                restrictedFeatures: [], // No features restricted by default
                suspensionRemark: '', // No remarks initially
                razorpayAccountId: '',
                // Set default true values for all settings
                isOpen: true,
                deliveryEnabled: true,
                pickupEnabled: true,
                dineInEnabled: true,
                deliveryOnlinePaymentEnabled: true,
                deliveryCodEnabled: true,
                pickupOnlinePaymentEnabled: true,
                pickupPodEnabled: true,
                dineInOnlinePaymentEnabled: true,
                dineInPayAtCounterEnabled: true,
            };
            batch.set(businessRef, finalBusinessData);
            console.log(`[PROFILE COMPLETION] Owner Action: New ${normalizedBusinessType} '${businessId}' added to batch with default settings and PENDING approval status.`);
        }

        await batch.commit();

        console.log(`[PROFILE COMPLETION] Successfully completed profile for user ${uid}`);
        return NextResponse.json({ message: 'Profile completed successfully!', role: finalUserData.role }, { status: 200 });

    } catch (error) {
        console.error('COMPLETE PROFILE API ERROR:', error);
        if (error.code === 'auth/id-token-expired') {
            return NextResponse.json({ message: 'Login token has expired. Please log in again.' }, { status: 401 });
        }
        // Handle custom errors from our helper
        if (error.status) {
            return NextResponse.json({ message: error.message }, { status: error.status });
        }
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
