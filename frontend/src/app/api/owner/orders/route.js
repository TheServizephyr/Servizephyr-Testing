

import { NextResponse } from 'next/server';
import { getAuth, getFirestore, getDatabase, FieldValue, verifyAndGetUid } from '@/lib/firebase-admin';
import { sendOrderStatusUpdateToCustomer, sendRestaurantStatusChangeNotification } from '@/lib/notifications';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';
import { PERMISSIONS, hasPermission } from '@/lib/permissions';
import { sendSystemMessage } from '@/lib/whatsapp';
import { sanitizeUpiId, sendManualPaymentRequestToCustomer } from '@/lib/manual-upi-payment';
import Razorpay from 'razorpay';
import { trackEndpointRead } from '@/lib/readTelemetry';
import { trackApiTelemetry } from '@/lib/opsTelemetry';


// (Redundant verifyOwnerAndGetBusiness removed in favor of verifyOwnerWithAudit)

const OWNER_LIKE_ROLES = new Set(['owner', 'restaurant-owner', 'shop-owner', 'street-vendor']);

function callerHasPermission(callerRole, callerPermissions, permission) {
    if (!permission) return false;
    if (OWNER_LIKE_ROLES.has(callerRole)) return true;
    if (Array.isArray(callerPermissions) && callerPermissions.includes(permission)) return true;
    return hasPermission(callerRole, permission);
}

const VALID_STATUSES = new Set([
    'pending',
    'confirmed',
    'preparing',
    'prepared',
    'ready_for_pickup',
    'dispatched',
    'reached_restaurant',
    'picked_up',
    'on_the_way',
    'delivery_attempted',
    'failed_delivery',
    'returned_to_restaurant',
    'delivered',
    'rejected',
    'ready',
    'Ready',
]);

function getAllowedNextStatuses(orderData = {}) {
    const isPickup = orderData.deliveryType === 'pickup';
    const isDelivery = orderData.deliveryType === 'delivery';
    const isDineIn = orderData.deliveryType === 'dine-in'
        || orderData.diningPreference === 'dine-in'
        || !!orderData.tableId
        || !!orderData.dineInTabId
        || !!orderData.tabId;

    if (isPickup) {
        return {
            pending: new Set(['confirmed', 'rejected']),
            confirmed: new Set(['preparing']),
            preparing: new Set(['ready_for_pickup']),
            ready_for_pickup: new Set(['picked_up']),
        };
    }

    if (isDineIn) {
        return {
            pending: new Set(['confirmed', 'rejected']),
            confirmed: new Set(['preparing']),
            preparing: new Set(['ready', 'ready_for_pickup']),
            ready: new Set(['delivered']),
            ready_for_pickup: new Set(['delivered']),
        };
    }

    if (isDelivery) {
        return {
            pending: new Set(['confirmed', 'rejected']),
            confirmed: new Set(['preparing']),
            preparing: new Set(['prepared']),
            prepared: new Set(['ready_for_pickup']),
            ready_for_pickup: new Set(['dispatched']),
            dispatched: new Set(['delivered']),
        };
    }

    // Dine-in / other internal flows remain backward-compatible.
    return {
        pending: new Set(['confirmed', 'rejected']),
        confirmed: new Set(['preparing']),
        preparing: new Set(['ready', 'ready_for_pickup']),
        ready: new Set(['delivered']),
        ready_for_pickup: new Set(['delivered']),
    };
}

function canTransition(orderData, fromStatus, toStatus) {
    if (fromStatus === toStatus) return true;
    if (toStatus === 'rejected') return fromStatus === 'pending';
    // Do not allow reopening finalized orders through status rollback.
    if (['delivered', 'rejected', 'picked_up', 'cancelled'].includes(fromStatus)) return false;

    const allowedNextStatuses = getAllowedNextStatuses(orderData);
    if (allowedNextStatuses[fromStatus]?.has(toStatus)) return true;

    // Allow controlled one-step rollback for dashboard "Revert" action.
    // Example: preparing -> confirmed, prepared -> preparing, dispatched -> ready_for_pickup.
    const previousStatuses = Object.entries(allowedNextStatuses)
        .filter(([, nextSet]) => nextSet?.has(fromStatus))
        .map(([status]) => status);

    return previousStatuses.includes(toStatus);
}

function hasValidGeoLocation(location) {
    if (!location || typeof location !== 'object') return false;

    const latCandidate = location._latitude ?? location.latitude ?? location.lat;
    const lngCandidate = location._longitude ?? location.longitude ?? location.lng;

    const lat = Number(latCandidate);
    const lng = Number(lngCandidate);

    return Number.isFinite(lat) && Number.isFinite(lng);
}

function normalizeIndianPhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return null;
    return digits.length >= 10 ? digits.slice(-10) : digits;
}

function parseMaybeJson(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    if (typeof value !== 'string') return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function resolveCustomerPhoneForNotification(orderData = {}) {
    const directCandidates = [
        orderData.customerPhone,
        orderData.phone,
        orderData.customer?.phone,
        orderData.customerDetails?.phone
    ];

    for (const candidate of directCandidates) {
        const normalized = normalizeIndianPhone(candidate);
        if (normalized && normalized.length >= 10) return normalized;
    }

    const legacyCustomerDetails = parseMaybeJson(orderData.customer_details) || parseMaybeJson(orderData.customerDetails);
    if (legacyCustomerDetails) {
        const normalizedLegacy = normalizeIndianPhone(legacyCustomerDetails.phone);
        if (normalizedLegacy && normalizedLegacy.length >= 10) return normalizedLegacy;
    }

    return null;
}

function resolveCustomerNameForNotification(orderData = {}) {
    const directCandidates = [
        orderData.customerName,
        orderData.name,
        orderData.customer?.name,
        orderData.customerDetails?.name
    ];

    for (const candidate of directCandidates) {
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }

    const legacyCustomerDetails = parseMaybeJson(orderData.customer_details) || parseMaybeJson(orderData.customerDetails);
    if (legacyCustomerDetails?.name && String(legacyCustomerDetails.name).trim()) {
        return String(legacyCustomerDetails.name).trim();
    }

    return 'Customer';
}

async function resolveRiderForNotification(firestore, collectionName, businessId, riderId) {
    if (!riderId) return null;

    try {
        const primaryDoc = await firestore.collection('drivers').doc(riderId).get();
        if (primaryDoc.exists) {
            const data = primaryDoc.data() || {};
            return {
                name: data.displayName || data.name || 'Delivery Partner',
                phone: normalizeIndianPhone(data.phone)
            };
        }
    } catch (err) {
        console.warn(`[Rider Resolve] Failed to read drivers/${riderId}:`, err?.message || err);
    }

    try {
        const subDoc = await firestore
            .collection(collectionName)
            .doc(businessId)
            .collection('deliveryBoys')
            .doc(riderId)
            .get();
        if (subDoc.exists) {
            const data = subDoc.data() || {};
            return {
                name: data.displayName || data.name || 'Delivery Partner',
                phone: normalizeIndianPhone(data.phone)
            };
        }
    } catch (err) {
        console.warn(`[Rider Resolve] Failed to read ${collectionName}/${businessId}/deliveryBoys/${riderId}:`, err?.message || err);
    }

    return null;
}

function redactOrderForViewer(orderData = {}, canViewCustomerDetails = true, canViewPaymentDetails = true) {
    const redacted = { ...orderData };

    if (!canViewCustomerDetails) {
        delete redacted.customerName;
        delete redacted.customerPhone;
        delete redacted.customerAddress;
        delete redacted.customerId;
        delete redacted.userId;
        delete redacted.customer;
    }

    if (!canViewPaymentDetails) {
        delete redacted.paymentDetails;
        delete redacted.paymentMethod;
        delete redacted.paymentStatus;
        delete redacted.paymentRequestSentAt;
        delete redacted.paymentRequestSentBy;
        delete redacted.paymentRequestSentByRole;
        delete redacted.paymentRequestStatus;
        delete redacted.paymentRequestLink;
        delete redacted.paymentRequestImage;
        delete redacted.paymentRequestAmount;
        delete redacted.paymentRequestCount;
        delete redacted.paymentConfirmedVia;
        delete redacted.paymentConfirmedBy;
        delete redacted.paymentConfirmedAt;
        delete redacted.subtotal;
        delete redacted.cgst;
        delete redacted.sgst;
        delete redacted.deliveryCharge;
        delete redacted.discount;
        delete redacted.totalAmount;
        delete redacted.amount;
    }

    return redacted;
}


export async function GET(req) {
    const telemetryStartedAt = Date.now();
    let telemetryStatus = 200;
    let telemetryError = null;
    const respond = (payload, status = 200) => {
        telemetryStatus = status;
        return NextResponse.json(payload, { status });
    };

    try {
        const auth = await getAuth();
        const firestore = await getFirestore();

        const { searchParams } = new URL(req.url);
        const orderId = searchParams.get('id');
        const customerId = searchParams.get('customerId');

        const { uid, businessId, businessSnap, collectionName, callerRole, callerPermissions } = await verifyOwnerWithAudit(
            req,
            orderId ? 'view_order_details' : 'view_orders',
            orderId ? { orderId, customerId } : { customerId }
        );

        if (!callerHasPermission(callerRole, callerPermissions, PERMISSIONS.VIEW_ORDERS)) {
            return respond({ message: 'Access Denied: You cannot view orders.' }, 403);
        }

        if (orderId) {
            const orderRef = firestore.collection('orders').doc(orderId);
            const orderDoc = await orderRef.get();

            if (!orderDoc.exists) {
                return respond({ message: 'Order not found.' }, 404);
            }

            let orderData = orderDoc.data();
            if (orderData.restaurantId !== businessId) {
                return respond({ message: 'Access denied to this order.' }, 403);
            }

            if (orderData.orderDate && typeof orderData.orderDate.toDate === 'function') {
                orderData = { ...orderData, orderDate: orderData.orderDate.toDate().toISOString() };
            }

            const businessData = businessSnap.data();
            const canViewCustomerDetails = callerHasPermission(callerRole, callerPermissions, PERMISSIONS.VIEW_CUSTOMERS);
            const canViewPaymentDetails = callerHasPermission(callerRole, callerPermissions, PERMISSIONS.VIEW_PAYMENTS);

            const redactedOrderData = redactOrderForViewer(orderData, canViewCustomerDetails, canViewPaymentDetails);

            // If customerId is provided, fetch customer details as well
            let customerData = null;
            if (customerId && canViewCustomerDetails) {
                const businessCollectionName =
                    (businessData.businessType === 'shop' || businessData.businessType === 'store')
                        ? 'shops'
                        : (businessData.businessType === 'street-vendor' ? 'street_vendors' : 'restaurants');
                const customerRef = firestore.collection(businessCollectionName).doc(businessId).collection('customers').doc(customerId);
                const customerSnap = await customerRef.get();
                if (customerSnap.exists) {
                    customerData = customerSnap.data();
                }
            }
            await trackEndpointRead('api.owner.orders.get', 2 + (customerData ? 1 : 0));


            return respond({
                order: redactedOrderData,
                restaurant: businessData,
                customer: customerData,
                canViewCustomerDetails,
                canViewPaymentDetails,
            }, 200);
        }

        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');
        const canViewCustomerDetails = callerHasPermission(callerRole, callerPermissions, PERMISSIONS.VIEW_CUSTOMERS);
        const canViewPaymentDetails = callerHasPermission(callerRole, callerPermissions, PERMISSIONS.VIEW_PAYMENTS);

        const ordersRef = firestore.collection('orders');
        // Exclude orders with status 'awaiting_payment' (payment not completed yet)
        let query = ordersRef
        if (customerId) {
            console.log(`[API] Fetching orders for customerId: ${customerId} (restaurantId: ${businessId})`);

            // ✅ FIXED: Using indexed query with .orderBy and .limit
            const customerQuery = ordersRef
                .where('restaurantId', '==', businessId)
                .where('customerId', '==', customerId)
                .orderBy('orderDate', 'desc')
                .limit(20);

            let snap = await customerQuery.get();

            // Fallback: If no orders found, try querying by 'userId' (common legacy field name)
            if (snap.empty) {
                console.log(`[API] No orders found with customerId, trying userId...`);
                const userIdQuery = ordersRef
                    .where('restaurantId', '==', businessId)
                    .where('userId', '==', customerId)
                    .orderBy('orderDate', 'desc')
                    .limit(20);
                snap = await userIdQuery.get();
            }

            console.log(`[API] Found ${snap.size} orders for customer via indexed query.`);

            const orders = snap.docs.map(doc => {
                const data = doc.data();
                const statusHistory = (data.statusHistory || []).map(h => ({
                    ...h,
                    timestamp: h.timestamp && typeof h.timestamp.toDate === 'function' ? h.timestamp.toDate().toISOString() : h.timestamp,
                }));
                const itemsWithQty = (data.items || []).map(item => ({
                    ...item,
                    qty: item.quantity || item.qty,
                }));
                return redactOrderForViewer({
                    id: doc.id,
                    ...data,
                    items: itemsWithQty,
                    orderDate: data.orderDate?.toDate ? data.orderDate.toDate().toISOString() : data.orderDate,
                    customer: data.customerName,
                    amount: data.totalAmount,
                    statusHistory,
                }, canViewCustomerDetails, canViewPaymentDetails);
            });
            await trackEndpointRead('api.owner.orders.get', snap.size);

            return respond({ orders }, 200);

        } else if (startDate && endDate) {
            // Ensure dates are valid Date objects
            const start = new Date(startDate);
            const end = new Date(endDate);
            // ✅ SCIPING: Fixed to include restaurantId
            query = query
                .where('restaurantId', '==', businessId)
                .where('orderDate', '>=', start)
                .where('orderDate', '<=', end)
                .orderBy('orderDate', 'desc');
        } else {
            // ✅ SCIPING: Fixed to include restaurantId
            query = query
                .where('restaurantId', '==', businessId)
                .orderBy('orderDate', 'desc')
                .limit(50);
        }

        const ordersSnap = await query.get();

        const orders = ordersSnap.docs.map(doc => {
            const data = doc.data();
            const statusHistory = (data.statusHistory || []).map(h => ({
                ...h,
                timestamp: h.timestamp && typeof h.timestamp.toDate === 'function' ? h.timestamp.toDate().toISOString() : h.timestamp,
            }));

            // Return complete item data (needed for refund calculations)
            const itemsWithQty = (data.items || []).map(item => ({
                ...item, // Keep all original fields
                qty: item.quantity || item.qty, // Normalize quantity field
            }));


            return redactOrderForViewer({
                id: doc.id,
                ...data,
                items: itemsWithQty,
                orderDate: data.orderDate?.toDate ? data.orderDate.toDate().toISOString() : data.orderDate,
                customer: data.customerName,
                amount: data.totalAmount,
                statusHistory,
            }, canViewCustomerDetails, canViewPaymentDetails);
        });
        await trackEndpointRead('api.owner.orders.get', ordersSnap.size);

        return respond({ orders }, 200);

    } catch (error) {
        telemetryStatus = error?.status || 500;
        telemetryError = error?.message || 'Owner orders GET failed';
        console.error("GET ORDERS ERROR:", error);
        return respond({ message: `Backend Error: ${error.message}` }, telemetryStatus);
    } finally {
        void trackApiTelemetry({
            endpoint: 'api.owner.orders.get',
            durationMs: Date.now() - telemetryStartedAt,
            statusCode: telemetryStatus,
            errorMessage: telemetryError,
        });
    }
}


export async function PATCH(req) {
    try {
        const firestore = await getFirestore();
        const { businessId, businessSnap, uid, collectionName, callerRole, callerPermissions } = await verifyOwnerWithAudit(req, 'update_orders_patch', {}, true);
        const requestBaseUrl = new URL(req.url).origin;
        const userRole = callerRole;

        const {
            idsToUpdate = [],
            orderIds = [],
            orderId,
            newStatus,
            deliveryBoyId,
            rejectionReason,
            paymentStatus,
            paymentMethod,
            isCashRefund,
            cashRefundOrderIds = [],
            shouldRefund,
            action // Added action field
        } = await req.json();

        // Support multiple Order ID field names for backward compatibility
        let finalIdsToUpdate = [...idsToUpdate];
        if (finalIdsToUpdate.length === 0 && orderIds.length > 0) finalIdsToUpdate = [...orderIds];
        if (finalIdsToUpdate.length === 0 && orderId) finalIdsToUpdate = [orderId];

        // 🔧 FIX: Map frontend action to backend flag
        const effectiveIsCashRefund = isCashRefund || action === 'markCashRefunded';
        const effectiveCashRefundIds = cashRefundOrderIds.length > 0 ? cashRefundOrderIds : finalIdsToUpdate;

        // Permission guard for payment/refund mutations
        if (paymentStatus && !callerHasPermission(userRole, callerPermissions, PERMISSIONS.PROCESS_PAYMENT)) {
            return NextResponse.json({ message: 'Access Denied: You cannot update payment status.' }, { status: 403 });
        }
        if (effectiveIsCashRefund && !callerHasPermission(userRole, callerPermissions, PERMISSIONS.REFUND_ORDER)) {
            return NextResponse.json({ message: 'Access Denied: You cannot mark refunds.' }, { status: 403 });
        }

        // 1. Gather all unique IDs to pre-fetch in parallel
        const allTargetIds = [...new Set([...finalIdsToUpdate, ...cashRefundOrderIds])];
        if (allTargetIds.length === 0) {
            return NextResponse.json({ message: 'No Order IDs provided.' }, { status: 400 });
        }

        const orderSnaps = await Promise.all(
            allTargetIds.map(id => firestore.collection('orders').doc(id).get())
        );
        const orderMap = new Map(orderSnaps.filter(s => s.exists).map(s => [s.id, s]));

        const batch = firestore.batch();
        const sideEffects = [];
        const businessData = businessSnap.data();

        // --- Special Action: Send Manual UPI Payment Request on WhatsApp ---
        if (action === 'send_payment_request') {
            if (!callerHasPermission(userRole, callerPermissions, PERMISSIONS.PROCESS_PAYMENT)) {
                return NextResponse.json({ message: 'Access Denied: You cannot request payments.' }, { status: 403 });
            }

            const targetOrderId = finalIdsToUpdate[0];
            if (!targetOrderId || finalIdsToUpdate.length !== 1) {
                return NextResponse.json({ message: 'Exactly one order is required for payment request.' }, { status: 400 });
            }

            const targetOrderSnap = orderMap.get(targetOrderId);
            if (!targetOrderSnap) {
                return NextResponse.json({ message: 'Order not found.' }, { status: 404 });
            }

            const targetOrder = targetOrderSnap.data() || {};
            if (targetOrder.restaurantId !== businessId) {
                return NextResponse.json({ message: 'Access denied to this order.' }, { status: 403 });
            }

            if (targetOrder.paymentStatus === 'paid') {
                return NextResponse.json({ message: 'Order is already marked as paid.' }, { status: 400 });
            }

            const configuredUpiId = sanitizeUpiId(businessData?.upiId);
            if (!configuredUpiId || !configuredUpiId.includes('@')) {
                return NextResponse.json({ message: 'Please configure a valid UPI ID in settings before sending payment requests.' }, { status: 400 });
            }

            const paymentRequest = await sendManualPaymentRequestToCustomer({
                orderData: targetOrder,
                orderId: targetOrderId,
                businessData,
                businessId,
                collectionName,
                // Prefer explicitly configured public base URL in lib; use request origin only as fallback.
                baseUrl: process.env.WHATSAPP_CTA_BASE_URL || requestBaseUrl
            });

            await targetOrderSnap.ref.update({
                paymentRequestSentAt: FieldValue.serverTimestamp(),
                paymentRequestSentBy: uid,
                paymentRequestSentByRole: 'owner',
                paymentRequestStatus: 'sent',
                paymentRequestLink: paymentRequest.upiLink,
                paymentRequestImage: paymentRequest.qrCardUrl,
                paymentRequestAmount: paymentRequest.amount,
                paymentRequestCount: FieldValue.increment(1),
            });
            // LOGGING: Add to WhatsApp Direct Chat History
            const conversationId = normalizeIndianPhone(
                paymentRequest.customerPhone || resolveCustomerPhoneForNotification(targetOrder)
            );
            if (conversationId && collectionName) {
                try {
                    const conversationRef = firestore
                        .collection(collectionName)
                        .doc(businessId)
                        .collection('conversations')
                        .doc(conversationId);

                    const now = Date.now();
                    const paymentMessageId = `payreq_card_${targetOrderId}_${now}`;
                    const amountText = String(paymentRequest.amountFixed || paymentRequest.amount || '0.00');
                    const orderDisplayId = String(
                        paymentRequest.orderDisplayId ||
                        targetOrder.orderDisplayId ||
                        targetOrder.orderNumber ||
                        targetOrderId
                    );
                    const paymentText = `Payment request sent\nOrder: ${orderDisplayId}\nAmount: INR ${amountText}\nQR + Pay Now card sent on WhatsApp.`;

                    const batch = firestore.batch();

                    batch.set(conversationRef.collection('messages').doc(paymentMessageId), {
                        id: paymentMessageId,
                        text: paymentText,
                        sender: 'owner',
                        timestamp: FieldValue.serverTimestamp(),
                        type: 'payment_request',
                        mediaUrl: paymentRequest.qrCardUrl,
                        status: 'sent',
                        isPaymentRequest: true,
                        orderId: targetOrderId,
                        upiLink: paymentRequest.upiLink
                    });

                    batch.set(conversationRef, {
                        customerName: resolveCustomerNameForNotification(targetOrder),
                        customerPhone: conversationId,
                        lastMessage: paymentText,
                        lastMessageType: 'payment_request',
                        lastMessageTimestamp: FieldValue.serverTimestamp()
                    }, { merge: true });

                    await batch.commit();
                } catch (logErr) {
                    console.warn('[Owner Orders] Failed to log payment message to chat:', logErr);
                    // Non-blocking error
                }
            }

            try {
                const { kv } = await import('@vercel/kv');
                if (process.env.KV_REST_API_URL) {
                    await kv.del(`order_status:${targetOrderId}`);
                }
            } catch (cacheErr) {
                console.warn('[Owner Orders] Payment request cache invalidation failed:', cacheErr?.message || cacheErr);
            }

            return NextResponse.json({
                message: 'Payment request sent to customer on WhatsApp.',
                orderId: targetOrderId,
                upiLink: paymentRequest.upiLink
            }, { status: 200 });
        }

        // --- Special Action: Mark Manual UPI Payment as Paid ---
        if (action === 'mark_manual_paid') {
            if (!callerHasPermission(userRole, callerPermissions, PERMISSIONS.PROCESS_PAYMENT)) {
                return NextResponse.json({ message: 'Access Denied: You cannot confirm payments.' }, { status: 403 });
            }

            const targetOrderId = finalIdsToUpdate[0];
            if (!targetOrderId || finalIdsToUpdate.length !== 1) {
                return NextResponse.json({ message: 'Exactly one order is required to mark paid.' }, { status: 400 });
            }

            const targetOrderSnap = orderMap.get(targetOrderId);
            if (!targetOrderSnap) {
                return NextResponse.json({ message: 'Order not found.' }, { status: 404 });
            }

            const targetOrder = targetOrderSnap.data() || {};
            if (targetOrder.restaurantId !== businessId) {
                return NextResponse.json({ message: 'Access denied to this order.' }, { status: 403 });
            }

            if (targetOrder.paymentStatus === 'paid') {
                return NextResponse.json({ message: 'Order is already marked as paid.' }, { status: 400 });
            }

            if (!targetOrder.paymentRequestSentAt) {
                return NextResponse.json({ message: 'Send payment request first, then mark this order as paid.' }, { status: 400 });
            }

            const amount = Number(targetOrder.totalAmount || targetOrder.amount || 0);
            const amountSafe = Number.isFinite(amount) ? amount : 0;

            await targetOrderSnap.ref.update({
                paymentStatus: 'paid',
                paymentMethod: 'upi_manual',
                paymentConfirmedVia: 'manual_upi',
                paymentConfirmedBy: uid,
                paymentConfirmedAt: FieldValue.serverTimestamp(),
                paymentRequestStatus: 'completed',
                paidAmount: amountSafe,
                paymentDetails: FieldValue.arrayUnion({
                    method: 'upi_manual',
                    amount: amountSafe,
                    status: 'paid',
                    confirmedBy: uid,
                    timestamp: new Date()
                })
            });

            const customerPhone = resolveCustomerPhoneForNotification(targetOrder);
            if (customerPhone && businessData?.botPhoneNumberId) {
                const customerOrderDisplay = targetOrder.customerOrderId ? `#${targetOrder.customerOrderId}` : `#${targetOrderId.slice(0, 8)}`;
                const customerPhoneWithCode = customerPhone.startsWith('91') ? customerPhone : `91${customerPhone}`;
                try {
                    await sendSystemMessage(
                        customerPhoneWithCode,
                        `Payment received successfully for order ${customerOrderDisplay}. We are now processing your order.`,
                        businessData.botPhoneNumberId,
                        businessId,
                        businessData.name || 'ServiZephyr',
                        collectionName,
                        {
                            customerName: resolveCustomerNameForNotification(targetOrder),
                            conversationPreview: `Payment received for ${customerOrderDisplay}`
                        }
                    );
                } catch (notifyErr) {
                    console.warn('[Owner Orders] Failed to notify customer after mark-paid:', notifyErr?.message || notifyErr);
                }
            }

            try {
                const { kv } = await import('@vercel/kv');
                if (process.env.KV_REST_API_URL) {
                    await kv.del(`order_status:${targetOrderId}`);
                }
            } catch (cacheErr) {
                console.warn('[Owner Orders] Mark-paid cache invalidation failed:', cacheErr?.message || cacheErr);
            }

            return NextResponse.json({
                message: 'Order marked as paid successfully.',
                orderId: targetOrderId
            }, { status: 200 });
        }

        // --- 2. Handle Cash Refund ---
        if (effectiveIsCashRefund && effectiveCashRefundIds.length > 0) {
            for (const id of effectiveCashRefundIds) {
                const orderSnap = orderMap.get(id);
                if (!orderSnap || orderSnap.data().restaurantId !== businessId) continue;

                batch.update(orderSnap.ref, {
                    cashRefunded: true,
                    cashRefundedAt: FieldValue.serverTimestamp()
                });
            }
        }

        // --- 3. Handle Payment Status Update ---
        if (paymentStatus && finalIdsToUpdate.length > 0) {
            for (const id of finalIdsToUpdate) {
                const orderSnap = orderMap.get(id);
                if (!orderSnap || orderSnap.data().restaurantId !== businessId) continue;

                const updateData = { paymentStatus };
                if (paymentMethod) updateData.paymentMethod = paymentMethod;
                batch.update(orderSnap.ref, updateData);
            }
        }

        // --- 4. Handle Order Status Update (Main Flow) ---
        if (newStatus && finalIdsToUpdate.length > 0) {
            let requiredPermission = PERMISSIONS.UPDATE_ORDER_STATUS;
            if (newStatus === 'rejected') {
                requiredPermission = PERMISSIONS.CANCEL_ORDER;
            } else if (newStatus === 'preparing') {
                requiredPermission = PERMISSIONS.MARK_ORDER_PREPARING;
            } else if (newStatus === 'prepared') {
                requiredPermission = PERMISSIONS.MARK_ORDER_READY;
            } else if (newStatus === 'ready_for_pickup' || newStatus === 'Ready') {
                requiredPermission = deliveryBoyId ? PERMISSIONS.ASSIGN_RIDER : PERMISSIONS.MARK_ORDER_READY;
            }

            if (!callerHasPermission(userRole, callerPermissions, requiredPermission)) {
                return NextResponse.json({
                    message: `Access Denied: Missing permission '${requiredPermission}'.`
                }, { status: 403 });
            }

            if (!VALID_STATUSES.has(newStatus)) {
                return NextResponse.json({ message: 'Invalid status provided.' }, { status: 400 });
            }

            if (deliveryBoyId && newStatus !== 'ready_for_pickup') {
                return NextResponse.json({
                    message: 'Rider can only be assigned while moving order to ready_for_pickup.'
                }, { status: 400 });
            }

            // Optional Rider Capacity Check (Only if assigning rider)
            if ((newStatus === 'dispatched' || newStatus === 'ready_for_pickup') && deliveryBoyId) {
                const activeOrdersSnap = await firestore.collection('orders')
                    .where('deliveryBoyId', '==', deliveryBoyId)
                    .where('status', 'in', ['ready_for_pickup', 'dispatched', 'reached_restaurant', 'picked_up', 'on_the_way', 'delivery_attempted'])
                    .get();

                if (activeOrdersSnap.size >= 5) {
                    return NextResponse.json({
                        message: `Rider already has ${activeOrdersSnap.size} active deliveries (max: 5)`,
                        suggestion: 'Please assign another rider.'
                    }, { status: 400 });
                }
            }

            for (const id of finalIdsToUpdate) {
                const orderSnap = orderMap.get(id);
                if (!orderSnap || orderSnap.data().restaurantId !== businessId) continue;

                const orderData = orderSnap.data();
                const currentStatus = orderData.status;
                const hasCustomerLocation = hasValidGeoLocation(orderData.customerLocation);
                const isBlockedDeliveryOrder =
                    orderData.deliveryType === 'delivery' &&
                    orderData.deliveryBlocked === true &&
                    !['rejected', 'cancelled'].includes(newStatus);

                if (isBlockedDeliveryOrder) {
                    return NextResponse.json({
                        message: orderData.deliveryBlockedReason || 'Delivery is blocked for this order. Ask customer to submit a valid in-range address before progressing.'
                    }, { status: 400 });
                }

                if (!canTransition(orderData, currentStatus, newStatus)) {
                    return NextResponse.json({
                        message: `Invalid status transition for order ${id}: ${currentStatus} -> ${newStatus}.`
                    }, { status: 400 });
                }

                const resolvedDeliveryBoyId = deliveryBoyId || orderData.deliveryBoyId || null;

                if (
                    newStatus === 'ready_for_pickup' &&
                    orderData.deliveryType === 'delivery' &&
                    hasCustomerLocation &&
                    !resolvedDeliveryBoyId
                ) {
                    return NextResponse.json({
                        message: 'Delivery orders with customer location require rider assignment before moving to ready_for_pickup.'
                    }, { status: 400 });
                }

                const updateData = {
                    status: newStatus,
                    statusHistory: FieldValue.arrayUnion({
                        status: newStatus,
                        timestamp: new Date()
                    })
                };

                if (newStatus === 'rejected' && rejectionReason) updateData.rejectionReason = rejectionReason;
                if ((newStatus === 'dispatched' || newStatus === 'ready_for_pickup') && resolvedDeliveryBoyId) {
                    updateData.deliveryBoyId = resolvedDeliveryBoyId;
                }

                // Never mutate an existing dine-in tab session id during status transitions.
                // Overwriting this id creates tab drift and breaks clean-table/session closure.
                if (
                    orderData.deliveryType === 'dine-in' &&
                    !orderData.dineInTabId &&
                    typeof orderData.tabId === 'string' &&
                    orderData.tabId.startsWith('tab_')
                ) {
                    // Safe one-time backfill for legacy records that only stored tabId.
                    updateData.dineInTabId = orderData.tabId;
                }

                batch.update(orderSnap.ref, updateData);

                // Queue Side Effects (Notifications, Refunds, RTDB, Cache)
                sideEffects.push((async () => {
                    try {
                        const effects = [];

                        // A. Notifications
                        const customerPhoneForNotification = resolveCustomerPhoneForNotification(orderData);
                        if (businessData.botPhoneNumberId && customerPhoneForNotification) {
                            const riderIdForNotification = resolvedDeliveryBoyId || orderData.deliveryBoyId || null;
                            const riderForNotification = await resolveRiderForNotification(
                                firestore,
                                collectionName,
                                businessId,
                                riderIdForNotification
                            );

                            effects.push(sendOrderStatusUpdateToCustomer({
                                customerPhone: customerPhoneForNotification,
                                botPhoneNumberId: businessData.botPhoneNumberId,
                                customerName: resolveCustomerNameForNotification(orderData),
                                orderId: id,
                                customerOrderId: orderData.customerOrderId,
                                restaurantName: businessData.name,
                                status: newStatus,
                                businessType: businessData.businessType || 'restaurant',
                                deliveryType: orderData.deliveryType,
                                trackingToken: orderData.trackingToken,
                                hasCustomerLocation,
                                deliveryBoy: riderForNotification,
                                amount: orderData.totalAmount || 0,
                                orderDate: orderData.orderDate
                            }));
                        } else {
                            console.warn(
                                `[Owner Orders] Skipping status notification for ${id}. Missing ${!businessData.botPhoneNumberId ? 'botPhoneNumberId' : 'customerPhone'
                                }.`
                            );
                        }

                        // B. Auto-Close Restaurant on Rejection (Only if reason matches)
                        if (newStatus === 'rejected' && rejectionReason === 'restaurant_closed') {
                            const bizCollection =
                                (businessData.businessType === 'shop' || businessData.businessType === 'store')
                                    ? 'shops'
                                    : (businessData.businessType === 'street-vendor' ? 'street_vendors' : 'restaurants');
                            effects.push(firestore.collection(bizCollection).doc(businessId).update({ isOpen: false }));
                            effects.push(sendRestaurantStatusChangeNotification({
                                ownerPhone: businessData.ownerPhone,
                                botPhoneNumberId: businessData.botPhoneNumberId,
                                newStatus: false,
                                restaurantId: businessId,
                            }));
                        }

                        // C. Handle Razorpay Auto-Refund
                        if ((newStatus === 'rejected' || newStatus === 'cancelled') && orderData.paymentDetails) {
                            const paymentDetailsArray = Array.isArray(orderData.paymentDetails) ? orderData.paymentDetails : [orderData.paymentDetails].filter(Boolean);
                            const rzp = paymentDetailsArray.find(p => p.method === 'razorpay' && p.razorpay_payment_id);

                            if (rzp && !orderData.refundStatus && (shouldRefund !== false)) {
                                const razorpay = new Razorpay({
                                    key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
                                    key_secret: process.env.RAZORPAY_KEY_SECRET,
                                });

                                const refund = await razorpay.payments.refund(rzp.razorpay_payment_id, {
                                    amount: Math.round((orderData.totalAmount || 0) * 100),
                                    notes: { orderId: id, reason: `Vendor ${newStatus} Action` }
                                });

                                effects.push(orderSnap.ref.update({
                                    refundStatus: 'completed',
                                    refundId: refund.id,
                                    refundDate: FieldValue.serverTimestamp()
                                }));
                                effects.push(firestore.collection('refunds').doc(refund.id).set({
                                    orderId: id,
                                    amount: orderData.totalAmount,
                                    status: refund.status,
                                    createdAt: FieldValue.serverTimestamp(),
                                    vendorId: businessId
                                }));
                            }
                        }

                        // D. RTDB Sync
                        const database = await getDatabase();
                        const isDelivery = orderData.deliveryType === 'delivery' || orderData.deliveryType === 'takeaway';
                        const trackingPath = isDelivery ? `delivery_tracking/${id}` : `dine_in_tracking/${id}`;
                        const isFinalized = ['delivered', 'rejected', 'cancelled', 'served', 'paid'].includes(newStatus);

                        if (isFinalized) {
                            effects.push(database.ref(trackingPath).remove());
                        } else {
                            effects.push(database.ref(trackingPath).set({
                                status: newStatus,
                                updatedAt: Date.now(),
                                token: orderData.trackingToken || 'temp_token'
                            }));
                        }

                        // E. Cache Invalidation (KV)
                        const { kv } = await import('@vercel/kv');
                        if (process.env.KV_REST_API_URL) {
                            effects.push(kv.del(`order_status:${id}`));
                        }

                        await Promise.allSettled(effects);
                    } catch (err) {
                        console.error(`[SideEffect Error] Order ${id}:`, err);
                    }
                })());
            }
        }

        await batch.commit();

        // CRITICAL: Await side effects to prevent Vercel execution freeze
        // "Fire-and-forget" is unsafe for refunds/notifications in serverless environment
        const results = await Promise.allSettled(sideEffects);

        const failed = results.filter(r => r.status === 'rejected');
        if (failed.length > 0) {
            console.error(`[API][PATCH /orders] ${failed.length} side effect chains had errors.`);
            failed.forEach((f, idx) => console.error(`   Effect ${idx} error:`, f.reason));
        }

        return NextResponse.json({
            message: 'Orders updated successfully.',
            processedCount: orderMap.size
        }, { status: 200 });

    } catch (error) {
        console.error("[API][PATCH /orders] CRITICAL ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

