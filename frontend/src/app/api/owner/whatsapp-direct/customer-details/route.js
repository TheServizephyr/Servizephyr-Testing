
import { NextResponse } from 'next/server';
import { getAuth, getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

async function verifyOwnerAndGetBusinessRef(req) {
    const firestore = await getFirestore();
    const uid = await verifyAndGetUid(req);

    const url = new URL(req.url, `http://${req.headers.host}`);
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = url.searchParams.get('employee_of');
    const userDoc = await firestore.collection('users').doc(uid).get();

    if (!userDoc.exists) {
        throw { message: 'Access Denied: User profile not found.', status: 403 };
    }

    const userData = userDoc.data();
    const userRole = userData.role;

    let targetOwnerId = uid;

    if (userRole === 'admin' && impersonatedOwnerId) {
        targetOwnerId = impersonatedOwnerId;
    }
    else if (employeeOfOwnerId) {
        const linkedOutlets = userData.linkedOutlets || [];
        const hasAccess = linkedOutlets.some(o => o.ownerId === employeeOfOwnerId && o.status === 'active');
        if (!hasAccess) throw { message: 'Access Denied', status: 403 };
        targetOwnerId = employeeOfOwnerId;
    }
    else if (!['owner', 'restaurant-owner', 'shop-owner'].includes(userRole)) {
        throw { message: 'Access Denied', status: 403 };
    }

    const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!restaurantsQuery.empty) return restaurantsQuery.docs[0].ref;

    const shopsQuery = await firestore.collection('shops').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!shopsQuery.empty) return shopsQuery.docs[0].ref;

    throw { message: 'No business associated with this owner.', status: 404 };
}

const getPhoneVariations = (phoneNumber) => {
    if (!phoneNumber) return [];
    const cleanPhone = phoneNumber.replace(/\D/g, ''); // Remove all non-digits
    const last10 = cleanPhone.length > 10 ? cleanPhone.slice(-10) : cleanPhone;

    // Platform Standard: 10-digit number is used for conversation IDs and customer registry.
    // We only check the 10-digit version and the version with '91' prefix for legacy compatibility.
    const variations = [
        last10,
        `91${last10}`
    ];

    return Array.from(new Set(variations));
};

export async function GET(req) {
    try {
        const businessRef = await verifyOwnerAndGetBusinessRef(req);
        const url = new URL(req.url, `http://${req.headers.host}`);
        const phoneNumber = url.searchParams.get('phoneNumber');

        if (!phoneNumber) {
            return NextResponse.json({ message: 'Phone number is required' }, { status: 400 });
        }

        const firestore = await getFirestore();
        const customersRef = businessRef.collection('customers');

        const uniqueVariations = getPhoneVariations(phoneNumber);
        console.log(`[Customer Details] Searching for ${phoneNumber} with variations:`, uniqueVariations);

        let customerDoc = null;

        // Collect ALL matching customer records in parallel
        const lookupPromises = uniqueVariations.flatMap(variant => [
            customersRef.where('phoneNumber', '==', variant).get(),
            customersRef.where('phone', '==', variant).get(),
            customersRef.doc(variant).get()
        ]);

        const snapshots = await Promise.all(lookupPromises);
        const allMatchingCustomers = [];

        snapshots.forEach(snap => {
            if (snap.docs) snap.docs.forEach(doc => allMatchingCustomers.push(doc));
            else if (snap.exists) allMatchingCustomers.push(snap);
        });

        // Deduplicate by ID
        const uniqueCustomers = Array.from(
            new Map(allMatchingCustomers.map(doc => [doc.id, doc])).values()
        );

        console.log(`[Customer Details] Found ${uniqueCustomers.length} unique customer record(s)`);

        // Pick the record that HAS totalSpend field (the one Customer Page uses)
        customerDoc = uniqueCustomers.find(doc => {
            const data = doc.data();
            return data.totalSpend !== undefined && data.totalSpend !== null;
        }) || uniqueCustomers[0];

        if (customerDoc) {
            const data = customerDoc.data();
            console.log(`[Customer Details] Found customer record for phone variations`);

            // Calculate stats dynamically from orders collection
            let totalOrders = 0;
            let totalSpent = 0;

            try {
                const ordersRef = firestore.collection('orders');

                // Query orders by restaurantId and phone variations
                // NOTE: We remove the 'status != rejected' query to avoid requiring a composite index.
                // We will filter in-memory instead.
                const orderQueries = uniqueVariations.map(variant =>
                    ordersRef
                        .where('restaurantId', '==', businessRef.id)
                        .where('customerPhone', '==', variant)
                        .get()
                );

                const orderSnapshots = await Promise.all(orderQueries);

                // Merge all orders and deduplicate by ID
                const allOrders = new Map();
                orderSnapshots.forEach(snapshot => {
                    snapshot.docs.forEach(doc => allOrders.set(doc.id, doc));
                });

                // Calculate total spent and filter out rejected orders
                // Filtering 'rejected' in memory to avoid needing a Firestore composite index
                allOrders.forEach(doc => {
                    const orderData = doc.data();
                    if (orderData.status === 'rejected') {
                        allOrders.delete(doc.id);
                        return;
                    }
                    const amount = parseFloat(orderData.totalAmount || orderData.amount || orderData.billTotal || 0);
                    if (!isNaN(amount)) totalSpent += amount;
                });

                totalOrders = allOrders.size;

                console.log(`[Customer Details] Calculated from orders - Orders: ${totalOrders}, Spent: ₹${totalSpent}`);

            } catch (err) {
                console.error('[Customer Details] Error calculating stats from orders:', err);
            }

            return NextResponse.json({
                exists: true,
                id: customerDoc.id,
                details: {
                    customName: data.customName || data.name || '',
                    notes: data.notes || '',
                    totalOrders: totalOrders, // Use calculated value
                    totalSpent: totalSpent,   // Use calculated value
                    createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : (data.createdAt || null)
                }
            }, { status: 200 });
        }

        // Return empty stats if not found
        return NextResponse.json({
            exists: false,
            details: {
                customName: '',
                notes: '',
                totalOrders: 0,
                totalSpent: 0,
                createdAt: null
            }
        }, { status: 200 });

    } catch (error) {
        console.error("GET Customer Details Error:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}

export async function PATCH(req) {
    try {
        const businessRef = await verifyOwnerAndGetBusinessRef(req);
        const { phoneNumber, customName, notes } = await req.json();

        if (!phoneNumber) {
            return NextResponse.json({ message: 'Phone number is required' }, { status: 400 });
        }

        const firestore = await getFirestore();
        const customersRef = businessRef.collection('customers');
        const uniqueVariations = getPhoneVariations(phoneNumber);

        // Collect ALL matching customer records in parallel
        const lookupPromises = uniqueVariations.flatMap(variant => [
            customersRef.where('phoneNumber', '==', variant).get(),
            customersRef.where('phone', '==', variant).get(),
            customersRef.doc(variant).get()
        ]);

        const snapshots = await Promise.all(lookupPromises);
        const allMatchingCustomers = [];

        snapshots.forEach(snap => {
            if (snap.docs) snap.docs.forEach(doc => allMatchingCustomers.push(doc));
            else if (snap.exists) allMatchingCustomers.push(snap);
        });

        const uniqueCustomers = Array.from(
            new Map(allMatchingCustomers.map(doc => [doc.id, doc])).values()
        );

        let customerRef;
        let oldName = '';

        if (uniqueCustomers.length === 0) {
            // Create new customer record if it doesn't exist
            // ALWAYS use the 10-digit standardized number as the phone and document ID
            const last10 = phoneNumber.replace(/\D/g, '').slice(-10);
            customerRef = customersRef.doc(last10);
            await customerRef.set({
                phoneNumber: last10,
                customName: customName || '',
                notes: notes || '',
                createdAt: new Date(),
                totalOrders: 0,
                totalSpent: 0
            });
        } else {
            // Prefer the record that has totalSpend (consistent with GET)
            let chosenDoc = uniqueCustomers.find(doc => {
                const data = doc.data();
                return data.totalSpend !== undefined && data.totalSpend !== null;
            }) || uniqueCustomers[0];

            customerRef = chosenDoc.ref;
            oldName = chosenDoc.data().customName || chosenDoc.data().name;

            const updates = {};
            if (customName !== undefined) updates.customName = customName;
            if (notes !== undefined) updates.notes = notes;

            if (Object.keys(updates).length > 0) {
                await customerRef.update(updates);
            }
        }

        // Sync with Conversation document for immediate UI reflect in the list and instant notes load
        const last10 = phoneNumber.replace(/\D/g, '').slice(-10);
        const conversationsRef = businessRef.collection('conversations');
        const convRef = conversationsRef.doc(last10);

        const convUpdates = {};
        if (customName !== undefined && customName !== oldName) convUpdates.customerName = customName;
        if (notes !== undefined) convUpdates.notes = notes;

        if (Object.keys(convUpdates).length > 0) {
            // Check if conversation exists (might have been deleted if > 7 days)
            const convSnap = await convRef.get();
            if (convSnap.exists) {
                await convRef.update(convUpdates);
            }
        }

        // Fetch the latest details to return to the frontend for immediate sync
        const freshDetails = await fetchLatestCustomerDetails(businessRef, phoneNumber, firestore);

        return NextResponse.json({
            message: 'Customer details updated successfully',
            details: freshDetails
        }, { status: 200 });

    } catch (error) {
        console.error("PATCH Customer Details Error:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}

// Helper to get fresh data for sync (used by both GET and PATCH)
async function fetchLatestCustomerDetails(businessRef, phoneNumber, firestore) {
    const customersRef = businessRef.collection('customers');
    const uniqueVariations = getPhoneVariations(phoneNumber);
    const lookupPromises = uniqueVariations.flatMap(variant => [
        customersRef.where('phoneNumber', '==', variant).get(),
        customersRef.where('phone', '==', variant).get(),
        customersRef.doc(variant).get()
    ]);

    const snapshots = await Promise.all(lookupPromises);
    const allMatchingCustomers = [];

    snapshots.forEach(snap => {
        if (snap.docs) snap.docs.forEach(doc => allMatchingCustomers.push(doc));
        else if (snap.exists) allMatchingCustomers.push(snap);
    });

    const uniqueCustomers = Array.from(new Map(allMatchingCustomers.map(doc => [doc.id, doc])).values());
    if (uniqueCustomers.length === 0) return null;

    const customerDoc = uniqueCustomers.find(doc => {
        const d = doc.data();
        return d.totalSpend !== undefined && d.totalSpend !== null;
    }) || uniqueCustomers[0];

    const data = customerDoc.data();

    // Calculate dynamic stats
    const ordersRef = firestore.collection('orders');
    const orderQueries = uniqueVariations.map(variant =>
        ordersRef.where('restaurantId', '==', businessRef.id).where('customerPhone', '==', variant).get()
    );
    const orderSnapshots = await Promise.all(orderQueries);

    const allOrders = new Map();
    orderSnapshots.forEach(snapshot => snapshot.docs.forEach(doc => allOrders.set(doc.id, doc)));

    let totalSpent = 0;
    // Filter rejected orders in memory
    allOrders.forEach(doc => {
        const orderData = doc.data();
        if (orderData.status === 'rejected') {
            allOrders.delete(doc.id);
            return;
        }
        const amount = parseFloat(orderData.totalAmount || orderData.amount || orderData.billTotal || 0);
        if (!isNaN(amount)) totalSpent += amount;
    });

    return {
        customName: data.customName || data.name || '',
        notes: data.notes || '',
        totalOrders: allOrders.size,
        totalSpent: totalSpent,
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : (data.createdAt || null)
    };
}
