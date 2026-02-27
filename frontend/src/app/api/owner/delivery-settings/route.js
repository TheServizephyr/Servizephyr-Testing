
import { NextResponse } from 'next/server';
import { getAuth, getFirestore, verifyAndGetUid, getDatabase } from '@/lib/firebase-admin';
import { verifyEmployeeAccess } from '@/lib/verify-employee-access';

export const dynamic = 'force-dynamic';

async function verifyUserAndGetData(req) {
    const firestore = await getFirestore();
    const uid = await verifyAndGetUid(req);

    const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = url.searchParams.get('employee_of');

    const adminUserDoc = await firestore.collection('users').doc(uid).get();
    if (!adminUserDoc.exists) throw { message: 'User profile not found.', status: 404 };
    const adminUserData = adminUserDoc.data();

    let finalUserId = uid;

    if (adminUserData.role === 'admin' && impersonatedOwnerId) {
        finalUserId = impersonatedOwnerId;
    } else if (employeeOfOwnerId) {
        const accessResult = await verifyEmployeeAccess(uid, employeeOfOwnerId, adminUserData);
        if (!accessResult.authorized) throw { message: 'Access Denied.', status: 403 };
        finalUserId = employeeOfOwnerId;
    }

    const userRef = firestore.collection('users').doc(finalUserId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) throw { message: "User profile not found.", status: 404 };

    const userData = userDoc.data();
    let businessRef = null;
    let businessId = null;

    // Resolve Business
    let collectionsToTry = [];
    const userBusinessType = userData.businessType;
    if (userBusinessType === 'restaurant') collectionsToTry = ['restaurants'];
    else if (userBusinessType === 'shop' || userBusinessType === 'store') collectionsToTry = ['shops'];
    else if (userBusinessType === 'street-vendor') collectionsToTry = ['street_vendors'];
    else collectionsToTry = ['restaurants', 'shops', 'street_vendors'];

    for (const collectionName of collectionsToTry) {
        const businessesQuery = await firestore.collection(collectionName).where('ownerId', '==', finalUserId).limit(1).get();
        if (!businessesQuery.empty) {
            const businessDoc = businessesQuery.docs[0];
            businessRef = businessDoc.ref;
            businessId = businessDoc.id;
            break;
        }
    }

    if (!businessRef) throw { message: "Business not found", status: 404 };

    return { businessRef, businessId };
}

export async function GET(req) {
    try {
        const { businessRef } = await verifyUserAndGetData(req);

        // Fetch from sub-collection
        const configDoc = await businessRef.collection('delivery_settings').doc('config').get();
        const parentDoc = await businessRef.get();
        const parentData = parentDoc.data() || {};

        const defaults = {
            deliveryEnabled: true,
            deliveryRadius: 5,
            deliveryFeeType: 'fixed',
            deliveryFixedFee: 30,
            deliveryBaseDistance: 0,
            deliveryPerKmFee: 5,
            deliveryFreeThreshold: 500,
            deliveryOnlinePaymentEnabled: true,
            deliveryCodEnabled: true,
            roadDistanceFactor: 1.0,
            freeDeliveryRadius: 0,
            freeDeliveryMinOrder: 0,
            deliveryTiers: [],
            deliveryOrderSlabRules: [
                { maxOrder: 100, fee: 10 },
                { maxOrder: 200, fee: 20 }
            ],
            deliveryOrderSlabAboveFee: 0,
            deliveryOrderSlabBaseDistance: 1,
            deliveryOrderSlabPerKmFee: 15,
        };

        const configData = configDoc.exists ? configDoc.data() || {} : {};
        const settings = {
            ...defaults,
            ...parentData,
            ...configData,
        };

        return NextResponse.json(settings);

    } catch (error) {
        console.error("GET DELIVERY SETTINGS ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

export async function PATCH(req) {
    try {
        const { businessRef, businessId } = await verifyUserAndGetData(req);
        const updates = await req.json();
        const toFiniteNumber = (value, fallback = 0) => {
            const n = Number(value);
            return Number.isFinite(n) ? n : fallback;
        };

        // Whitelist allowed fields to prevent pollution
        const allowedFields = [
            'deliveryEnabled', 'deliveryRadius', 'deliveryFeeType',
            'deliveryFixedFee', 'deliveryPerKmFee', 'deliveryBaseDistance', 'deliveryFreeThreshold',
            'deliveryOnlinePaymentEnabled', 'deliveryCodEnabled',
            // NEW: Road factor & free zone
            'roadDistanceFactor', 'freeDeliveryRadius', 'freeDeliveryMinOrder',
            // NEW: Tiered charges
            'deliveryTiers',
            // NEW: Order slab + distance mode
            'deliveryOrderSlabRules', 'deliveryOrderSlabAboveFee', 'deliveryOrderSlabBaseDistance', 'deliveryOrderSlabPerKmFee'
        ];

        const cleanUpdates = {};
        allowedFields.forEach(field => {
            if (updates[field] !== undefined) cleanUpdates[field] = updates[field];
        });

        // Normalize numeric delivery fields for consistent downstream calculation.
        if (cleanUpdates.deliveryRadius !== undefined) cleanUpdates.deliveryRadius = toFiniteNumber(cleanUpdates.deliveryRadius, 5);
        if (cleanUpdates.deliveryFixedFee !== undefined) cleanUpdates.deliveryFixedFee = toFiniteNumber(cleanUpdates.deliveryFixedFee, 0);
        if (cleanUpdates.deliveryBaseDistance !== undefined) cleanUpdates.deliveryBaseDistance = toFiniteNumber(cleanUpdates.deliveryBaseDistance, 0);
        if (cleanUpdates.deliveryPerKmFee !== undefined) cleanUpdates.deliveryPerKmFee = toFiniteNumber(cleanUpdates.deliveryPerKmFee, 0);
        if (cleanUpdates.deliveryFreeThreshold !== undefined) cleanUpdates.deliveryFreeThreshold = toFiniteNumber(cleanUpdates.deliveryFreeThreshold, 0);
        if (cleanUpdates.roadDistanceFactor !== undefined) cleanUpdates.roadDistanceFactor = Math.max(1.0, toFiniteNumber(cleanUpdates.roadDistanceFactor, 1.0));
        if (cleanUpdates.freeDeliveryRadius !== undefined) cleanUpdates.freeDeliveryRadius = toFiniteNumber(cleanUpdates.freeDeliveryRadius, 0);
        if (cleanUpdates.freeDeliveryMinOrder !== undefined) cleanUpdates.freeDeliveryMinOrder = toFiniteNumber(cleanUpdates.freeDeliveryMinOrder, 0);
        if (Array.isArray(cleanUpdates.deliveryTiers)) {
            cleanUpdates.deliveryTiers = cleanUpdates.deliveryTiers.map(t => ({
                minOrder: toFiniteNumber(t?.minOrder, 0),
                fee: toFiniteNumber(t?.fee, 0),
            }));
        }
        if (cleanUpdates.deliveryOrderSlabAboveFee !== undefined) cleanUpdates.deliveryOrderSlabAboveFee = toFiniteNumber(cleanUpdates.deliveryOrderSlabAboveFee, 0);
        if (cleanUpdates.deliveryOrderSlabBaseDistance !== undefined) cleanUpdates.deliveryOrderSlabBaseDistance = Math.max(0, toFiniteNumber(cleanUpdates.deliveryOrderSlabBaseDistance, 1));
        if (cleanUpdates.deliveryOrderSlabPerKmFee !== undefined) cleanUpdates.deliveryOrderSlabPerKmFee = Math.max(0, toFiniteNumber(cleanUpdates.deliveryOrderSlabPerKmFee, 15));
        if (Array.isArray(cleanUpdates.deliveryOrderSlabRules)) {
            cleanUpdates.deliveryOrderSlabRules = cleanUpdates.deliveryOrderSlabRules
                .map(rule => ({
                    maxOrder: toFiniteNumber(rule?.maxOrder, 0),
                    fee: toFiniteNumber(rule?.fee, 0),
                }))
                .filter(rule => rule.maxOrder > 0)
                .sort((a, b) => a.maxOrder - b.maxOrder);
        }

        cleanUpdates.updatedAt = new Date();

        await businessRef.collection('delivery_settings').doc('config').set(cleanUpdates, { merge: true });

        // ✅ CRITICAL: Increment menuVersion to invalidate public menu cache
        // We fetch the current business doc to get the current version
        const businessSnap = await businessRef.get();
        const businessData = businessSnap.data() || {};

        await businessRef.update({
            menuVersion: (businessData.menuVersion || 0) + 1,
            updatedAt: new Date()
        });

        // Invalidate menu cache (legacy key)
        try {
            const { kv } = await import('@vercel/kv');
            if (process.env.KV_REST_API_URL) {
                await kv.del(`menu:${businessId}`);
                console.log(`[Delivery Settings] 🧹 Invalidated cache for ${businessId}`);
            }
        } catch (e) {
            console.warn("Cache invalidation failed", e);
        }

        return NextResponse.json({ success: true, message: "Delivery settings updated" });

    } catch (error) {
        console.error("PATCH DELIVERY SETTINGS ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
