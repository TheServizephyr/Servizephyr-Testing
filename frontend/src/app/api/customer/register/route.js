

import { getFirestore, FieldValue, GeoPoint } from '@/lib/firebase-admin';
import { NextResponse } from 'next/server';
import Razorpay from 'razorpay';
import { nanoid } from 'nanoid';
import { sendNewOrderToOwner } from '@/lib/notifications';
import { getEffectiveBusinessOpenStatus } from '@/lib/businessSchedule';


const generateSecureToken = async (firestore, customerPhone) => {
    console.log(`[API /customer/register] generateSecureToken for phone: ${customerPhone}`);
    const token = nanoid(24);
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24-hour validity for tracking link
    const authTokenRef = firestore.collection('auth_tokens').doc(token);
    await authTokenRef.set({
        phone: customerPhone,
        expiresAt: expiry,
        type: 'tracking'
    });
    console.log(`[API /customer/register] Token generated: ${token}`);
    return token;
};

const normalizeBusinessType = (value) => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'street_vendor') return 'street-vendor';
    if (normalized === 'shop' || normalized === 'store') return 'store';
    if (normalized === 'restaurant' || normalized === 'street-vendor') {
        return normalized;
    }
    return null;
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


export async function POST(req) {
    console.log("[API /customer/register] POST request received.");
    try {
        const firestore = await getFirestore();
        const body = await req.json();
        console.log("[API /customer/register] Request body parsed:", JSON.stringify(body, null, 2));

        const { 
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
            dineInTabId 
        } = body;

        // --- VALIDATION ---
        const isStreetVendorOrder = deliveryType === 'street-vendor-pre-order';
        console.log(`[API /customer/register] Is Street Vendor Order? ${isStreetVendorOrder}`);

        if (!isStreetVendorOrder && deliveryType !== 'dine-in' && !name) {
            console.error("[API /customer/register] Validation Error: Name is required for non-street-vendor/dine-in orders.");
            return NextResponse.json({ message: 'Name is required.' }, { status: 400 });
        }
        if (!restaurantId || !items || grandTotal === undefined || subtotal === undefined) {
             const missingFields = `Missing fields: restaurantId=${!!restaurantId}, items=${!!items}, grandTotal=${grandTotal !== undefined}, subtotal=${subtotal !== undefined}`;
             console.error(`[API /customer/register] Validation Error: Missing required fields. Details: ${missingFields}`);
             return NextResponse.json({ message: `Missing required fields for order creation. Details: ${missingFields}` }, { status: 400 });
        }
        if (deliveryType === 'delivery' && (!address || !address.full)) {
            console.error("[API /customer/register] Validation Error: Full, structured address required for delivery.");
            return NextResponse.json({ message: 'A full, structured address is required for delivery orders.' }, { status: 400 });
        }
        
        const normalizedPhone = phone ? (phone.length > 10 ? phone.slice(-10) : phone) : null;
        if (normalizedPhone && !/^\d{10}$/.test(normalizedPhone)) {
            console.error(`[API /customer/register] Validation Error: Invalid phone number format: ${normalizedPhone}`);
            return NextResponse.json({ message: 'Invalid phone number format. Must be 10 digits.' }, { status: 400 });
        }
        
        let businessRef;
        let collectionName;
        
        const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];
        for (const name of collectionsToTry) {
            const docRef = firestore.collection(name).doc(restaurantId);
            const docSnap = await docRef.get();
            if (docSnap.exists) {
                businessRef = docRef;
                collectionName = name;
                console.log(`[API /customer/register] Found business in collection: ${collectionName}`);
                break; 
            }
        }
        
        if (!businessRef) {
            console.error(`[API /customer/register] Business not found with ID: ${restaurantId}`);
            return NextResponse.json({ message: 'This business does not exist.' }, { status: 404 });
        }
        
        const businessDoc = await businessRef.get();
        const businessData = businessDoc.data();
        const resolvedBusinessType =
            normalizeBusinessType(businessData?.businessType) ||
            getBusinessTypeFromCollectionName(collectionName);
        const businessLabel = getBusinessLabel(resolvedBusinessType);
        if (!getEffectiveBusinessOpenStatus(businessData)) {
            return NextResponse.json({
                message: `${businessLabel.charAt(0).toUpperCase() + businessLabel.slice(1)} is currently closed. Please order during opening hours.`
            }, { status: 403 });
        }

        // --- Post-paid Dine-In ---
        if (deliveryType === 'dine-in' && businessData.dineInModel === 'post-paid') {
            console.log("[API /customer/register] Handling post-paid dine-in order.");
            const newOrderRef = firestore.collection('orders').doc();
            const trackingToken = await generateSecureToken(firestore, `dine-in-${newOrderRef.id}`);

            await newOrderRef.set({
                restaurantId, businessType, tableId,
                items: items, notes: notes || null,
                subtotal, cgst, sgst, totalAmount: grandTotal,
                deliveryType,
                pax_count: pax_count, tab_name: tab_name,
                status: 'pending', 
                dineInTabId: dineInTabId || null,
                orderDate: FieldValue.serverTimestamp(),
                trackingToken: trackingToken,
            });
            
            console.log(`[API /customer/register] Post-paid dine-in order created with ID: ${newOrderRef.id}`);
            return NextResponse.json({ 
                message: "Order placed. Awaiting WhatsApp confirmation.",
                order_id: newOrderRef.id,
                whatsappNumber: businessData.botDisplayNumber || businessData.ownerPhone,
                token: trackingToken
            }, { status: 200 });
        }
        
        // --- Pre-paid Dine-In ---
        if (deliveryType === 'dine-in') {
            console.log("[API /customer/register] Handling pre-paid dine-in order.");
            const firestoreOrderId = firestore.collection('orders').doc().id;

             const servizephyrOrderPayload = {
                order_id: firestoreOrderId,
                user_id: `dine-in|${dineInTabId}`,
                restaurant_id: restaurantId,
                business_type: businessType,
                customer_details: JSON.stringify({ name: tab_name, address: { full: `Table ${tableId}`}, phone: `dine-in-${tableId}` }),
                items: JSON.stringify(items),
                bill_details: JSON.stringify({ subtotal, coupon, loyaltyDiscount, grandTotal, deliveryType, tipAmount: 0, pickupTime: '', cgst, sgst, deliveryCharge: 0, tableId, dineInTabId, pax_count, tab_name }),
                notes: notes || null
            };
            console.log("[API /customer/register] Generated servizephyr_payload for dine-in:", JSON.stringify(servizephyrOrderPayload, null, 2));

            if (paymentMethod === 'razorpay') {
                console.log("[API /customer/register] Dine-in payment method is Razorpay.");
                if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
                    console.error("[API /customer/register] Razorpay credentials not configured.");
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
                console.log(`[API /customer/register] Razorpay order created for dine-in: ${razorpayOrder.id}`);
                return NextResponse.json({ 
                    message: 'Razorpay order created for dine-in.',
                    razorpay_order_id: razorpayOrder.id,
                    firestore_order_id: firestoreOrderId,
                    dine_in_tab_id: dineInTabId
                }, { status: 200 });
            } else { // Pay at Counter for dine-in
                 console.log("[API /customer/register] Dine-in payment method is 'Pay at Counter'.");
                const newOrderRef = firestore.collection('orders').doc(firestoreOrderId);
                const trackingToken = await generateSecureToken(firestore, `dine-in-${firestoreOrderId}`);
                const batch = firestore.batch();
                
                batch.set(newOrderRef, {
                    customerName: tab_name, customerId: `dine-in|${dineInTabId}`, customerAddress: `Table ${tableId}`,
                    restaurantId, businessType, deliveryType, tableId, dineInTabId, items,
                    subtotal, coupon, loyaltyDiscount, discount: coupon?.discount || 0, cgst, sgst,
                    totalAmount: grandTotal, status: 'pending', orderDate: FieldValue.serverTimestamp(),
                    notes: notes || null, paymentDetails: { method: paymentMethod },
                    trackingToken: trackingToken
                });
                
                await batch.commit();
                 console.log(`[API /customer/register] Dine-in 'Pay at Counter' order created: ${newOrderRef.id}`);
                return NextResponse.json({
                    message: 'Order added to tab successfully.',
                    firestore_order_id: newOrderRef.id,
                    dine_in_tab_id: dineInTabId,
                    token: trackingToken,
                }, { status: 200 });
            }
        }
        
        // --- Regular Delivery/Pickup/StreetVendor Flow ---
        console.log("[API /customer/register] Handling regular delivery/pickup/street-vendor flow.");
        let userId = normalizedPhone || `anon_${nanoid(10)}`;
        let isNewUser = true;

        if (normalizedPhone) {
            console.log(`[API /customer/register] Normalized phone exists: ${normalizedPhone}. Checking for existing user.`);
            const usersRef = firestore.collection('users');
            const existingUserQuery = await usersRef.where('phone', '==', normalizedPhone).limit(1).get();
            if (!existingUserQuery.empty) {
                isNewUser = false;
                userId = existingUserQuery.docs[0].id;
                console.log(`[API /customer/register] Existing user found. UID: ${userId}, Is New User: ${isNewUser}`);
            } else {
                 console.log(`[API /customer/register] No existing user found for phone. Is New User: ${isNewUser}`);
            }
        }
        
        const customerLocation = (deliveryType === 'delivery' && address && typeof address.latitude === 'number' && typeof address.longitude === 'number')
            ? new GeoPoint(address.latitude, address.longitude)
            : null;
        console.log(`[API /customer/register] Customer location set: ${!!customerLocation}`);

        if (paymentMethod === 'razorpay') {
             console.log("[API /customer/register] Payment method is Razorpay.");
            if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
                console.error("[API /customer/register] Razorpay credentials not configured.");
                return NextResponse.json({ message: 'Payment gateway is not configured on the server.' }, { status: 500 });
            }

            const razorpay = new Razorpay({
                key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
                key_secret: process.env.RAZORPAY_KEY_SECRET,
            });
            
            const firestoreOrderId = firestore.collection('orders').doc().id;
            console.log(`[API /customer/register] Generated Firestore Order ID: ${firestoreOrderId}`);

            const customerDetailsForPayload = {
                name,
                address: address || { full: "Street Vendor Pre-Order" },
                phone: normalizedPhone || ''
            };

            const servizephyrOrderPayload = {
                order_id: firestoreOrderId,
                user_id: userId,
                restaurant_id: restaurantId,
                business_type: businessType,
                customer_details: JSON.stringify(customerDetailsForPayload),
                items: JSON.stringify(items),
                bill_details: JSON.stringify({ 
                    subtotal: subtotal || 0,
                    coupon: coupon || null,
                    loyaltyDiscount: loyaltyDiscount || 0,
                    grandTotal: grandTotal || 0,
                    deliveryType,
                    tipAmount: tipAmount || 0,
                    pickupTime: pickupTime || '',
                    cgst: cgst || 0,
                    sgst: sgst || 0,
                    deliveryCharge: deliveryCharge || 0
                }),
                notes: notes || null
            };
            
            const razorpayOrderOptions = {
                amount: Math.round(grandTotal * 100), 
                currency: 'INR',
                receipt: firestoreOrderId,
                notes: {
                    servizephyr_payload: JSON.stringify(servizephyrOrderPayload),
                    split_session_id: isStreetVendorOrder ? `split_${firestoreOrderId}` : undefined
                }
            };
            console.log("[API /customer/register] Razorpay Order Options:", JSON.stringify(razorpayOrderOptions, null, 2));
            
            const razorpayOrder = await razorpay.orders.create(razorpayOrderOptions);
             console.log(`[API /customer/register] Razorpay order created: ${razorpayOrder.id}`);
            
            const trackingToken = await generateSecureToken(firestore, normalizedPhone || firestoreOrderId);
            return NextResponse.json({ 
                message: 'Razorpay order created. Awaiting payment confirmation.',
                razorpay_order_id: razorpayOrder.id,
                firestore_order_id: firestoreOrderId,
                token: trackingToken,
            }, { status: 200 });
        }


        // --- START FIX: Logic for "Pay at Counter" for Street Vendor ---
        console.log("[API /customer/register] Handling 'Pay at Counter' flow.");
        const batch = firestore.batch();
        
        if (isNewUser && normalizedPhone && !isStreetVendorOrder) {
            console.log(`[API /customer/register] New user detected (${normalizedPhone}), creating unclaimed profile.`);
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
        const finalDiscount = couponDiscountAmount + finalLoyaltyDiscount;
        
        const pointsEarned = Math.floor(subtotal / 100) * 10;
        const pointsSpent = finalLoyaltyDiscount > 0 ? finalLoyaltyDiscount / 0.5 : 0;
        
        if (normalizedPhone && !isStreetVendorOrder) {
            console.log(`[API /customer/register] Updating customer stats for ${normalizedPhone} at business ${restaurantId}`);
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
             console.log(`[API /customer/register] Incrementing usage count for coupon ${coupon.id}`);
            const couponRef = businessRef.collection('coupons').doc(coupon.id);
            batch.update(couponRef, { timesUsed: FieldValue.increment(1) });
        }
        
        const newOrderRef = firestore.collection('orders').doc();
        const trackingToken = await generateSecureToken(firestore, normalizedPhone || newOrderRef.id);
        console.log(`[API /customer/register] Creating final order document with ID ${newOrderRef.id}`);

        let dineInToken = null;
        if (isStreetVendorOrder) {
            console.log(`[API /customer/register] Generating token for street vendor order.`);
            const vendorRef = firestore.collection('street_vendors').doc(restaurantId);
            try {
                const vendorDoc = await vendorRef.get(); // Not in transaction, as it's a read before write
                if (vendorDoc.exists) {
                    const vendorData = vendorDoc.data();
                    const lastToken = vendorData.lastOrderToken || 0;
                    const newTokenNumber = lastToken + 1;
                    
                    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                    const randomChar1 = alphabet[Math.floor(Math.random() * alphabet.length)];
                    const randomChar2 = alphabet[Math.floor(Math.random() * alphabet.length)];
                    
                    dineInToken = `${String(newTokenNumber).padStart(4, '0')}-${randomChar1}${randomChar2}`;
                    
                    batch.update(vendorRef, { lastOrderToken: newTokenNumber });
                    console.log(`[API /customer/register] Generated Street Vendor Token: ${dineInToken}`);
                } else {
                    console.warn(`[API /customer/register] Street vendor document ${restaurantId} not found, cannot generate token.`);
                }
            } catch (e) {
                console.error(`[API /customer/register] Error fetching street vendor doc to generate token:`, e);
            }
        }
        
        const finalOrderData = {
            customerName: name, customerId: userId, customerAddress: address?.full || null, customerPhone: normalizedPhone,
            customerLocation: customerLocation,
            restaurantId: restaurantId, restaurantName: businessData.name,
            businessType, deliveryType, pickupTime: pickupTime || '', tipAmount: tipAmount || 0,
            items: items,
            dineInToken, // <-- ADDED TOKEN HERE
            subtotal: subtotal || 0,
            coupon: coupon || null,
            loyaltyDiscount: loyaltyDiscount || 0,
            discount: finalDiscount || 0,
            cgst: cgst || 0,
            sgst: sgst || 0,
            deliveryCharge: deliveryCharge || 0,
            totalAmount: grandTotal,
            status: 'pending', // Always start as pending
            orderDate: FieldValue.serverTimestamp(),
            notes: notes || null,
            trackingToken: trackingToken,
            paymentDetails: { method: paymentMethod }
        };
        
        batch.set(newOrderRef, finalOrderData);
        
        await batch.commit();
        console.log(`[API /customer/register] Batch committed successfully. Order ${newOrderRef.id} created.`);

        if (businessData.ownerPhone && businessData.botPhoneNumberId) {
            console.log(`[API /customer/register] Sending new order notification to owner.`);
            await sendNewOrderToOwner({
                ownerPhone: businessData.ownerPhone, botPhoneNumberId: businessData.botPhoneNumberId,
                customerName: name, totalAmount: grandTotal, orderId: newOrderRef.id, restaurantName: businessData.name
            });
        }
        
        return NextResponse.json({ 
            message: 'Order created successfully.',
            firestore_order_id: newOrderRef.id,
            token: trackingToken
        }, { status: 200 });
        // --- END FIX ---

    } catch (error) {
        console.error("CREATE ORDER API CRITICAL ERROR:", error);
        if(error.error && error.error.code === 'BAD_REQUEST_ERROR') {
             console.error("[API /customer/register] Razorpay BAD_REQUEST_ERROR:", error.error.description);
             return NextResponse.json({ message: `Payment Gateway Error: ${error.error.description}` }, { status: 400 });
        }
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
