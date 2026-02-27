
import { NextResponse } from 'next/server';
import { getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';
import admin from 'firebase-admin';

// GET handler to fetch driver data
export async function GET(req) {
    console.log("[DEBUG] /api/rider/dashboard: GET request received.");
    try {
        const uid = await verifyAndGetUid(req); // Use the new helper
        const firestore = await getFirestore();

        console.log(`[DEBUG] /api/rider/dashboard: Fetching driver data for UID: ${uid}`);
        const driverRef = firestore.collection('drivers').doc(uid);
        const driverDoc = await driverRef.get();

        if (!driverDoc.exists) {
            console.error(`[DEBUG] /api/rider/dashboard: Driver document not found for UID: ${uid}`);
            return NextResponse.json({ message: 'Rider profile not found.' }, { status: 404 });
        }

        const driverData = driverDoc.data();

        // ✅ STEP 4 & 5: Fetch orders in ALL delivery stages (including failures)
        const ordersQuery = firestore.collection('orders')
            .where('deliveryBoyId', '==', uid)
            .where('status', 'in', [
                'dispatched', 'reached_restaurant', 'picked_up', 'on_the_way', // Normal flow
                'delivery_attempted', 'failed_delivery' // Failure flow (exclude 'returned_to_restaurant' - order is done)
            ]);
        // Note: Firestore 'in' operator supports max 10 values

        const ordersSnapshot = await ordersQuery.get();
        const activeOrders = ordersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        console.log(`[DEBUG] /api/rider/dashboard: Successfully fetched driver data and ${activeOrders.length} active orders for UID: ${uid}`);

        return NextResponse.json({ driver: driverData, activeOrders }, { status: 200 });

    } catch (error) {
        console.error("[DEBUG] /api/rider/dashboard: CRITICAL ERROR in GET:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}

// PATCH handler to update driver status or location
export async function PATCH(req) {
    console.log("[DEBUG] /api/rider/dashboard: PATCH request received.");
    try {
        const uid = await verifyAndGetUid(req); // Use the new helper
        const firestore = await getFirestore();

        const { status, location } = await req.json();

        if (!status && !location) {
            return NextResponse.json({ message: 'Either status or location is required.' }, { status: 400 });
        }

        const driverRef = firestore.collection('drivers').doc(uid);
        const updateData = {};

        if (status) {
            console.log(`[DEBUG] /api/rider/dashboard: Updating status to '${status}' for UID: ${uid}`);
            updateData.status = status;
        }
        if (location && typeof location.latitude === 'number' && typeof location.longitude === 'number') {
            console.log(`[DEBUG] /api/rider/dashboard: Updating location for UID: ${uid}`);
            updateData.currentLocation = new admin.firestore.GeoPoint(location.latitude, location.longitude);

            // ✅ STEP 3A: Heartbeat timestamp for offline detection
            updateData.lastLocationUpdate = admin.firestore.FieldValue.serverTimestamp();
        }

        if (Object.keys(updateData).length === 0) {
            return NextResponse.json({ message: 'No valid data provided for update.' }, { status: 400 });
        }

        await driverRef.update(updateData);
        console.log(`[DEBUG] /api/rider/dashboard: Successfully updated driver profile for UID: ${uid}`);
        return NextResponse.json({ message: 'Profile updated successfully.' }, { status: 200 });

    } catch (error) {
        console.error("[DEBUG] /api/rider/dashboard: CRITICAL ERROR in PATCH:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}
