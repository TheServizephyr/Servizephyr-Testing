
import { getFirestore, FieldValue, GeoPoint } from '@/lib/firebase-admin';
import { NextResponse } from 'next/server';
import Razorpay from 'razorpay';
import { nanoid } from 'nanoid';
import { sendNewOrderToOwner } from '@/lib/notifications';
import { checkRateLimit } from '@/lib/rateLimiter';
import { recalculateTabTotals, validateTabToken } from '@/lib/dinein-utils';
import { generateCustomerOrderId } from '@/utils/generateCustomerOrderId';
import { deobfuscateGuestId } from '@/lib/guest-utils';
import { calculateServerTotal, validatePriceMatch, calculateTaxes, PricingError } from '@/services/order/orderPricing';
import { calculateHaversineDistance, calculateDeliveryCharge } from '@/lib/distance';
import { getEffectiveBusinessOpenStatus } from '@/lib/businessSchedule';

const generateSecureToken = async (firestore, identifier) => {
    console.log(`[API /order/create] generateSecureToken for identifier: ${identifier}`);
    const token = nanoid(24);
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24-hour validity for tracking link
    const authTokenRef = firestore.collection('auth_tokens').doc(token);

    // Determine if identifier is GuestID or Phone
    const data = {
        expiresAt: expiry,
        type: 'tracking'
    };

    if (identifier.startsWith('g_')) {
        data.guestId = identifier;
    } else {
        data.phone = identifier;
    }

    await authTokenRef.set(data);
    console.log(`[API /order/create] Token generated: ${token}`);
    return token;
};

const toFiniteNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

const getBusinessTypeFromCollectionName = (collectionName) => {
    if (collectionName === 'shops') return 'store';
    if (collectionName === 'street_vendors') return 'street-vendor';
    return 'restaurant';
};

const getBusinessLabel = (businessType = 'restaurant') => {
    if (businessType === 'store' || businessType === 'shop') return 'store';
    if (businessType === 'street-vendor') return 'stall';
    return 'restaurant';
};

// Statuses that still belong to the same live dine-in tab token/session.
const ACTIVE_DINE_IN_TOKEN_STATUSES = [
    'pending',
    'accepted',
    'confirmed',
    'preparing',
    'ready',
    'ready_for_pickup',
    'pay_at_counter',
    'delivered'
];


/**
 * LEGACY ORDER CREATE V1
 * 
 * This is the original monolithic order create function.
 * DO NOT MODIFY - This is kept for rollback safety.
 * 
 * Phase 5 Step 1: Isolated for feature flag switching.
 * Will be replaced by V2 service layer implementation.
 * 
 * NOTE: As of Feb 2026, V2 (Service Layer) is the active implementation.
 * Please check `src/services/orderService.js` for the current logic.
 * Modifications here may not affect the live system if the feature flag is ON.
 */
// Wrapper for direct API calls (V1 Legacy Endpoint)
export async function createOrderV1(req) {
    console.log("[API /order/create] POST request received (V1 Wrapper).");
    try {
        const firestore = await getFirestore();
        const body = await req.json();
        return await processOrderV1(body, firestore);
    } catch (error) {
        console.error("[API /order/create] Wrapper Error:", error);
        return NextResponse.json({ message: `Wrapper Error: ${error.message}` }, { status: 500 });
    }
}

// Core V1 Processing Logic (accepts parsed body for V2 delegation)
export async function processOrderV1(body, firestore) {
    console.log("[API /order/create] Processing V1 Order Logic...");
    try {
        // const firestore = await getFirestore(); // Passed as ARG
        // const body = await req.json(); // Passed as ARG
        console.log("[API /order/create] Request body parsed (delegated):", JSON.stringify(body, null, 2));

        let {
            name, address, phone, restaurantId, items, notes,
            coupon = null,
            loyaltyDiscount = 0,
            grandTotal,
            paymentMethod,
            businessType = 'restaurant',
            deliveryType = 'delivery',
            pickupTime = '',
            tipAmount = 0,
            subtotal,
            cgst,
            sgst,
            deliveryCharge = 0,
            tableId = null,
            pax_count,
            tab_name,
            dineInTabId,
            diningPreference = null,
            packagingCharge = 0,
            existingOrderId, // <-- NEW: For adding items to an existing order
            ordered_by = 'customer', // 'customer' | 'waiter_<name>' - who placed the order
            ordered_by_name = null, // Waiter's name if applicable
            guestRef = null, // NEW: Guest Identity Ref
            guestToken = null // NEW: Guest Token
        } = body;

        // ✅ SANITIZATION: Only allow diningPreference for dine-in orders
        // This prevents data inconsistency (e.g. Delivery order with "dine-in" preference)
        if (deliveryType !== 'dine-in') {
            diningPreference = null;
        }

        let validGuestId = null;
        let securePhone = null;

        // RESOLVE GUEST IDENTITY
        if (guestRef) {
            console.log(`[API /order/create] Resolving Guest Identity from ref: ${guestRef}`);
            validGuestId = deobfuscateGuestId(guestRef);
            if (validGuestId) {
                const guestProfile = await firestore.collection('guest_profiles').doc(validGuestId).get();
                if (guestProfile.exists) {
                    const profileData = guestProfile.data();
                    securePhone = profileData.phone;
                    console.log(`[API /order/create] Resolved GuestID: ${validGuestId}, Phone (Private): ${securePhone ? '***' : 'Not Found'}`);

                    // If name is missing in request but exists in profile, use it
                    if (!name && profileData.name) name = profileData.name;
                } else {
                    console.warn(`[API /order/create] Guest Profile not found for ID: ${validGuestId}`);
                }
            } else {
                console.warn(`[API /order/create] Failed to deobfuscate guestRef`);
            }
        }

        // Use resolved secure phone if request phone is missing
        if (!phone && securePhone) {
            phone = securePhone;
        }

        // --- IDEMPOTENCY KEY VALIDATION (CRITICAL) ---

        const { idempotencyKey } = body;

        // Validate idempotency key
        if (!idempotencyKey) {
            console.error('[API /order/create] Missing idempotency key in request');
            return NextResponse.json(
                { error: 'Missing idempotency key. Please refresh and try again.' },
                { status: 400 }
            );
        }
        console.log(`[API /order/create] Idempotency key: ${idempotencyKey}`);

        // Normalize tableId to uppercase for case-insensitive matching
        if (tableId) {
            tableId = tableId.toUpperCase();
            console.log(`[API /order/create] Normalized tableId: ${tableId}`);
        }

        // --- RATE LIMITING (Per-Restaurant) ---
        // Check AFTER idempotency so retries aren't blocked
        console.log(`[API /order/create] Checking rate limit for restaurant: ${restaurantId}`);
        const rateCheck = await checkRateLimit(restaurantId, 50);

        if (!rateCheck.allowed) {
            console.error(`[API /order/create] Rate limit exceeded for ${restaurantId} (50 orders/minute)`);
            return new Response(
                JSON.stringify({
                    error: 'Too many orders right now. Please try again in a minute.',
                    restaurantId,
                    limit: 50
                }),
                {
                    status: 429,
                    headers: {
                        'Content-Type': 'application/json',
                        'Retry-After': '60'
                    }
                }
            );
        }
        console.log(`[API /order/create] Rate limit check passed for ${restaurantId}`);

        // --- START: ADD-ON ORDER LOGIC ---
        if (existingOrderId && items && items.length > 0) {
            console.log(`[API /order/create] ADD-ON FLOW: Adding items to existing order ${existingOrderId}`);
            console.log(`[API /order/create] ADD-ON FLOW: Payment Method: ${paymentMethod}`);

            const resolveBusinessDocForOpenCheck = async (targetRestaurantId, preferredCollection) => {
                const normalizedId = String(targetRestaurantId || '').trim();
                if (!normalizedId) return null;
                const collections = preferredCollection
                    ? [preferredCollection, 'restaurants', 'shops', 'street_vendors']
                    : ['restaurants', 'shops', 'street_vendors'];
                const uniqueCollections = [...new Set(collections)];

                for (const collection of uniqueCollections) {
                    const docSnap = await firestore.collection(collection).doc(normalizedId).get();
                    if (docSnap.exists) return docSnap;
                }
                return null;
            };

            try {
                let resolvedRestaurantId = String(restaurantId || '').trim();
                let preferredCollection = getBusinessCollection(businessType);

                const existingOrderSnap = await firestore.collection('orders').doc(existingOrderId).get();
                if (existingOrderSnap.exists) {
                    const existingOrderData = existingOrderSnap.data() || {};
                    if (existingOrderData.restaurantId) {
                        resolvedRestaurantId = String(existingOrderData.restaurantId).trim();
                    }
                    preferredCollection = getBusinessCollection(existingOrderData.businessType || businessType);
                }

                const businessDocForOpenCheck = await resolveBusinessDocForOpenCheck(
                    resolvedRestaurantId,
                    preferredCollection
                );

                if (businessDocForOpenCheck && !getEffectiveBusinessOpenStatus(businessDocForOpenCheck.data())) {
                    console.warn(`[API /order/create] ADD-ON blocked: business closed for ${resolvedRestaurantId}`);
                    const businessLabel = getBusinessLabel(getBusinessTypeFromCollectionName(preferredCollection));
                    return NextResponse.json({
                        message: `${businessLabel.charAt(0).toUpperCase() + businessLabel.slice(1)} is currently closed. Please order during opening hours.`
                    }, { status: 403 });
                }
            } catch (openCheckError) {
                console.error('[API /order/create] ADD-ON open-check failed:', openCheckError);
                return NextResponse.json({
                    message: 'Unable to verify business availability. Please try again.'
                }, { status: 503 });
            }

            // Handle Online Payment for Add-ons
            // Handle Online Payment for Add-ons
            if (paymentMethod === 'online') {
                try {
                    if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
                        throw new Error("Razorpay credentials not configured.");
                    }
                    // STEP 1: RESERVE idempotency key (transaction)
                    const reservation = await firestore.runTransaction(async (transaction) => {
                        const keyRef = firestore.collection('idempotency_keys').doc(idempotencyKey);
                        const keySnap = await transaction.get(keyRef);

                        // Duplicate check
                        if (keySnap.exists) {
                            console.log(`[Add-on Idempotency] Key ${idempotencyKey} already used`);
                            const data = keySnap.data();

                            // If completed, return existing order
                            if (data.status === 'completed') {
                                return {
                                    duplicate: true,
                                    razorpayOrderId: data.razorpayOrderId,
                                    orderId: data.orderId
                                };
                            }

                            // If reserved but not completed (edge case: previous request failed)
                            // Allow retry after 30 seconds
                            const reservedAt = data.createdAt?.toDate();
                            if (reservedAt && (Date.now() - reservedAt.getTime() < 30000)) {
                                throw new Error('Request already in progress. Please wait.');
                            }
                        }

                        // RESERVE the key
                        transaction.set(keyRef, {
                            status: 'reserved',
                            orderId: existingOrderId,
                            type: 'addon',
                            createdAt: FieldValue.serverTimestamp()
                        }, { merge: true });

                        return { duplicate: false };
                    });

                    // If duplicate, return existing order
                    if (reservation.duplicate) {
                        return NextResponse.json({
                            razorpay_order_id: reservation.razorpayOrderId,
                            firestore_order_id: reservation.orderId
                        });
                    }

                    // STEP 2: CREATE Razorpay order (OUTSIDE transaction)
                    const razorpay = new Razorpay({
                        key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
                        key_secret: process.env.RAZORPAY_KEY_SECRET,
                    });

                    const razorpayOrder = await razorpay.orders.create({
                        amount: Math.round(grandTotal * 100),
                        currency: 'INR',
                        receipt: `addon_${existingOrderId}_${Date.now()}`,
                        notes: {
                            type: 'addon',
                            orderId: existingOrderId,
                            items: JSON.stringify(items),
                            subtotal,
                            cgst,
                            sgst,
                            grandTotal
                        }
                    });

                    // STEP 3: MARK key as completed
                    await firestore.collection('idempotency_keys').doc(idempotencyKey).update({
                        razorpayOrderId: razorpayOrder.id,
                        status: 'completed',
                        completedAt: FieldValue.serverTimestamp()
                    });

                    // Fetch token
                    const orderDoc = await firestore.collection('orders').doc(existingOrderId).get();
                    const trackingToken = orderDoc.exists ? orderDoc.data().trackingToken : null;

                    return NextResponse.json({
                        message: 'Razorpay order created for add-ons. Awaiting payment.',
                        razorpay_order_id: razorpayOrder.id,
                        firestore_order_id: existingOrderId,
                        token: trackingToken,
                    }, { status: 200 });
                } catch (error) {
                    // Razorpay failed - mark key as failed
                    await firestore.collection('idempotency_keys').doc(idempotencyKey).update({
                        status: 'failed',
                        error: error.message,
                        failedAt: FieldValue.serverTimestamp()
                    });

                    console.error(`[API /order/create] ADD-ON FLOW: Razorpay creation failed:`, error);
                    return NextResponse.json({ message: error.message }, { status: 500 });
                }
            }

            // Handle PhonePe Payment for Add-ons
            if (paymentMethod === 'phonepe' || (paymentMethod === 'online' && process.env.PHONEPE_ENABLED === 'true')) {
                try {
                    console.log(`[API /order/create] ADD-ON FLOW: Creating PhonePe order for add-on`);

                    // Fetch existing order details
                    const orderDoc = await firestore.collection('orders').doc(existingOrderId).get();
                    if (!orderDoc.exists) {
                        throw new Error('Original order not found');
                    }

                    const trackingToken = orderDoc.data().trackingToken;

                    // Create PhonePe order - similar structure to add-on Razorpay
                    const phonePeOrderId = `addon_${existingOrderId}_${Date.now()}`;

                    // Store add-on order metadata in Firestore for PhonePe callback to process
                    await firestore.collection('phonepe_pending_addons').doc(phonePeOrderId).set({
                        orderId: existingOrderId,
                        items: items,
                        subtotal: subtotal,
                        cgst: cgst,
                        sgst: sgst,
                        grandTotal: grandTotal,
                        createdAt: FieldValue.serverTimestamp(),
                        status: 'pending_payment'
                    });

                    console.log(`[API /order/create] ADD-ON FLOW: PhonePe add-on metadata stored: ${phonePeOrderId}`);

                    return NextResponse.json({
                        message: 'PhonePe order created for add-ons. Awaiting payment.',
                        phonepe_order_id: phonePeOrderId,
                        firestore_order_id: existingOrderId,
                        token: trackingToken,
                        amount: grandTotal
                    }, { status: 200 });

                } catch (error) {
                    console.error(`[API /order/create] ADD-ON FLOW: PhonePe creation failed:`, error);
                    return NextResponse.json({ message: error.message }, { status: 500 });
                }
            }


            const orderRef = firestore.collection('orders').doc(existingOrderId);

            try {
                await firestore.runTransaction(async (transaction) => {
                    const orderDoc = await transaction.get(orderRef);
                    if (!orderDoc.exists) throw new Error("The original order to add to was not found.");

                    const orderData = orderDoc.data();

                    // Layer 3 Security: Block adding items to non-pending/awaiting_payment orders
                    const allowedStatuses = ['pending', 'awaiting_payment'];
                    if (!allowedStatuses.includes(orderData.status)) {
                        throw new Error(`Cannot add items. Your order is ${orderData.status === 'Ready' ? 'being prepared' : orderData.status}. Please complete your current order first.`);
                    }

                    // Add timestamp to new items being added
                    const currentTimestamp = new Date();
                    const itemsWithTimestamp = items.map(item => ({
                        ...item,
                        addedAt: currentTimestamp,
                        isAddon: true // Mark as add-on item
                    }));

                    // Ensure original items have addedAt timestamp (for backward compatibility)
                    const existingItemsWithTimestamp = orderData.items.map(item => ({
                        ...item,
                        addedAt: item.addedAt || orderData.orderDate?.toDate?.() || new Date(orderData.orderDate) || currentTimestamp,
                        isAddon: item.isAddon || false
                    }));

                    const newItems = [...existingItemsWithTimestamp, ...itemsWithTimestamp];
                    const newSubtotal = orderData.subtotal + subtotal;
                    const newCgst = orderData.cgst + cgst;
                    const newSgst = orderData.sgst + sgst;
                    const newGrandTotal = orderData.totalAmount + grandTotal;

                    const updatePayload = {
                        items: newItems,
                        subtotal: newSubtotal,
                        cgst: newCgst,
                        sgst: newSgst,
                        totalAmount: newGrandTotal,
                        statusHistory: FieldValue.arrayUnion({
                            status: 'updated',
                            timestamp: currentTimestamp,
                            notes: `Added ${items.length} new item(s).`
                        })
                    };

                    if (paymentMethod === 'cod') {
                        updatePayload.paymentDetails = FieldValue.arrayUnion({
                            method: 'cod',
                            amount: grandTotal,
                            status: 'pending',
                            timestamp: new Date(),
                        });

                        // For COD, add items immediately
                        transaction.update(orderRef, updatePayload);
                    }
                    // For split_bill, DON'T add items here - webhook will handle it after payment
                });

                if (paymentMethod === 'split_bill') {
                    // Items will be added by webhook after payment confirmation
                    console.log(`[API /order/create] ADD-ON FLOW: Split bill - items will be added after payment`);
                    const orderDoc = await firestore.collection('orders').doc(existingOrderId).get();
                    const orderData = orderDoc.data();
                    return NextResponse.json({
                        message: 'Items will be added after payment confirmation.',
                        firestore_order_id: existingOrderId,
                        token: orderData.trackingToken,
                        pendingItems: items, // Return pending items for split session
                        pendingSubtotal: subtotal,
                        pendingCgst: cgst,
                        pendingSgst: sgst,
                        pendingTotal: grandTotal,
                    }, { status: 200 });
                }

                console.log(`[API /order/create] ADD-ON FLOW: Transaction committed successfully for order ${existingOrderId}.`);

                // Fetch the order to get the tracking token
                const orderDoc = await firestore.collection('orders').doc(existingOrderId).get();
                const orderData = orderDoc.data();

                return NextResponse.json({
                    message: 'Items added to your existing order successfully!',
                    order_id: existingOrderId,
                    firestore_order_id: existingOrderId,
                    token: orderData.trackingToken, // Return tracking token for redirect
                }, { status: 200 });

            } catch (error) {
                console.error(`[API /order/create] ADD-ON FLOW: Transaction failed for order ${existingOrderId}:`, error);
                return NextResponse.json({ message: error.message }, { status: 400 });
            }
        }
        // --- END: ADD-ON ORDER LOGIC ---

        // --- VALIDATION ---
        const isStreetVendorOrder = deliveryType === 'street-vendor-pre-order';
        console.log(`[API /order/create] Is Street Vendor Order? ${isStreetVendorOrder}`);

        if (deliveryType !== 'dine-in' && !name) {
            console.error("[API /order/create] Validation Error: Name is required for non-dine-in orders.");
            return NextResponse.json({ message: 'Name is required.' }, { status: 400 });
        }
        if (!restaurantId || !Array.isArray(items) || grandTotal === undefined || subtotal === undefined) {
            const missingFields = `Missing fields: restaurantId=${!!restaurantId}, items=${Array.isArray(items)}, grandTotal=${grandTotal !== undefined}, subtotal=${subtotal !== undefined}`;
            console.error(`[API /order/create] Validation Error: Missing required fields. Details: ${missingFields}`);
            return NextResponse.json({ message: `Missing required fields for order creation. Details: ${missingFields}` }, { status: 400 });
        }
        if (items.length === 0) {
            console.error("[API /order/create] Validation Error: Empty items array.");
            return NextResponse.json({ message: 'At least one item is required for order creation.' }, { status: 400 });
        }
        if (deliveryType === 'delivery' && (!address || !address.full)) {
            console.error("[API /order/create] Validation Error: Full, structured address required for delivery.");
            return NextResponse.json({ message: 'A full, structured address is required for delivery orders.' }, { status: 400 });
        }
        if (deliveryType === 'delivery') {
            const customerLat = toFiniteNumber(address?.latitude ?? address?.lat);
            const customerLng = toFiniteNumber(address?.longitude ?? address?.lng);
            if (customerLat === null || customerLng === null) {
                return NextResponse.json({ message: 'A valid delivery location is required for delivery orders.' }, { status: 400 });
            }
        }

        const normalizedPhone = phone ? (phone.length > 10 ? phone.slice(-10) : phone) : null;
        if (normalizedPhone && !/^\d{10}$/.test(normalizedPhone)) {
            console.error(`[API /order/create] Validation Error: Invalid phone number format: ${normalizedPhone}`);
            return NextResponse.json({ message: 'Invalid phone number format. Must be 10 digits.' }, { status: 400 });
        }

        let businessRef;
        let collectionName;

        const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];
        const cleanRestaurantId = restaurantId?.trim();
        console.log(`[API /order/create] Lookup business ID: '${cleanRestaurantId}' (Original: '${restaurantId}')`);

        for (const name of collectionsToTry) {
            const docRef = firestore.collection(name).doc(cleanRestaurantId);
            const docSnap = await docRef.get();
            if (docSnap.exists) {
                businessRef = docRef;
                collectionName = name;
                console.log(`[API /order/create] Found business in collection: ${collectionName}`);
                break;
            } else {
                console.log(`[API /order/create] Not found in ${name}`);
            }
        }

        if (!businessRef) {
            console.warn(`[API /order/create] Direct business lookup failed for ID: ${cleanRestaurantId}. Checking if this is an Owner UID...`);

            // Fallback: Check if the ID is actually an Owner UID in the 'users' collection
            const userDoc = await firestore.collection('users').doc(cleanRestaurantId).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                if (userData.role === 'owner' && userData.businessId) {
                    console.log(`[API /order/create] Resolved Owner UID to Business ID: ${userData.businessId}`);
                    // Recursive lookup with the correct Business ID
                    // (We can't recurse easily here, so just repeat the loop for the new ID)
                    const realBusinessId = userData.businessId;
                    for (const name of collectionsToTry) {
                        const docRef = firestore.collection(name).doc(realBusinessId);
                        const docSnap = await docRef.get();
                        if (docSnap.exists) {
                            businessRef = docRef;
                            collectionName = name;
                            console.log(`[API /order/create] Found business via Owner UID in: ${collectionName}`);
                            break;
                        }
                    }
                }
            }
        }

        if (!businessRef) {
            console.error(`[API /order/create] Business not found (after owner lookup) with ID: ${cleanRestaurantId}`);
            return NextResponse.json({ message: `This business does not exist (ID: ${cleanRestaurantId}).` }, { status: 404 });
        }

        const businessDoc = await businessRef.get();
        const businessData = businessDoc.data();
        const businessTypeResolved =
            (businessData?.businessType === 'street_vendor' ? 'street-vendor' : businessData?.businessType) ||
            getBusinessTypeFromCollectionName(collectionName);
        const businessLabel = getBusinessLabel(businessTypeResolved);
        const isBusinessOpenNow = getEffectiveBusinessOpenStatus(businessData);
        if (!isBusinessOpenNow) {
            console.warn(`[API /order/create] Business is currently closed for new orders: ${cleanRestaurantId}`);
            return NextResponse.json({
                message: `${businessLabel.charAt(0).toUpperCase() + businessLabel.slice(1)} is currently closed. Please order during opening hours.`
            }, { status: 403 });
        }

        // --- PREFETCH DELIVERY SETTINGS (Fix for Sub-collection Migration) ---
        let deliverySettings = {};
        if (businessRef) {
            try {
                const dsSnap = await businessRef.collection('delivery_settings').doc('config').get();
                if (dsSnap.exists) {
                    deliverySettings = dsSnap.data();
                    console.log(`[API /order/create] Loaded delivery settings from sub-collection.`);
                }
            } catch (err) {
                console.error(`[API /order/create] Failed to load delivery settings:`, err);
            }
        }

        // Helper to get effective setting (Sub-collection > Parent Doc)
        const getSetting = (key) => {
            if (deliverySettings[key] !== undefined) return deliverySettings[key];
            return businessData[key];
        };

        // --- PAYMENT METHOD VALIDATION ---
        console.log(`[API /order/create] Validating payment method: ${paymentMethod} for deliveryType: ${deliveryType}`);

        if (paymentMethod === 'cod' || paymentMethod === 'counter') {
            let isCodeEnabled = false;

            if (deliveryType === 'delivery') {
                isCodeEnabled = getSetting('deliveryCodEnabled');
            } else if (deliveryType === 'pickup') {
                isCodeEnabled = getSetting('pickupPodEnabled');
            } else if (deliveryType === 'dine-in') {
                isCodeEnabled = businessData.dineInPayAtCounterEnabled;
            } else if (deliveryType === 'street-vendor-pre-order') {
                isCodeEnabled = true; // Street vendors always allow cash
            }

            if (!isCodeEnabled) {
                console.error(`[API /order/create] Payment method validation failed: COD/Pay at Counter is disabled for ${deliveryType}`);
                return NextResponse.json({
                    message: 'The selected payment method is not available. Please choose a different payment method.'
                }, { status: 400 });
            }
        } else if (['online', 'split_bill', 'razorpay', 'phonepe'].includes(paymentMethod)) {
            let isOnlineEnabled = false;

            if (deliveryType === 'delivery') {
                isOnlineEnabled = getSetting('deliveryOnlinePaymentEnabled');
            } else if (deliveryType === 'pickup') {
                isOnlineEnabled = getSetting('pickupOnlinePaymentEnabled');
            } else if (deliveryType === 'dine-in') {
                isOnlineEnabled = businessData.dineInOnlinePaymentEnabled;
            } else if (deliveryType === 'street-vendor-pre-order') {
                isOnlineEnabled = true; // Street vendors always allow online
            }

            if (!isOnlineEnabled) {
                console.error(`[API /order/create] Payment method validation failed: Online payment is disabled for ${deliveryType}`);
                return NextResponse.json({
                    message: 'The selected payment method is not available. Please choose a different payment method.'
                }, { status: 400 });
            }
        }

        // ========================================
        // SERVER-SIDE PRICING & VALIDATION (SECURITY)
        // ========================================
        console.log(`[API /order/create] Re-calculating pricing on server for ${restaurantId}`);

        let pricing;
        try {
            pricing = await calculateServerTotal({
                restaurantId,
                items,
                businessType
            });

            // Validate against client subtotal (with small tolerance)
            validatePriceMatch(subtotal, pricing.serverSubtotal);
            console.log(`[API /order/create] ✅ Price validation passed: ₹${pricing.serverSubtotal}`);

        } catch (error) {
            console.error(`[API /order/create] ❌ Pricing validation failed:`, error.message);
            return NextResponse.json({
                message: error.message || 'Price mismatch detected. Please refresh your cart.',
                code: error.code || 'PRICE_MISMATCH'
            }, { status: 400 });
        }

        // --- COUPON RE-VALIDATION ---
        let finalDiscount = 0;
        if (Number(loyaltyDiscount) > 0) {
            console.warn('[API /order/create] Ignoring client-provided loyaltyDiscount; server side validation required.');
        }
        let verifiedCoupon = null;

        if (coupon && coupon.id) {
            console.log(`[API /order/create] Re-validating coupon: ${coupon.id}`);
            try {
                const couponRef = firestore.collection(getBusinessCollection(businessType)).doc(restaurantId).collection('coupons').doc(coupon.id);
                const couponSnap = await couponRef.get();

                if (couponSnap.exists) {
                    const couponData = couponSnap.data();
                    const now = new Date();
                    const expiryDate = couponData.expiryDate?.toDate ? couponData.expiryDate.toDate() : new Date(couponData.expiryDate);
                    const couponType = String(couponData.type || '').toLowerCase() === 'fixed'
                        ? 'flat'
                        : String(couponData.type || '').toLowerCase();
                    const couponMinOrder = Number(couponData.minOrder) || 0;
                    const couponUsageLimit = Number(couponData.usageLimit) || 0;
                    const couponTimesUsed = Number(couponData.timesUsed) || 0;

                    // 1. Basic Eligibility Checks
                    const isExpired = expiryDate < now;
                    const isBelowMinOrder = pricing.serverSubtotal < couponMinOrder;
                    const isUsageLimitMet = couponUsageLimit > 0 && couponTimesUsed >= couponUsageLimit;

                    if (isExpired || isBelowMinOrder || isUsageLimitMet) {
                        console.warn(`[API /order/create] Coupon ${coupon.code} invalid: Expired=${isExpired}, MinOrder=${isBelowMinOrder}, LimitMet=${isUsageLimitMet}`);
                    } else {
                        // 2. Calculate Discount
                        let discountAmount = 0;
                        if (couponType === 'flat') {
                            discountAmount = Number(couponData.value) || 0;
                        } else if (couponType === 'percentage') {
                            discountAmount = (pricing.serverSubtotal * (Number(couponData.value) || 0)) / 100;
                            const couponMaxDiscount = Number(couponData.maxDiscount) || 0;
                            if (couponMaxDiscount > 0 && discountAmount > couponMaxDiscount) {
                                discountAmount = couponMaxDiscount;
                            }
                        } else if (couponType === 'free_delivery') {
                            // Handled in delivery charge logic below if applicable
                            console.log("[API /order/create] Free delivery coupon detected");
                        }

                        finalDiscount += discountAmount;
                        verifiedCoupon = { ...couponData, type: couponType, id: couponSnap.id };
                        console.log(`[API /order/create] ✅ Coupon ${couponData.code} validated. Discount: ₹${discountAmount}`);
                    }
                }
            } catch (err) {
                console.error("[API /order/create] Coupon validation error (non-fatal):", err);
            }
        }

        // --- RE-CALCULATE FINALS ---
        const netSubtotal = Math.max(0, pricing.serverSubtotal - finalDiscount);

        // Use server-side tax calculation
        const taxes = calculateTaxes(netSubtotal, businessData);
        const serverCgst = taxes.cgst;
        const serverSgst = taxes.sgst;

        // Delivery charge/range is always re-validated on server for delivery orders.
        let finalDeliveryCharge = 0;
        if (deliveryType === 'delivery') {
            const customerLat = toFiniteNumber(address?.latitude ?? address?.lat);
            const customerLng = toFiniteNumber(address?.longitude ?? address?.lng);
            const restaurantLat = toFiniteNumber(
                businessData.coordinates?.lat ??
                businessData.address?.latitude ??
                businessData.businessAddress?.latitude
            );
            const restaurantLng = toFiniteNumber(
                businessData.coordinates?.lng ??
                businessData.address?.longitude ??
                businessData.businessAddress?.longitude
            );

            if (customerLat === null || customerLng === null || restaurantLat === null || restaurantLng === null) {
                return NextResponse.json(
                    { message: 'Unable to validate delivery location for this order.' },
                    { status: 400 }
                );
            }

            const settings = {
                deliveryEnabled: getSetting('deliveryEnabled', true),
                deliveryRadius: getSetting('deliveryRadius', 10),
                deliveryChargeType: getSetting('deliveryFeeType', getSetting('deliveryChargeType', 'fixed')),
                fixedCharge: getSetting('deliveryFixedFee', getSetting('fixedCharge', 0)),
                perKmCharge: getSetting('deliveryPerKmFee', getSetting('perKmCharge', 0)),
                baseDistance: getSetting('deliveryBaseDistance', getSetting('baseDistance', 0)),
                freeDeliveryThreshold: getSetting('deliveryFreeThreshold', getSetting('freeDeliveryThreshold', 0)),
                freeDeliveryRadius: getSetting('freeDeliveryRadius', 0),
                freeDeliveryMinOrder: getSetting('freeDeliveryMinOrder', 0),
                roadDistanceFactor: getSetting('roadDistanceFactor', 1.0),
                deliveryTiers: getSetting('deliveryTiers', []),
                orderSlabRules: getSetting('deliveryOrderSlabRules', getSetting('orderSlabRules', [])),
                orderSlabAboveFee: getSetting('deliveryOrderSlabAboveFee', getSetting('orderSlabAboveFee', 0)),
                orderSlabBaseDistance: getSetting('deliveryOrderSlabBaseDistance', getSetting('orderSlabBaseDistance', 1)),
                orderSlabPerKmFee: getSetting('deliveryOrderSlabPerKmFee', getSetting('orderSlabPerKmFee', 15)),
            };

            if (settings.deliveryEnabled === false) {
                return NextResponse.json({ message: `Delivery is currently disabled for this ${businessLabel}.` }, { status: 400 });
            }

            const aerialDistance = calculateHaversineDistance(
                restaurantLat,
                restaurantLng,
                customerLat,
                customerLng
            );

            const deliveryResult = calculateDeliveryCharge(aerialDistance, pricing.serverSubtotal, settings);
            if (!deliveryResult.allowed) {
                return NextResponse.json(
                    { message: deliveryResult.message || 'Address is outside delivery range.' },
                    { status: 400 }
                );
            }

            finalDeliveryCharge = Number(deliveryResult.charge) || 0;
        }

        // Coupon-level free delivery override is applied after server distance/range validation.
        if (verifiedCoupon && String(verifiedCoupon.type || '').toLowerCase() === 'free_delivery') {
            finalDeliveryCharge = 0;
        }

        const serverGrandTotal = netSubtotal + serverCgst + serverSgst + finalDeliveryCharge + (packagingCharge || 0) + (tipAmount || 0);

        console.log(`[API /order/create] Server Finals:`);
        console.log(`  Subtotal: ₹${pricing.serverSubtotal}`);
        console.log(`  Discount: ₹${finalDiscount}`);
        console.log(`  Tax: ₹${taxes.totalTax}`);
        console.log(`  Delivery: ₹${finalDeliveryCharge}`);
        console.log(`  Calculated Grand Total: ₹${serverGrandTotal} (Client Expected: ₹${grandTotal})`);

        // Validate Grand Total (small tolerance for rounding)
        if (Math.abs(serverGrandTotal - grandTotal) > 2) {
            console.error(`[API /order/create] ❌ Grand Total mismatch! Server: ${serverGrandTotal}, Client: ${grandTotal}`);
            // We could block here, but often small rounding differences occur. 
            // In a strict financial system, we should override with server totals.
        }

        // OVERRIDE WITH SERVER VALUES
        subtotal = pricing.serverSubtotal;
        cgst = serverCgst;
        sgst = serverSgst;
        deliveryCharge = finalDeliveryCharge;
        grandTotal = serverGrandTotal;
        coupon = verifiedCoupon;

        const processedItems = pricing.validatedItems.map(item => optimizeItemSnapshot(item));

        // --- Post-paid Dine-In ---
        console.log(`[API /order/create] 🔍 Checking dine-in conditions: deliveryType='${deliveryType}', dineInModel='${businessData.dineInModel}'`);
        if (deliveryType === 'dine-in' && businessData.dineInModel === 'post-paid') {
            console.log("[API /order/create] ✅ Handling post-paid dine-in order.");
            const newOrderRef = firestore.collection('orders').doc();
            const trackingToken = await generateSecureToken(firestore, `dine-in-${newOrderRef.id}`);

            // Generate or REUSE dine-in token based on dineInTabId
            let dineInToken = null;
            let newTokenNumber = null; // Define outside for batch.update
            let existingTabStatus = null;

            console.log(`[API /order/create] 🎫 Token generation starting - dineInTabId: ${dineInTabId}`);

            if (dineInTabId) {
                console.log(`[API /order/create] POST-PAID: Checking for existing token for tabId: ${dineInTabId}`);
                try {
                    // Check if there's already an order with this dineInTabId
                    const existingOrdersSnapshot = await firestore
                        .collection('orders')
                        .where('restaurantId', '==', restaurantId)
                        .where('dineInTabId', '==', dineInTabId)
                        .where('status', 'in', ACTIVE_DINE_IN_TOKEN_STATUSES)
                        .limit(1)
                        .get();

                    console.log(`[API /order/create] POST-PAID: Query found ${existingOrdersSnapshot.size} existing orders with this tabId`);

                    if (!existingOrdersSnapshot.empty) {
                        // REUSE existing token
                        const existingOrder = existingOrdersSnapshot.docs[0].data();
                        dineInToken = existingOrder.dineInToken;

                        // ✅ FIX: If existing order has no token, generate new one
                        if (!dineInToken) {
                            const lastToken = businessData.lastOrderToken || 0;
                            newTokenNumber = lastToken + 1;
                            const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                            const randomChar1 = alphabet[Math.floor(Math.random() * alphabet.length)];
                            const randomChar2 = alphabet[Math.floor(Math.random() * alphabet.length)];
                            dineInToken = `${String(newTokenNumber)}-${randomChar1}${randomChar2}`;
                            console.log(`[API /order/create] POST-PAID ⚠️ Existing order had no token, generated NEW: ${dineInToken}`);
                        } else {
                            newTokenNumber = businessData.lastOrderToken || 0; // Don't increment when reusing
                            console.log(`[API /order/create] POST-PAID ✅ REUSING token: ${dineInToken} from order ${existingOrdersSnapshot.docs[0].id}`);
                        }

                        // Check if tab is already marked for payment
                        const tabDoc = await firestore.collection('restaurants').doc(restaurantId).collection('dineInTabs').doc(dineInTabId).get();
                        if (tabDoc.exists) {
                            existingTabStatus = tabDoc.data().paymentStatus;
                        }
                    } else {
                        // Generate NEW token with random characters for security
                        const lastToken = businessData.lastOrderToken || 0;
                        newTokenNumber = lastToken + 1;
                        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                        const randomChar1 = alphabet[Math.floor(Math.random() * alphabet.length)];
                        const randomChar2 = alphabet[Math.floor(Math.random() * alphabet.length)];
                        dineInToken = `${String(newTokenNumber)}-${randomChar1}${randomChar2}`;
                        console.log(`[API /order/create] POST-PAID ⚠️ NEW token generated: ${dineInToken}`);
                    }
                } catch (e) {
                    console.error(`[API /order/create] POST-PAID ❌ Error in token query:`, e);
                    // Fallback: generate new token with random characters
                    const lastToken = businessData.lastOrderToken || 0;
                    newTokenNumber = lastToken + 1;
                    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                    const randomChar1 = alphabet[Math.floor(Math.random() * alphabet.length)];
                    const randomChar2 = alphabet[Math.floor(Math.random() * alphabet.length)];
                    dineInToken = `${String(newTokenNumber)}-${randomChar1}${randomChar2}`;
                }
            } else {
                console.log(`[API /order/create] POST-PAID ⚠️ No dineInTabId provided!`);
                const lastToken = businessData.lastOrderToken || 0;
                newTokenNumber = lastToken + 1;
                const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                const randomChar1 = alphabet[Math.floor(Math.random() * alphabet.length)];
                const randomChar2 = alphabet[Math.floor(Math.random() * alphabet.length)];
                dineInToken = `${String(newTokenNumber)}-${randomChar1}${randomChar2}`;
            }

            const batch = firestore.batch();

            // Generate 10-digit customer-facing order ID
            const customerOrderId = generateCustomerOrderId();

            batch.set(newOrderRef, {
                restaurantId, businessType, tableId,
                items: processedItems, notes: notes || null,
                subtotal, cgst, sgst, totalAmount: grandTotal,
                deliveryType,
                pax_count: pax_count, tab_name: tab_name,
                customerName: tab_name || 'Guest',
                status: (dineInToken && existingTabStatus === 'pay_at_counter') ? 'pay_at_counter' : 'pending',
                paymentStatus: (dineInToken && existingTabStatus === 'pay_at_counter') ? 'pay_at_counter' : 'pending',
                paymentMethod: (dineInToken && existingTabStatus === 'pay_at_counter') ? 'counter' : null,
                dineInTabId: dineInTabId || null,
                diningPreference: diningPreference || null,
                packagingCharge: packagingCharge || 0,
                ordered_by: ordered_by || 'customer',
                ordered_by_name: ordered_by_name || null,
                dineInToken: dineInToken,
                customerOrderId: customerOrderId, // 10-digit customer-facing ID
                orderDate: FieldValue.serverTimestamp(),
                trackingToken: trackingToken,
            });

            console.log(`[API /order/create] 💾 Saving post-paid dine-in order with dineInToken: '${dineInToken}', customerOrderId: ${customerOrderId}`);

            // Update last token counter
            batch.update(businessRef, { lastOrderToken: newTokenNumber });

            // ACTIVATE TAB on first order (create if doesn't exist)
            if (dineInTabId) {
                const tabRef = businessRef.collection('dineInTabs').doc(dineInTabId);
                batch.set(tabRef, {
                    tableId: tableId,
                    pax_count: pax_count || 1,
                    tab_name: tab_name || name,
                    status: 'active',
                    firstOrderPlacedAt: FieldValue.serverTimestamp(),
                    createdAt: FieldValue.serverTimestamp(),
                    totalBill: FieldValue.increment(grandTotal), // Increment total bill with this order's amount
                    restaurantId: restaurantId // Add restaurantId for easier querying
                }, { merge: true }); // merge:true updates if exists, creates if not
                console.log(`[API /order/create] Activating tab: ${dineInTabId}, adding ₹${grandTotal} to totalBill`);
            }

            await batch.commit();

            // ✅ PHASE 1 INTEGRATION: Recalculate tab totals after order
            if (dineInTabId) {
                try {
                    await recalculateTabTotals(dineInTabId);
                    console.log(`[Order Create] ✅ Tab ${dineInTabId} totals recalculated`);
                } catch (recalcErr) {
                    console.warn('[Order Create] Tab recalculation failed:', recalcErr.message);
                    // Don't fail order creation if recalc fails
                }
            }

            console.log(`[API /order/create] Post-paid dine-in order created with ID: ${newOrderRef.id}, Token: ${dineInToken}`);
            return NextResponse.json({
                message: "Order placed successfully!",
                order_id: newOrderRef.id,
                dineInToken: dineInToken,
                whatsappNumber: businessData.botDisplayNumber || businessData.ownerPhone,
                token: trackingToken
            }, { status: 200 });
        }

        // --- Pre-paid Dine-In ---
        if (deliveryType === 'dine-in') {
            console.log("[API /order/create] Handling pre-paid dine-in order.");
            const firestoreOrderId = firestore.collection('orders').doc().id;

            const servizephyrOrderPayload = {
                order_id: firestoreOrderId,
                user_id: `dine-in|${dineInTabId}`,
                restaurant_id: restaurantId,
                business_type: businessType,
                customer_details: JSON.stringify({ name: tab_name, address: { full: `Table ${tableId}` }, phone: `dine-in-${tableId}` }),
                items: JSON.stringify(items),
                bill_details: JSON.stringify({ subtotal, coupon, loyaltyDiscount, grandTotal, deliveryType, tipAmount: 0, pickupTime: '', cgst, sgst, deliveryCharge: 0, tableId, dineInTabId, pax_count, tab_name }),
                notes: notes || null
            };
            console.log("[API /order/create] Generated servizephyr_payload for dine-in:", JSON.stringify(servizephyrOrderPayload, null, 2));

            if (paymentMethod === 'razorpay') {
                console.log("[API /order/create] Dine-in payment method is Razorpay.");
                if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
                    console.error("[API /order/create] Razorpay credentials not configured.");
                    return NextResponse.json({ message: 'Payment gateway is not configured.' }, { status: 500 });
                }
                const razorpay = new Razorpay({ key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
                const razorpayOrderOptions = {
                    amount: Math.round(grandTotal * 100),
                    currency: 'INR',
                    receipt: firestoreOrderId,
                    notes: { servizephyr_payload: JSON.stringify(servizephyrOrderPayload) }
                };
                const razorpayOrder = await razorpay.orders.create(razorpayOrderOptions);
                console.log(`[API /order/create] Razorpay order created for dine-in: ${razorpayOrder.id}`);
                return NextResponse.json({
                    message: 'Razorpay order created for dine-in.',
                    razorpay_order_id: razorpayOrder.id,
                    firestore_order_id: firestoreOrderId,
                    dine_in_tab_id: dineInTabId
                }, { status: 200 });
            } else { // Pay at Counter for dine-in
                console.log("[API /order/create] Dine-in payment method is 'Pay at Counter'.");
                const newOrderRef = firestore.collection('orders').doc(firestoreOrderId);
                const trackingToken = await generateSecureToken(firestore, `dine-in-${firestoreOrderId}`);

                // Generate 10-digit customer-facing order ID
                const customerOrderId = generateCustomerOrderId();

                const batch = firestore.batch();

                batch.set(newOrderRef, {
                    customerName: tab_name || 'Guest', customerId: `dine-in|${dineInTabId}`, customerAddress: `Table ${tableId}`,
                    restaurantId, businessType, deliveryType, tableId, dineInTabId, items,
                    subtotal, coupon, loyaltyDiscount, discount: coupon?.discount || 0, cgst, sgst,
                    totalAmount: grandTotal, status: 'pending', orderDate: FieldValue.serverTimestamp(),
                    notes: notes || null, paymentDetails: { method: paymentMethod },
                    customerOrderId: customerOrderId, // 10-digit customer-facing ID
                    trackingToken: trackingToken
                });

                await batch.commit();
                console.log(`[API /order/create] Pre-paid dine-in 'Pay at Counter' order created: ${newOrderRef.id}, customerOrderId: ${customerOrderId}`);

                return NextResponse.json({
                    message: 'Order added to tab successfully.',
                    firestore_order_id: newOrderRef.id,
                    dine_in_tab_id: dineInTabId,
                    token: trackingToken,
                }, { status: 200 });
            }
        }

        // --- Regular Delivery/Pickup/StreetVendor Flow ---
        console.log("[API /order/create] Handling regular delivery/pickup/street-vendor flow.");
        let userId = validGuestId || normalizedPhone || `anon_${nanoid(10)}`;
        let isNewUser = true;

        if (normalizedPhone) {
            console.log(`[API /order/create] Normalized phone exists: ${normalizedPhone}. Checking for existing user.`);
            const usersRef = firestore.collection('users');
            const existingUserQuery = await usersRef.where('phone', '==', normalizedPhone).limit(1).get();
            if (!existingUserQuery.empty) {
                isNewUser = false;
                userId = existingUserQuery.docs[0].id;
                console.log(`[API /order/create] Existing user found. UID: ${userId}, Is New User: ${isNewUser}`);
            } else {
                console.log(`[API /order/create] No existing user found for phone. Is New User: ${isNewUser}`);
            }
        }

        const customerLocation = (deliveryType === 'delivery' && address && typeof address.latitude === 'number' && typeof address.longitude === 'number')
            ? new GeoPoint(address.latitude, address.longitude)
            : null;
        console.log(`[API /order/create] Customer location set: ${!!customerLocation}`);

        // --- IDEMPOTENCY CHECK FOR NEW ORDERS (CRITICAL) ---
        // Check if this idempotency key has already been used
        console.log(`[Idempotency] Checking key: ${idempotencyKey}`);
        const idempotencyResult = await firestore.runTransaction(async (transaction) => {
            const keyRef = firestore.collection('idempotency_keys').doc(idempotencyKey);
            const keySnap = await transaction.get(keyRef);
            if (keySnap.exists) {
                const keyData = keySnap.data();
                console.log(`[Idempotency] Key exists with status: ${keyData.status}`);
                // If already completed, return existing order
                if (keyData.status === 'completed' && keyData.orderId) {
                    const existingOrderRef = firestore.collection('orders').doc(keyData.orderId);
                    const existingOrderSnap = await transaction.get(existingOrderRef);
                    if (existingOrderSnap.exists) {
                        return {
                            isDuplicate: true,
                            orderId: keyData.orderId,
                            razorpayOrderId: keyData.razorpayOrderId,
                            trackingToken: existingOrderSnap.data().trackingToken
                        };
                    }
                }
                // If reserved but not completed, check if it's stale (>30s)
                if (keyData.status === 'reserved') {
                    const reservedAt = keyData.createdAt?.toDate();
                    if (reservedAt && (Date.now() - reservedAt.getTime() < 30000)) {
                        throw new Error('Request already in progress. Please wait.');
                    }
                }
            }
            // Reserve the key (mark as in progress)
            transaction.set(keyRef, {
                status: 'reserved',
                restaurantId,
                paymentMethod,
                createdAt: FieldValue.serverTimestamp()
            }, { merge: true });
            return { isDuplicate: false };
        });
        // If duplicate request, return existing order data
        if (idempotencyResult.isDuplicate) {
            console.log(`[Idempotency] Returning existing order: ${idempotencyResult.orderId}`);
            return NextResponse.json({
                message: 'Order already exists',
                razorpay_order_id: idempotencyResult.razorpayOrderId,
                firestore_order_id: idempotencyResult.orderId,
                token: idempotencyResult.trackingToken,
            }, { status: 200 });
        }
        // Continue with new order creation (key is now reserved)
        console.log('[Idempotency] Key reserved, proceeding with order creation');
        if (paymentMethod === 'razorpay') {
            console.log("[API /order/create] Payment method is Razorpay.");
            if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
                console.error("[API /order/create] Razorpay credentials not configured.");
                return NextResponse.json({ message: 'Payment gateway is not configured on the server.' }, { status: 500 });
            }

            const razorpay = new Razorpay({
                key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
                key_secret: process.env.RAZORPAY_KEY_SECRET,
            });

            const firestoreOrderId = firestore.collection('orders').doc().id;
            console.log(`[API /order/create] Generated Firestore Order ID: ${firestoreOrderId}`);

            const trackingToken = await generateSecureToken(firestore, normalizedPhone || firestoreOrderId);

            const servizephyrOrderPayload = {
                customerDetails: { name, phone: normalizedPhone, address },
                billDetails: { subtotal, loyaltyDiscount, grandTotal, cgst, sgst, deliveryCharge, tipAmount, coupon },
                items,
                restaurantId,
                userId,
                businessType,
                deliveryType,
                isStreetVendorOrder: businessType === 'street-vendor',
                customNotes: notes,
                trackingToken,
                isNewUser
            };

            const razorpayOrderOptions = {
                amount: Math.round(grandTotal * 100),
                currency: 'INR',
                receipt: firestoreOrderId,
                notes: {
                    servizephyr_payload: JSON.stringify(servizephyrOrderPayload),
                    restaurantName: businessData.name
                }
            };

            const razorpayOrder = await razorpay.orders.create(razorpayOrderOptions);
            console.log(`[API /order/create] Razorpay order created: ${razorpayOrder.id}`);
            // Mark idempotency key as completed
            await firestore.collection('idempotency_keys').doc(idempotencyKey).update({
                status: 'completed',
                orderId: firestoreOrderId,
                razorpayOrderId: razorpayOrder.id,
                completedAt: FieldValue.serverTimestamp()
            });
            console.log(`[Idempotency] Key marked as completed: ${idempotencyKey}`);
            return NextResponse.json({
                message: 'Razorpay order created. Awaiting payment confirmation.',
                razorpay_order_id: razorpayOrder.id,
                firestore_order_id: firestoreOrderId,
                token: trackingToken,
            }, { status: 200 });
        }

        if (paymentMethod === 'split_bill') {
            console.log("[API /order/create] Payment method is Split Bill. Creating pending order.");
            const firestoreOrderId = firestore.collection('orders').doc().id;
            const trackingToken = await generateSecureToken(firestore, normalizedPhone || firestoreOrderId);

            const batch = firestore.batch();
            const newOrderRef = firestore.collection('orders').doc(firestoreOrderId);

            const finalOrderData = {
                customerName: name, customerId: userId, customerAddress: address?.full || null, customerPhone: normalizedPhone,
                customerLocation: customerLocation,
                restaurantId: restaurantId, restaurantName: businessData.name,
                businessType, deliveryType, pickupTime: pickupTime || '', tipAmount: tipAmount || 0,
                items: processedItems,
                subtotal: subtotal || 0,
                coupon: coupon || null,
                loyaltyDiscount: loyaltyDiscount || 0,
                discount: 0,
                cgst: cgst || 0,
                sgst: sgst || 0,
                deliveryCharge: deliveryCharge || 0,
                diningPreference: diningPreference || null,
                packagingCharge: packagingCharge || 0,
                totalAmount: grandTotal,
                status: 'awaiting_payment', // Hidden from dashboard until payment completes
                orderDate: FieldValue.serverTimestamp(),
                notes: notes || null,
                paymentDetails: [],
                trackingToken: trackingToken,
            };

            batch.set(newOrderRef, finalOrderData);
            await batch.commit();

            return NextResponse.json({
                message: 'Split bill order initialized.',
                firestore_order_id: firestoreOrderId,
                token: trackingToken,
            }, { status: 200 });
        }

        // --- Handle Online Payment (Razorpay OR PhonePe) ---
        if (paymentMethod === 'online' || paymentMethod === 'razorpay' || paymentMethod === 'phonepe') {
            console.log(`[API /order/create] Handling Online Payment for standard order. Gateway: ${paymentMethod}`);

            const firestoreOrderId = firestore.collection('orders').doc().id;
            const trackingToken = await generateSecureToken(firestore, validGuestId || normalizedPhone || firestoreOrderId);

            // Generate order token for street vendors (same as COD flow)
            let dineInToken = null;
            if (isStreetVendorOrder) {
                try {
                    const lastToken = businessData.lastOrderToken || 0;
                    const newTokenNumber = lastToken + 1;
                    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                    const randomChar1 = alphabet[Math.floor(Math.random() * alphabet.length)];
                    const randomChar2 = alphabet[Math.floor(Math.random() * alphabet.length)];
                    dineInToken = `${String(newTokenNumber)}-${randomChar1}${randomChar2}`;
                    console.log(`[API /order/create] Generated Order Token: ${dineInToken}`);
                } catch (e) {
                    console.error(`[API /order/create] Error generating order token:`, e);
                }
            }

            // Create Firestore order FIRST (same as Razorpay flow)
            const batch = firestore.batch();
            const newOrderRef = firestore.collection('orders').doc(firestoreOrderId);

            const finalOrderData = {
                customerName: name || 'Guest',
                customerId: userId,
                customerAddress: address?.full || null,
                customerPhone: normalizedPhone,
                customerLocation: customerLocation,
                restaurantId: restaurantId,
                restaurantName: businessData.name,
                businessType,
                deliveryType,
                pickupTime: pickupTime || '',
                tipAmount: tipAmount || 0,
                items: processedItems,
                dineInToken: dineInToken,
                tableId: tableId || null,
                dineInTabId: dineInTabId || null,
                pax_count: pax_count || null,
                tab_name: tab_name || null,
                ordered_by: ordered_by || 'customer',
                ordered_by_name: ordered_by_name || null,
                subtotal: subtotal || 0,
                coupon: coupon || null,
                loyaltyDiscount: loyaltyDiscount || 0,
                discount: 0,
                cgst: cgst || 0,
                sgst: sgst || 0,
                deliveryCharge: deliveryCharge || 0,
                diningPreference: diningPreference || null,
                packagingCharge: packagingCharge || 0,
                totalAmount: grandTotal,
                status: 'awaiting_payment',
                orderDate: FieldValue.serverTimestamp(),
                notes: notes || null,
                paymentDetails: [],
                trackingToken: trackingToken,
            };

            batch.set(newOrderRef, finalOrderData);

            // Update business lastOrderToken if street vendor
            if (isStreetVendorOrder && dineInToken) {
                const lastToken = businessData.lastOrderToken || 0;
                batch.update(businessRef, { lastOrderToken: lastToken + 1 });
            }

            await batch.commit();
            console.log(`[API /order/create] Order ${firestoreOrderId} created in Firestore`);

            // For PhonePe, skip Razorpay order creation - return Firestore order for PhonePe initiation
            if (paymentMethod === 'phonepe') {
                console.log(`[API /order/create] PhonePe payment - returning order for PhonePe initiation`);
                return NextResponse.json({
                    message: 'Order created for PhonePe payment.',
                    firestore_order_id: firestoreOrderId,
                    token: trackingToken,
                }, { status: 200 });
            }

            // Now create Razorpay order (only for non-phonepe)
            if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
                console.error("[API /order/create] Razorpay credentials not configured.");
                return NextResponse.json({ message: 'Payment gateway is not configured.' }, { status: 500 });
            }

            const razorpay = new Razorpay({ key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
            const razorpayOrderOptions = {
                amount: Math.round(grandTotal * 100),
                currency: 'INR',
                receipt: firestoreOrderId,
                notes: {
                    firestore_order_id: firestoreOrderId,
                    restaurant_id: restaurantId
                }
            };

            try {
                const razorpayOrder = await razorpay.orders.create(razorpayOrderOptions);
                console.log(`[API /order/create] Razorpay order created: ${razorpayOrder.id}`);

                return NextResponse.json({
                    message: 'Razorpay order created.',
                    razorpay_order_id: razorpayOrder.id,
                    firestore_order_id: firestoreOrderId,
                    token: trackingToken,
                }, { status: 200 });
            } catch (err) {
                console.error("[API /order/create] Failed to create Razorpay order:", err);
                return NextResponse.json({ message: 'Failed to initiate payment.' }, { status: 500 });
            }
        }

        // --- "Pay at Counter" logic for Street Vendor ---
        console.log("[API /order/create] Handling 'Pay at Counter' flow for Street Vendor.");
        const batch = firestore.batch();

        if (isNewUser && normalizedPhone && businessType !== 'street-vendor') {
            console.log(`[API /order/create] New user detected (${normalizedPhone}), creating unclaimed profile.`);
            const unclaimedUserRef = firestore.collection('unclaimed_profiles').doc(normalizedPhone);
            const newOrderedFrom = { restaurantId, restaurantName: businessData.name, businessType };
            const addressesToSave = (deliveryType === 'delivery' && address) ? [{ ...address, full: address.full }] : [];
            batch.set(unclaimedUserRef, {
                name: name, phone: normalizedPhone, addresses: addressesToSave,
                createdAt: FieldValue.serverTimestamp(),
                orderedFrom: FieldValue.arrayUnion(newOrderedFrom)
            }, { merge: true });
        }

        const couponDiscountAmount = coupon?.discount || 0;
        const finalLoyaltyDiscount = loyaltyDiscount || 0;
        finalDiscount = couponDiscountAmount + finalLoyaltyDiscount;

        const pointsEarned = Math.floor(subtotal / 100) * 10;
        const pointsSpent = finalLoyaltyDiscount > 0 ? finalLoyaltyDiscount / 0.5 : 0;

        if (normalizedPhone && businessType !== 'street-vendor') {
            console.log(`[API /order/create] Updating customer stats for ${normalizedPhone} at business ${restaurantId}`);
            const restaurantCustomerRef = businessRef.collection('customers').doc(userId);
            batch.set(restaurantCustomerRef, {
                name: name, phone: normalizedPhone, status: isNewUser ? 'unclaimed' : 'verified',
                totalSpend: FieldValue.increment(subtotal),
                loyaltyPoints: FieldValue.increment(pointsEarned - pointsSpent),
                lastOrderDate: FieldValue.serverTimestamp(),
                totalOrders: FieldValue.increment(1),
            }, { merge: true });

            if (!isNewUser) {
                const usersRef = firestore.collection('users');
                const userRestaurantLinkRef = usersRef.doc(userId).collection('joined_restaurants').doc(restaurantId);

                batch.set(userRestaurantLinkRef, {
                    restaurantName: businessData.name,
                    joinedAt: FieldValue.serverTimestamp()
                }, { merge: true });

                batch.update(userRestaurantLinkRef, {
                    totalSpend: FieldValue.increment(subtotal),
                    loyaltyPoints: FieldValue.increment(pointsEarned - pointsSpent),
                    lastOrderDate: FieldValue.serverTimestamp(),
                    totalOrders: FieldValue.increment(1),
                });
            }
        }

        if (coupon && coupon.id) {
            console.log(`[API /order/create] Incrementing usage count for coupon ${coupon.id}`);
            const couponRef = businessRef.collection('coupons').doc(coupon.id);
            batch.update(couponRef, { timesUsed: FieldValue.increment(1) });
        }


        const newOrderRef = firestore.collection('orders').doc();
        const trackingToken = await generateSecureToken(firestore, validGuestId || normalizedPhone || newOrderRef.id);
        console.log(`[API /order/create] Creating final order document with ID ${newOrderRef.id}`);

        let dineInToken = null;

        // Generate token for street vendor
        if (isStreetVendorOrder) {
            console.log(`[API /order/create] Generating token for street vendor order.`);
            try {
                const lastToken = businessData.lastOrderToken || 0;
                const newTokenNumber = lastToken + 1;

                const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                const randomChar1 = alphabet[Math.floor(Math.random() * alphabet.length)];
                const randomChar2 = alphabet[Math.floor(Math.random() * alphabet.length)];

                dineInToken = `${String(newTokenNumber)}-${randomChar1}${randomChar2}`;

                batch.update(businessRef, { lastOrderToken: newTokenNumber });
                console.log(`[API /order/create] Generated Street Vendor Token: ${dineInToken}`);
            } catch (e) {
                console.error(`[API /order/create] Error generating street vendor token:`, e);
            }
        }

        // Generate or reuse token for dine-in
        if (deliveryType === 'dine-in' && dineInTabId) {
            console.log(`[API /order/create] Checking for existing token for dineInTabId: ${dineInTabId}`);
            console.log(`[API /order/create] RestaurantId: ${restaurantId}`);
            try {
                // Check if there's already an order with this dineInTabId
                const existingOrdersSnapshot = await firestore
                    .collection('orders')
                    .where('restaurantId', '==', restaurantId)
                    .where('dineInTabId', '==', dineInTabId)
                    .where('status', 'in', ACTIVE_DINE_IN_TOKEN_STATUSES)
                    .limit(1)
                    .get();

                console.log(`[API /order/create] Query found ${existingOrdersSnapshot.size} existing orders with this tabId`);

                if (!existingOrdersSnapshot.empty) {
                    // Reuse existing token
                    const existingOrder = existingOrdersSnapshot.docs[0].data();
                    dineInToken = existingOrder.dineInToken;
                    console.log(`[API /order/create] ✅ REUSING existing token: ${dineInToken} from order ${existingOrdersSnapshot.docs[0].id}`);
                } else {
                    // Generate new token for new tab
                    const lastToken = businessData.lastOrderToken || 0;
                    const newTokenNumber = lastToken + 1;
                    dineInToken = String(newTokenNumber);
                    batch.update(businessRef, { lastOrderToken: newTokenNumber });
                    console.log(`[API /order/create] ⚠️ NO existing orders found. Generated NEW token: ${dineInToken}`);
                }
            } catch (e) {
                console.error(`[API /order/create] ❌ ERROR in token reuse query:`, e);
                // Fallback: generate new token
                const lastToken = businessData.lastOrderToken || 0;
                const newTokenNumber = lastToken + 1;
                dineInToken = String(newTokenNumber);
                batch.update(businessRef, { lastOrderToken: newTokenNumber });
                console.log(`[API /order/create] Fallback - Generated new token: ${dineInToken}`);
            }
        } else if (deliveryType === 'dine-in' && !dineInTabId) {
            console.log(`[API /order/create] ⚠️ WARNING: Dine-in order but NO dineInTabId provided!`);
        }

        const finalOrderData = {
            customerName: name, customerId: userId, customerAddress: address?.full || null, customerPhone: normalizedPhone,
            customerLocation: customerLocation,
            restaurantId: restaurantId, restaurantName: businessData.name,
            businessType, deliveryType, pickupTime: pickupTime || '', tipAmount: tipAmount || 0,
            items: processedItems,
            dineInToken: dineInToken,
            tableId: tableId || null,  // Already normalized to uppercase
            dineInTabId: dineInTabId || null,
            pax_count: pax_count || null,
            tab_name: tab_name || null,
            ordered_by: ordered_by || 'customer',
            ordered_by_name: ordered_by_name || null,
            subtotal: subtotal || 0,
            coupon: coupon || null,
            loyaltyDiscount: loyaltyDiscount || 0,
            discount: finalDiscount || 0,
            cgst: cgst || 0,
            sgst: sgst || 0,
            deliveryCharge: deliveryCharge || 0,
            diningPreference: diningPreference || null,
            packagingCharge: packagingCharge || 0,
            totalAmount: grandTotal,
            status: 'pending', // Always start as pending
            orderDate: FieldValue.serverTimestamp(),
            notes: notes || null,
            paymentDetails: [{
                method: 'cod',
                amount: grandTotal,
                status: 'pending',
                timestamp: new Date()
            }],
            trackingToken: trackingToken,
        };

        batch.set(newOrderRef, finalOrderData);

        await batch.commit();
        console.log(`[API /order/create] Batch committed successfully. Order ${newOrderRef.id} created.`);
        // Mark idempotency key as completed
        await firestore.collection('idempotency_keys').doc(idempotencyKey).update({
            status: 'completed',
            orderId: newOrderRef.id,
            completedAt: FieldValue.serverTimestamp()
        });

        // CRITICAL: Activate the tab if it's a dine-in order with a tab
        if (deliveryType === 'dine-in' && dineInTabId) {
            try {
                const tabRef = firestore.collection('restaurants').doc(restaurantId).collection('dineInTabs').doc(dineInTabId);
                const tabSnap = await tabRef.get();

                if (tabSnap.exists && tabSnap.data().status !== 'active') {
                    await tabRef.update({
                        status: 'active',
                        firstOrderAt: FieldValue.serverTimestamp()
                    });
                    console.log(`[API /order/create] ✅ Tab ${dineInTabId} activated successfully`);
                }
            } catch (tabError) {
                console.error(`[API /order/create] Failed to activate tab:`, tabError);
                // Don't fail order if tab activation fails
            }
        }

        if (businessData && businessData.ownerPhone && businessData.botPhoneNumberId) {
            console.log(`[API /order/create] Sending new order notification to owner.`);
            await sendNewOrderToOwner({
                ownerPhone: businessData.ownerPhone, botPhoneNumberId: businessData.botPhoneNumberId,
                customerName: name, totalAmount: grandTotal, orderId: newOrderRef.id, restaurantName: businessData.name
            });
        }


        return NextResponse.json({
            message: 'Order created successfully.',
            order_id: newOrderRef.id,
            firestore_order_id: newOrderRef.id,
            token: trackingToken,
            dineInTabId: finalOrderData.dineInTabId || null,  // Actual tab ID used
            tableId: finalOrderData.tableId || null  // Actual table ID used
        }, { status: 200 });

    } catch (error) {
        console.error("CREATE ORDER API CRITICAL ERROR:", error);
        if (error.error && error.error.code === 'BAD_REQUEST_ERROR') {
            console.error("[API /order/create] Razorpay BAD_REQUEST_ERROR:", error.error.description);
            return NextResponse.json({ message: `Payment Gateway Error: ${error.error.description}` }, { status: 400 });
        }
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}

// --- HELPERS ---
function getBusinessCollection(businessType) {
    const map = {
        'restaurant': 'restaurants',
        'store': 'shops',
        'shop': 'shops',
        'street-vendor': 'street_vendors',
        'street_vendor': 'street_vendors',
    };
    return map[businessType] || 'restaurants';
}

const optimizeItemSnapshot = (item) => {
    if (!item) return item;
    const snapshot = {
        id: item.id,
        name: item.name,
        categoryId: item.categoryId || 'general',
        isVeg: !!item.isVeg,
        price: item.serverVerifiedPrice || item.price || 0,
        quantity: item.quantity || 1,
        selectedAddOns: item.selectedAddOns ? item.selectedAddOns.map(addon => ({
            name: addon.name,
            price: addon.price || 0,
            quantity: addon.quantity || 1
        })) : [],
        totalPrice: item.serverVerifiedTotal || item.totalPrice || 0,
        cartItemId: item.cartItemId || null,
        isAddon: !!item.isAddon,
        portion: item.portion ? {
            name: item.portion.name,
            price: item.portion.price || 0,
            isDefault: item.portion.isDefault === true
        } : null
    };

    const portionCount = Number(item.portionCount ?? (Array.isArray(item.portions) ? item.portions.length : 0));
    if (Number.isFinite(portionCount) && portionCount > 0) {
        snapshot.portionCount = portionCount;
    }

    return snapshot;
};
