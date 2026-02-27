/**
 * RAZORPAY WEBHOOK HANDLER
 * 
 * Processes Razorpay webhook events with idempotency protection.
 * 
 * Phase 5 Stage 4.2
 */

import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';
import { incrementMetric, METRICS } from '@/lib/metrics';

/**
 * Handle Razorpay webhook event
 * 
 * Common events:
 * - payment.captured
 * - payment.failed
 * - order.paid
 */
export async function handleRazorpayWebhook(payload) {
    const eventType = payload.event;
    const paymentEntity = payload.payload?.payment?.entity;
    const orderEntity = payload.payload?.order?.entity;

    logger.info('Razorpay webhook received', {
        eventType,
        eventId: payload.event_id || payload.id,
        orderId: paymentEntity?.notes?.firestore_order_id || orderEntity?.notes?.firestore_order_id
    });

    switch (eventType) {
        case 'payment.captured':
            return await handlePaymentCaptured(paymentEntity);

        case 'payment.failed':
            return await handlePaymentFailed(paymentEntity);

        case 'order.paid':
            return await handleOrderPaid(orderEntity);

        default:
            logger.warn('Unknown Razorpay event type', { eventType });
            return { status: 'ignored', eventType };
    }
}

/**
 * Handle payment.captured event
 */
async function handlePaymentCaptured(paymentEntity) {
    const firestore = await getFirestore();

    // Extract order ID from notes
    const firestoreOrderId = paymentEntity.notes?.firestore_order_id;

    if (!firestoreOrderId) {
        logger.error('Missing firestore_order_id in payment notes', {
            razorpayPaymentId: paymentEntity.id
        });
        throw new Error('Missing firestore_order_id in webhook payload');
    }

    logger.info('Processing payment.captured', {
        firestoreOrderId,
        razorpayPaymentId: paymentEntity.id,
        amount: paymentEntity.amount / 100 // Convert paise to rupees
    });

    // Update order
    const orderRef = firestore.collection('orders').doc(firestoreOrderId);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
        logger.error('Order not found', { firestoreOrderId });
        throw new Error(`Order ${firestoreOrderId} not found`);
    }

    const orderData = orderSnap.data();

    // Only update if currently awaiting_payment
    if (orderData.status !== 'awaiting_payment') {
        logger.warn('Order not in awaiting_payment status', {
            firestoreOrderId,
            currentStatus: orderData.status
        });
        return { status: 'ignored', reason: 'Order already processed' };
    }

    // Update order status
    await orderRef.update({
        status: 'pending',
        paymentDetails: FieldValue.arrayUnion({
            method: 'razorpay',
            razorpay_payment_id: paymentEntity.id,
            razorpay_order_id: paymentEntity.order_id,
            status: 'success',
            amount: paymentEntity.amount / 100,
            timestamp: new Date()
        }),
        updatedAt: FieldValue.serverTimestamp()
    });

    logger.info('Order status updated to pending', { firestoreOrderId });

    // Increment metrics (best-effort, after success)
    await incrementMetric(METRICS.PAYMENTS_SUCCESS);

    return { status: 'success', orderId: firestoreOrderId };
}

/**
 * Handle payment.failed event
 */
async function handlePaymentFailed(paymentEntity) {
    const firestoreOrderId = paymentEntity.notes?.firestore_order_id;

    if (!firestoreOrderId) {
        return { status: 'ignored', reason: 'Missing firestore_order_id' };
    }

    logger.warn('Payment failed', {
        firestoreOrderId,
        razorpayPaymentId: paymentEntity.id,
        reason: paymentEntity.error_reason
    });

    const firestore = await getFirestore();
    const orderRef = firestore.collection('orders').doc(firestoreOrderId);

    await orderRef.update({
        paymentDetails: FieldValue.arrayUnion({
            method: 'razorpay',
            razorpay_payment_id: paymentEntity.id,
            status: 'failed',
            error: paymentEntity.error_reason,
            timestamp: new Date()
        }),
        updatedAt: FieldValue.serverTimestamp()
    });

    // Increment metrics
    await incrementMetric(METRICS.PAYMENTS_FAILED);

    return { status: 'recorded', orderId: firestoreOrderId };
}

/**
 * Handle order.paid event
 */
async function handleOrderPaid(orderEntity) {
    const firestoreOrderId = orderEntity.notes?.firestore_order_id;

    if (!firestoreOrderId) {
        return { status: 'ignored', reason: 'Missing firestore_order_id' };
    }

    logger.info('Order paid event', {
        firestoreOrderId,
        razorpayOrderId: orderEntity.id
    });

    // This is typically redundant with payment.captured
    // But we can use it as a backup

    return { status: 'acknowledged', orderId: firestoreOrderId };
}
