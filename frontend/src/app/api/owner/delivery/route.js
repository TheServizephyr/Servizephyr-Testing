import { NextResponse } from 'next/server';
import { getAuth, getFirestore, FieldValue } from '@/lib/firebase-admin';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';
import { PERMISSIONS } from '@/lib/permissions';

export async function GET(req) {
    try {
        const firestore = await getFirestore();
        const { searchParams } = new URL(req.url);
        const isLiveOrdersContext = searchParams.get('context') === 'live_orders';
        const { businessId, collectionName } = await verifyOwnerWithAudit(
            req,
            'view_delivery_dashboard',
            {},
            false,
            PERMISSIONS.VIEW_DELIVERY
        );

        const boysRef = firestore.collection(collectionName).doc(businessId).collection('deliveryBoys');
        const ordersRef = firestore.collection('orders').where('restaurantId', '==', businessId);

        const [boysSnap, readyOrdersSnap] = await Promise.all([
            boysRef.get(),
            isLiveOrdersContext ? Promise.resolve(null) : ordersRef.where('status', '==', 'preparing').get()
        ]);

        let boys = [];
        const riderPromises = boysSnap.docs.map(async (doc) => {
            const subCollectionData = { id: doc.id, ...doc.data() };

            const driverDocRef = firestore.collection('drivers').doc(subCollectionData.id);
            const driverDoc = await driverDocRef.get();
            let finalBoyData = { ...subCollectionData };

            if (driverDoc.exists) {
                const mainDriverData = driverDoc.data();
                // Merge main data, but prioritize subcollection data if it exists (e.g., historical stats)
                finalBoyData = { ...mainDriverData, ...subCollectionData };

                if (!isLiveOrdersContext) {
                    // ✅ STEP 6A + 9B PRO: Calculate weighted active load (status-aware)
                    const activeOrdersQuery = firestore.collection('orders')
                        .where('deliveryBoyId', '==', subCollectionData.id)
                        .where('status', 'in', [
                            'dispatched', 'reached_restaurant', 'picked_up', 'on_the_way', 'delivery_attempted'
                        ]);

                    const activeOrdersSnap = await activeOrdersQuery.get();

                    // Simple count for display
                    finalBoyData.activeOrders = activeOrdersSnap.size;

                    // 🔥 Weighted load for intelligent scoring
                    const calculateOrderWeight = (status) => {
                        switch (status) {
                            case 'dispatched': return 1;          // Just assigned
                            case 'reached_restaurant': return 1.5; // Waiting at restaurant
                            case 'picked_up': return 2;            // Food in bag
                            case 'on_the_way': return 2.5;         // Actively delivering
                            case 'delivery_attempted': return 3;   // Stuck situation
                            default: return 1;
                        }
                    };

                    // Calculate weighted load
                    let weightedLoad = 0;
                    let hasHeavyStageOrder = false;
                    const HEAVY_STATUSES = ['on_the_way', 'delivery_attempted'];

                    activeOrdersSnap.docs.forEach(doc => {
                        const orderStatus = doc.data().status;
                        weightedLoad += calculateOrderWeight(orderStatus);

                        // Check if rider has orders in heavy delivery stages
                        if (HEAVY_STATUSES.includes(orderStatus)) {
                            hasHeavyStageOrder = true;
                        }
                    });

                    finalBoyData.weightedLoad = weightedLoad;

                    // 🚫 HARD BLOCK: Rider out on delivery with existing load = no new assignments
                    finalBoyData.isHardBlocked = hasHeavyStageOrder && activeOrdersSnap.size >= 2;
                } else {
                    finalBoyData.activeOrders = finalBoyData.activeOrders || 0;
                    finalBoyData.weightedLoad = finalBoyData.weightedLoad || 0;
                    finalBoyData.isHardBlocked = false;
                }

                // ✅ STEP 3D: Check for stale location (offline detection)
                let isStale = false;
                if (mainDriverData.lastLocationUpdate) {
                    const lastUpdate = mainDriverData.lastLocationUpdate.toDate().getTime();
                    const now = Date.now();
                    const diffMinutes = (now - lastUpdate) / (1000 * 60);

                    if (diffMinutes > 2) {
                        isStale = true;
                    }
                }

                // Map Firestore statuses ('online', 'offline', 'on-delivery') to UI statuses ('Available', 'Inactive', 'On Delivery')
                if (isStale) {
                    // ⚠️ Override status if rider hasn't updated location in 2+ minutes
                    finalBoyData.status = 'No Signal';
                } else {
                    switch (mainDriverData.status) {
                        case 'online':
                            finalBoyData.status = 'Available';
                            break;
                        case 'on-delivery':
                            finalBoyData.status = 'On Delivery';
                            break;
                        case 'offline':
                        default:
                            finalBoyData.status = 'Inactive';
                            break;
                    }
                }
            }
            return finalBoyData;
        });

        boys = await Promise.all(riderPromises);

        if (!isLiveOrdersContext) {
            // ✅ STEP 9A: Get restaurant location for distance calculation
            const businessDoc = await firestore.collection(collectionName).doc(businessId).get();
            const businessData = businessDoc.data();
            const restaurantLat = businessData?.address?.latitude || businessData?.restaurantLocation?.lat || businessData?.restaurantLocation?._latitude;
            const restaurantLng = businessData?.address?.longitude || businessData?.restaurantLocation?.lng || businessData?.restaurantLocation?._longitude;

            // ✅ STEP 9A: Calculate distance to restaurant for each rider
            const getDistanceKm = (lat1, lon1, lat2, lon2) => {
                const R = 6371; // Earth radius in km
                const dLat = (lat2 - lat1) * Math.PI / 180;
                const dLon = (lon2 - lon1) * Math.PI / 180;
                const a =
                    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                    Math.cos(lat1 * Math.PI / 180) *
                    Math.cos(lat2 * Math.PI / 180) *
                    Math.sin(dLon / 2) * Math.sin(dLon / 2);
                return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
            };

            // Add distance to restaurant for each rider
            if (restaurantLat && restaurantLng) {
                boys = boys.map(boy => {
                    if (boy.currentLocation) {
                        const riderLat = boy.currentLocation._latitude || boy.currentLocation.latitude;
                        const riderLng = boy.currentLocation._longitude || boy.currentLocation.longitude;

                        if (riderLat && riderLng) {
                            boy.distanceToRestaurant = getDistanceKm(restaurantLat, restaurantLng, riderLat, riderLng);
                        }
                    }
                    return boy;
                });
            }
        }

        // ✅ STEP 9B: Rider scoring and smart sorting (CORRECTED for in-house riders)
        const calculateRiderScore = (rider) => {
            // Primary factor: WEIGHTED LOAD (considers order status progression)
            const loadScore = (rider.weightedLoad || 0) * 3; // Main factor with weighted intelligence

            // Minor factor: Distance (future-proof, but low impact for permanent riders)
            const distanceScore = (rider.distanceToRestaurant || 0) * 0.5; // Minimal weight

            // Major penalties
            const availabilityPenalty = rider.status !== 'Available' ? 100 : 0; // Block if not available
            const stalePenalty = rider.status === 'No Signal' ? 50 : 0; // Offline detection penalty

            // 🚫 HARD BLOCK: Absolute safety - rider out on delivery with load
            const hardBlockPenalty = rider.isHardBlocked ? 1000 : 0; // Massive penalty = effective block

            return loadScore + distanceScore + availabilityPenalty + stalePenalty + hardBlockPenalty;
        };

        // Sort riders by best match (lowest score = best)
        boys.sort((a, b) => calculateRiderScore(a) - calculateRiderScore(b));

        const readyOrders = isLiveOrdersContext
            ? []
            : readyOrdersSnap.docs.map(doc => ({
                id: doc.id,
                customer: doc.data().customerName,
                items: (doc.data().items || []).length
            }));

        let performance = {
            totalDeliveries: 0,
            avgDeliveryTime: boys.length > 0 ? Math.round(boys.reduce((sum, boy) => sum + (boy.avgDeliveryTime || 0), 0) / boys.length) : 0,
            topPerformer: boys[0] || {},
        };

        if (!isLiveOrdersContext) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const deliveredOrdersSnap = await ordersRef
                .where('status', '==', 'delivered')
                .where('orderDate', '>=', today)
                .get();

            const deliveriesByBoy = {};
            deliveredOrdersSnap.docs.forEach(doc => {
                const orderData = doc.data();
                if (orderData.deliveryBoyId) {
                    deliveriesByBoy[orderData.deliveryBoyId] = (deliveriesByBoy[orderData.deliveryBoyId] || 0) + 1;
                }
            });

            boys = boys.map(boy => ({
                ...boy,
                deliveriesToday: deliveriesByBoy[boy.id] || 0
            }));

            performance = {
                totalDeliveries: boys.reduce((sum, boy) => sum + (boy.deliveriesToday || 0), 0),
                avgDeliveryTime: boys.length > 0 ? Math.round(boys.reduce((sum, boy) => sum + (boy.avgDeliveryTime || 0), 0) / boys.length) : 0,
                topPerformer: boys.length > 0 ? boys.reduce((top, boy) => ((boy.deliveriesToday || 0) > (top.deliveriesToday || 0)) ? boy : top, boys[0]) : {},
            };
        }

        const weeklyPerformance = Array.from({ length: 7 }, (_, i) => {
            const date = new Date();
            date.setDate(date.getDate() - (6 - i));
            return {
                day: date.toLocaleDateString('en-IN', { weekday: 'short' }),
                deliveries: 0
            };
        });

        return NextResponse.json({ boys, performance, readyOrders, weeklyPerformance }, { status: 200 });

    } catch (error) {
        console.error("GET DELIVERY DATA ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


export async function POST(req) {
    try {
        const firestore = await getFirestore();
        const { businessId, collectionName } = await verifyOwnerWithAudit(
            req,
            'add_delivery_boy',
            {},
            false,
            PERMISSIONS.MANAGE_DELIVERY
        );
        const { boy } = await req.json();

        if (!boy || !boy.name || !boy.phone) {
            return NextResponse.json({ message: 'Missing required delivery boy data.' }, { status: 400 });
        }

        const newBoyRef = firestore.collection(collectionName).doc(businessId).collection('deliveryBoys').doc();

        const newBoyData = {
            ...boy,
            id: newBoyRef.id,
            status: 'Inactive',
            location: null,
            deliveriesToday: 0,
            totalDeliveries: 0,
            avgDeliveryTime: 0,
            avgRating: 0,
            createdAt: FieldValue.serverTimestamp(),
        };

        await newBoyRef.set(newBoyData);

        return NextResponse.json({ message: 'Delivery Boy added successfully!', id: newBoyRef.id }, { status: 201 });

    } catch (error) {
        console.error("POST DELIVERY BOY ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

export async function PATCH(req) {
    try {
        const firestore = await getFirestore();
        const { businessId, collectionName } = await verifyOwnerWithAudit(
            req,
            'update_delivery_boy',
            {},
            false,
            PERMISSIONS.MANAGE_DELIVERY
        );
        const { boy } = await req.json();

        if (!boy || !boy.id) {
            return NextResponse.json({ message: 'Boy ID is required for updating.' }, { status: 400 });
        }

        const boyRef = firestore.collection(collectionName).doc(businessId).collection('deliveryBoys').doc(boy.id);
        const { id, ...updateData } = boy;

        // Note: The main driver's status is handled separately by the rider's device.
        // This PATCH should only affect the status WITHIN the restaurant's context if needed.
        // For simplicity, we are removing direct manipulation of the main 'drivers' collection status here.

        await boyRef.update(updateData);

        return NextResponse.json({ message: 'Delivery Boy updated successfully!' }, { status: 200 });

    } catch (error) {
        console.error("PATCH DELIVERY BOY ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

export async function DELETE(req) {
    try {
        const firestore = await getFirestore();
        const { businessId, collectionName } = await verifyOwnerWithAudit(
            req,
            'delete_delivery_boy',
            {},
            false,
            PERMISSIONS.MANAGE_DELIVERY
        );
        const { searchParams } = new URL(req.url);
        const boyId = searchParams.get('id');

        if (!boyId) {
            return NextResponse.json({ message: 'Boy ID is required for deletion.' }, { status: 400 });
        }

        const boyRef = firestore.collection(collectionName).doc(businessId).collection('deliveryBoys').doc(boyId);
        await boyRef.delete();

        return NextResponse.json({ message: 'Delivery Boy removed successfully!' }, { status: 200 });

    } catch (error) {
        console.error("DELETE DELIVERY BOY ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
