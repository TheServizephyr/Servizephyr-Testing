
import { NextResponse } from 'next/server';
import { getFirestore, FieldValue, GeoPoint, verifyAndGetUid } from '@/lib/firebase-admin';
import { getOrCreateGuestProfile } from '@/lib/guest-utils';
import { calculateHaversineDistance, calculateDeliveryCharge } from '@/lib/distance';
import { findBusinessById } from '@/services/business/businessService';

function toFiniteNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function toNum(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function getBusinessLabel(businessType = 'restaurant') {
    if (businessType === 'store' || businessType === 'shop') return 'store';
    if (businessType === 'street-vendor') return 'stall';
    return 'restaurant';
}

const COORD_EPSILON = 0.00005;

function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
}

function toCoordinate(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function hasValidCoordinatePair(lat, lng) {
    return lat !== null && lng !== null;
}

function addressesMatch(existingAddress = {}, incomingAddress = {}) {
    const existingLat = toCoordinate(existingAddress.latitude);
    const existingLng = toCoordinate(existingAddress.longitude);
    const incomingLat = toCoordinate(incomingAddress.latitude);
    const incomingLng = toCoordinate(incomingAddress.longitude);

    const sameCoordinates =
        hasValidCoordinatePair(existingLat, existingLng) &&
        hasValidCoordinatePair(incomingLat, incomingLng) &&
        Math.abs(existingLat - incomingLat) <= COORD_EPSILON &&
        Math.abs(existingLng - incomingLng) <= COORD_EPSILON;

    if (sameCoordinates) return true;

    const sameFullAddress =
        normalizeText(existingAddress.full) &&
        normalizeText(existingAddress.full) === normalizeText(incomingAddress.full);
    const samePhone =
        normalizeText(existingAddress.phone) &&
        normalizeText(existingAddress.phone) === normalizeText(incomingAddress.phone);

    return sameFullAddress && samePhone;
}

function orderHasSameLocation(orderData = {}, incomingAddress = {}) {
    const orderLoc = orderData.customerLocation || {};
    const orderLat = toCoordinate(orderLoc._latitude ?? orderLoc.latitude ?? orderLoc.lat);
    const orderLng = toCoordinate(orderLoc._longitude ?? orderLoc.longitude ?? orderLoc.lng);
    const incomingLat = toCoordinate(incomingAddress.latitude);
    const incomingLng = toCoordinate(incomingAddress.longitude);

    return (
        hasValidCoordinatePair(orderLat, orderLng) &&
        hasValidCoordinatePair(incomingLat, incomingLng) &&
        Math.abs(orderLat - incomingLat) <= COORD_EPSILON &&
        Math.abs(orderLng - incomingLng) <= COORD_EPSILON
    );
}

function calculateGrandTotalFromOrder(orderData, deliveryChargeOverride) {
    const subtotal = toNum(orderData?.subtotal, 0);
    const cgst = toNum(orderData?.cgst, 0);
    const sgst = toNum(orderData?.sgst, 0);
    const packagingCharge = toNum(orderData?.packagingCharge, 0);
    const tipAmount = toNum(orderData?.tipAmount, 0);
    const platformFee = toNum(orderData?.platformFee, 0);
    const convenienceFee = toNum(orderData?.convenienceFee, 0);
    const serviceFee = toNum(orderData?.serviceFee, 0);
    const discount = toNum(orderData?.discount, 0);

    const total =
        subtotal +
        cgst +
        sgst +
        toNum(deliveryChargeOverride, 0) +
        packagingCharge +
        tipAmount +
        platformFee +
        convenienceFee +
        serviceFee -
        discount;

    return parseFloat(total.toFixed(2));
}

// Helper to get authenticated user UID or null if not logged in
async function getUserIdFromToken(req) {
    try {
        const uid = await verifyAndGetUid(req);
        return uid;
    } catch (error) {
        // Token is invalid, expired, or not present
        return null;
    }
}


// GET: Fetch all saved addresses for a user
export async function GET(req) {
    console.log("[API][user/addresses] GET request received.");
    try {
        const uid = await getUserIdFromToken(req);
        if (!uid) {
            return NextResponse.json({ message: 'User not authenticated.' }, { status: 401 });
        }

        const firestore = await getFirestore();
        const userRef = firestore.collection('users').doc(uid);
        const docSnap = await userRef.get();

        if (!docSnap.exists) {
            console.warn(`[API][user/addresses] User document not found for UID: ${uid}.`);
            return NextResponse.json({ addresses: [] }, { status: 200 });
        }

        console.log(`[API][user/addresses] User document found for UID: ${uid}.`);
        const userData = docSnap.data();
        const addresses = userData.addresses || [];

        console.log(`[API][user/addresses] Found ${addresses.length} addresses for user.`);
        return NextResponse.json({ addresses }, { status: 200 });
    } catch (error) {
        console.error("GET /api/user/addresses ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}


// POST: Add a new address to the user's profile
export async function POST(req) {
    console.log("[API][user/addresses] POST request received.");
    try {
        const { address, phone, ref, guestId: explicitGuestId, activeOrderId } = await req.json(); // Expect phone number from the client

        // Retrieve Guest ID from Cookie
        const cookieStore = require('next/headers').cookies();
        const sessionCookie = cookieStore.get('auth_guest_session');
        let guestId = sessionCookie?.value || explicitGuestId;

        // Also support de-obfuscation if ref is passed
        /* 
           Note: If we imported deobfuscateGuestId here, we could use ref directly. 
           For now, we rely on the secure httpOnly cookie set by verify-token.
        */

        if (!address || !address.id || !address.full || typeof address.latitude !== 'number' || typeof address.longitude !== 'number') {
            console.error("[API][user/addresses] POST validation failed: Invalid address data provided.", address);
            return NextResponse.json({ message: 'Invalid address data. A full address and location coordinates are required.' }, { status: 400 });
        }

        if (!phone) {
            return NextResponse.json({ message: 'A phone number is required to save an address for a session.' }, { status: 401 });
        }

        // CRITICAL: Use UID-first priority via getOrCreateGuestProfile
        const firestore = await getFirestore();
        const normalizedPhone = phone.slice(-10);

        // Get or create user profile (UID-first, then guest)
        const profileResult = await getOrCreateGuestProfile(firestore, normalizedPhone);
        const userId = profileResult.userId;

        console.log(`[API][user/addresses] Resolved userId: ${userId}, isGuest: ${profileResult.isGuest}`);

        // Determine target collection
        let targetRef;
        let currentName = profileResult.data?.name || '';
        const newName = address.name;

        if (profileResult.isGuest) {
            targetRef = firestore.collection('guest_profiles').doc(userId);
            console.log(`[API][user/addresses] Saving to guest profile: ${userId}`);
        } else {
            targetRef = firestore.collection('users').doc(userId);
            console.log(`[API][user/addresses] Saving to user UID: ${userId}`);
        }

        const currentProfileSnap = await targetRef.get();
        const currentProfileData = currentProfileSnap.exists ? (currentProfileSnap.data() || {}) : {};
        const existingAddresses = Array.isArray(currentProfileData.addresses) ? currentProfileData.addresses : [];
        const duplicateAddress = existingAddresses.find((savedAddress) => addressesMatch(savedAddress, address));
        const addressToPersist = duplicateAddress || address;

        currentName = currentProfileData.name || currentName;

        const updateData = {
            // Update phone on profile if missing
            phone: phone
        };

        if (!duplicateAddress) {
            updateData.addresses = FieldValue.arrayUnion(addressToPersist);
        }

        // ✅ SYNC NAME: If profile has no name or is "Guest", update it from address contact
        if ((!currentName || currentName === 'Guest') && newName) {
            console.log(`[API][user/addresses] Updating profile name from '${currentName}' to '${newName}'`);
            updateData.name = newName;
        }

        await targetRef.set(updateData, { merge: true });

        // OPTIONAL: If address is being submitted from a live order link, patch that order too.
        if (activeOrderId) {
            try {
                const orderRef = firestore.collection('orders').doc(activeOrderId);
                const orderSnap = await orderRef.get();
                if (orderSnap.exists) {
                    const orderData = orderSnap.data() || {};
                    const normalizedOrderPhone = String(orderData.customerPhone || '').replace(/\D/g, '').slice(-10);
                    const normalizedSessionPhone = String(normalizedPhone || '').replace(/\D/g, '').slice(-10);
                    const belongsToCustomer =
                        (orderData.customerId && orderData.customerId === userId) ||
                        (normalizedOrderPhone && normalizedOrderPhone === normalizedSessionPhone);

                    if (belongsToCustomer) {
                        const alreadyCapturedWithSameLocation =
                            orderData.customerAddressPending === false &&
                            orderHasSameLocation(orderData, addressToPersist);

                        if (alreadyCapturedWithSameLocation) {
                            console.log(`[API][user/addresses] Skipping duplicate order patch for ${activeOrderId} (same location already captured).`);
                        } else {
                            const statusEvents = [
                                {
                                    status: 'address_captured',
                                    timestamp: new Date()
                                }
                            ];

                            const patchData = {
                                customerAddress: addressToPersist.full,
                                customerLocation: new GeoPoint(addressToPersist.latitude, addressToPersist.longitude),
                                customerAddressPending: false,
                                addressCapturedAt: FieldValue.serverTimestamp()
                            };

                            // Recalculate delivery charge/range on server after address capture.
                            if (orderData.deliveryType === 'delivery') {
                                const business = await findBusinessById(firestore, orderData.restaurantId);
                                if (!business) {
                                    throw new Error('Business not found for delivery recalculation.');
                                }

                                const businessData = business.data || {};
                                const businessLabel = getBusinessLabel(business.type);
                                const deliveryConfigSnap = await business.ref.collection('delivery_settings').doc('config').get();
                                const deliveryConfig = deliveryConfigSnap.exists ? deliveryConfigSnap.data() : {};
                                const getSetting = (key, fallback) => deliveryConfig[key] ?? businessData[key] ?? fallback;

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

                                if (restaurantLat === null || restaurantLng === null) {
                                    throw new Error(`${businessLabel.charAt(0).toUpperCase() + businessLabel.slice(1)} coordinates are not configured.`);
                                }

                                const subtotalAmount = toNum(orderData.subtotal, 0);
                                let deliveryResult;

                                if (settings.deliveryEnabled === false) {
                                    deliveryResult = {
                                        allowed: false,
                                        charge: 0,
                                        aerialDistance: 0,
                                        roadDistance: 0,
                                        roadFactor: settings.roadDistanceFactor,
                                        message: `Delivery is currently disabled for this ${businessLabel}.`,
                                        reason: 'delivery-disabled'
                                    };
                                } else {
                                    const aerialDistance = calculateHaversineDistance(
                                        restaurantLat,
                                        restaurantLng,
                                        toNum(addressToPersist.latitude, 0),
                                        toNum(addressToPersist.longitude, 0)
                                    );
                                    deliveryResult = calculateDeliveryCharge(aerialDistance, subtotalAmount, settings);
                                }

                                const isManualCallOrder = Boolean(orderData.isManualCallOrder) || String(orderData.orderSource || '').toLowerCase() === 'manual_call';
                                const currentOrderCharge = toNum(orderData.deliveryCharge, toNum(orderData.billDetails?.deliveryCharge, 0));
                                const isOwnerLockedManualCharge =
                                    Boolean(orderData.ownerDeliveryChargeProvided) ||
                                    Boolean(orderData.deliveryChargeLocked) ||
                                    Boolean(orderData.manualDeliveryChargeLocked) ||
                                    toNum(orderData.manualDeliveryCharge, 0) > 0 ||
                                    (isManualCallOrder && currentOrderCharge > 0);
                                const lockedCharge = toNum(
                                    orderData.manualDeliveryCharge,
                                    toNum(orderData.billDetails?.deliveryCharge, toNum(orderData.deliveryCharge, 0))
                                );
                                const validatedCharge = toNum(deliveryResult.charge, 0);
                                const effectiveDeliveryCharge = isOwnerLockedManualCharge
                                    ? lockedCharge
                                    : validatedCharge;
                                const recalculatedGrandTotal = calculateGrandTotalFromOrder(orderData, effectiveDeliveryCharge);
                                console.log(
                                    `[API][user/addresses] Delivery charge resolution for order ${activeOrderId}:`,
                                    {
                                        isManualCallOrder,
                                        ownerDeliveryChargeProvided: Boolean(orderData.ownerDeliveryChargeProvided),
                                        deliveryChargeLocked: Boolean(orderData.deliveryChargeLocked),
                                        manualDeliveryChargeLocked: Boolean(orderData.manualDeliveryChargeLocked),
                                        currentOrderCharge,
                                        manualDeliveryCharge: toNum(orderData.manualDeliveryCharge, 0),
                                        validatedCharge,
                                        effectiveDeliveryCharge,
                                    }
                                );

                                patchData.deliveryCharge = effectiveDeliveryCharge;
                                patchData.totalAmount = recalculatedGrandTotal;
                                patchData.deliveryValidation = {
                                    success: true,
                                    ...deliveryResult,
                                    ownerLockedDeliveryCharge: isOwnerLockedManualCharge,
                                    checkedAt: new Date()
                                };
                                patchData.deliveryValidationMessage = deliveryResult.message || null;
                                patchData.deliveryOutOfRange = !deliveryResult.allowed;
                                patchData.billDetails = {
                                    ...(orderData.billDetails || {}),
                                    subtotal: toNum(orderData.subtotal, toNum(orderData.billDetails?.subtotal, 0)),
                                    cgst: toNum(orderData.cgst, toNum(orderData.billDetails?.cgst, 0)),
                                    sgst: toNum(orderData.sgst, toNum(orderData.billDetails?.sgst, 0)),
                                    deliveryCharge: effectiveDeliveryCharge,
                                    grandTotal: recalculatedGrandTotal
                                };
                                if (isOwnerLockedManualCharge) {
                                    patchData.ownerDeliveryChargeProvided = true;
                                    patchData.deliveryChargeLocked = true;
                                    patchData.manualDeliveryChargeLocked = true;
                                    patchData.manualDeliveryCharge = effectiveDeliveryCharge;
                                }

                                if (!deliveryResult.allowed) {
                                    patchData.deliveryBlocked = true;
                                    patchData.deliveryBlockedReason = deliveryResult.message || 'Address is outside delivery range.';
                                    patchData.deliveryBlockedAt = FieldValue.serverTimestamp();
                                    statusEvents.push({
                                        status: 'delivery_blocked',
                                        timestamp: new Date(),
                                        message: patchData.deliveryBlockedReason
                                    });
                                } else {
                                    patchData.deliveryBlocked = false;
                                    patchData.deliveryBlockedReason = null;
                                    patchData.deliveryBlockedAt = null;
                                    patchData.deliveryValidatedAt = FieldValue.serverTimestamp();
                                    statusEvents.push({
                                        status: 'delivery_validated',
                                        timestamp: new Date(),
                                        message: isOwnerLockedManualCharge
                                            ? `Address updated. Owner locked delivery charge retained at ₹${effectiveDeliveryCharge}`
                                            : (deliveryResult.reason || `Delivery charge set to ₹${effectiveDeliveryCharge}`)
                                    });
                                }
                            }

                            patchData.statusHistory = FieldValue.arrayUnion(...statusEvents);
                            await orderRef.set(patchData, { merge: true });
                            console.log(`[API][user/addresses] Linked active order ${activeOrderId} updated with customer location.`);
                        }
                    } else {
                        console.warn(`[API][user/addresses] Skipping active order update due to ownership mismatch for ${activeOrderId}.`);
                    }
                }
            } catch (orderPatchErr) {
                console.error('[API][user/addresses] Failed to patch active order with new address:', orderPatchErr);
                // Non-fatal: address save should still succeed.
            }
        }

        const responseMessage = duplicateAddress
            ? 'Address already exists. Existing saved location was reused.'
            : 'Address added successfully!';
        console.log(`[API][user/addresses] ${responseMessage} Document: ${targetRef.path}.`);
        return NextResponse.json({
            message: responseMessage,
            address: addressToPersist,
            duplicateAddressSkipped: !!duplicateAddress
        }, { status: 200 });

    } catch (error) {
        console.error(`[API][user/addresses] POST /api/user/addresses ERROR:`, error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}


// DELETE: Remove an address from the user's profile
export async function DELETE(req) {
    console.log("[API][user/addresses] DELETE request received.");
    try {
        const firestore = await getFirestore();
        const { addressId, phone } = await req.json();

        if (!addressId) {
            console.error("[API][user/addresses] DELETE validation failed: Address ID is required.");
            return NextResponse.json({ message: 'Address ID is required.' }, { status: 400 });
        }

        let targetRef;

        // Scenario 1: Request is from a WhatsApp user, identified by phone number
        if (phone) {
            const normalizedPhone = phone.slice(-10);
            console.log(`[API][user/addresses] DELETE request for phone number: ${normalizedPhone}`);

            // CRITICAL: Use UID-first priority
            const profileResult = await getOrCreateGuestProfile(firestore, normalizedPhone);
            const userId = profileResult.userId;

            if (profileResult.isGuest) {
                targetRef = firestore.collection('guest_profiles').doc(userId);
                console.log(`[API][user/addresses] Deleting from guest profile: ${userId}`);
            } else {
                targetRef = firestore.collection('users').doc(userId);
                console.log(`[API][user/addresses] Deleting from user UID: ${userId}`);
            }
        }
        // Scenario 2: Request is from a logged-in user, identified by ID token
        else {
            const uid = await getUserIdFromToken(req);
            if (!uid) {
                return NextResponse.json({ message: 'User not authenticated.' }, { status: 401 });
            }
            console.log(`[API][user/addresses] DELETE request for UID: ${uid}`);
            targetRef = firestore.collection('users').doc(uid);
        }

        const docSnap = await targetRef.get();
        if (!docSnap.exists) {
            console.warn(`[API][user/addresses] DELETE failed: User document not found at path: ${targetRef.path}.`);
            return NextResponse.json({ message: 'User profile not found.' }, { status: 404 });
        }

        const userData = docSnap.data();
        const currentAddresses = userData.addresses || [];

        const addressExists = currentAddresses.some(addr => addr.id === addressId);
        if (!addressExists) {
            console.warn(`[API][user/addresses] DELETE failed: Address ID ${addressId} not found in profile for document: ${targetRef.path}.`);
            return NextResponse.json({ message: 'Address not found in user profile.' }, { status: 404 });
        }

        const updatedAddresses = currentAddresses.filter(addr => addr.id !== addressId);

        console.log(`[API][user/addresses] Attempting to remove address ID ${addressId} for document ${targetRef.path}.`);
        await targetRef.update({
            addresses: updatedAddresses
        });

        console.log(`[API][user/addresses] Address ID ${addressId} removed successfully for document ${targetRef.path}.`);
        return NextResponse.json({ message: 'Address removed successfully!' }, { status: 200 });

    } catch (error) {
        console.error("DELETE /api/user/addresses ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}
