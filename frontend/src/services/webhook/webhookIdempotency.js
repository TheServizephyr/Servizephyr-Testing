/**
 * WEBHOOK IDEMPOTENCY SERVICE
 * 
 * Ensures each webhook event processed exactly once using Firestore transactions.
 * 
 * CRITICAL RULES:
 * - Razorpay: Use event.id (NOT orderId)
 * - PhonePe: Use transaction/callback ID (NOT orderId)
 * - Atomic transaction for race-proof processing
 * - 14-day TTL to prevent unbounded growth
 * 
 * Phase 5 Stage 4.1
 */

import { getFirestore, FieldValue } from '@/lib/firebase-admin';

/**
 * Extract event ID from webhook payload (gateway-specific)
 * 
 * CRITICAL: eventId ≠ orderId
 */
export function extractEventId(gateway, payload) {
    switch (gateway) {
        case 'razorpay':
            // Razorpay: Use event.id
            return payload.event?.id || payload.id;

        case 'phonepe':
            // PhonePe: Use transaction ID or callback ID
            return payload.transactionId || payload.merchantTransactionId;

        default:
            throw new Error(`Unknown gateway: ${gateway}`);
    }
}

/**
 * Atomic webhook idempotency check using Firestore transaction
 * 
 * Returns:
 * - { isDuplicate: true } if already processed
 * - { isDuplicate: false } if new (and marks as processed)
 * 
 * @param {string} eventId - Unique event ID from payment gateway
 * @param {string} gateway - Payment gateway ('razorpay' | 'phonepe')
 * @param {string} orderId - Firestore order ID
 * @param {string} eventType - Event type (e.g., 'payment.captured')
 */
export async function ensureWebhookIdempotent(eventId, gateway, orderId, eventType) {
    if (!eventId) {
        throw new Error('Event ID is required for idempotency check');
    }

    const firestore = await getFirestore();

    console.log(`[WebhookIdempotency] Checking: ${gateway} event ${eventId}`);

    return await firestore.runTransaction(async (transaction) => {
        const webhookRef = firestore
            .collection('processed_webhooks')
            .doc(eventId);

        const webhookSnap = await transaction.get(webhookRef);

        if (webhookSnap.exists) {
            console.log(`[WebhookIdempotency] ⚠️  Duplicate detected: ${eventId}`);
            const existingData = webhookSnap.data();

            return {
                isDuplicate: true,
                existingData,
                message: `Webhook ${eventId} already processed at ${existingData.processedAt}`
            };
        }

        // Mark as processed ATOMICALLY with TTL
        // TTL: Auto-delete after 14 days to prevent unbounded growth
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 14); // 14 days from now

        transaction.set(webhookRef, {
            eventId,
            gateway,
            orderId,
            eventType,
            processedAt: FieldValue.serverTimestamp(),
            createdAt: new Date(),
            expiresAt // For Firestore TTL cleanup (manual or automated)
        });

        console.log(`[WebhookIdempotency] ✅ New event marked as processed: ${eventId}`);

        return {
            isDuplicate: false,
            message: 'Webhook marked as processed'
        };
    });
}

/**
 * Process webhook with idempotency protection
 * 
 * Wraps webhook processing in transaction with idempotency check.
 * 
 * @param {string} eventId - Unique event ID
 * @param {string} gateway - Payment gateway
 * @param {string} orderId - Firestore order ID
 * @param {string} eventType - Event type
 * @param {Function} processFn - Processing function to execute
 */
export async function processWebhookIdempotent(eventId, gateway, orderId, eventType, processFn) {
    const firestore = await getFirestore();

    return await firestore.runTransaction(async (transaction) => {
        // 1. Check idempotency
        const webhookRef = firestore.collection('processed_webhooks').doc(eventId);
        const webhookSnap = await transaction.get(webhookRef);

        if (webhookSnap.exists) {
            console.log(`[WebhookIdempotency] Duplicate webhook ignored: ${eventId}`);
            return { isDuplicate: true, processed: false };
        }

        // 2. Mark as processed with TTL
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 14); // 14 days TTL

        transaction.set(webhookRef, {
            eventId,
            gateway,
            orderId,
            eventType,
            processedAt: FieldValue.serverTimestamp(),
            createdAt: new Date(),
            expiresAt // Auto-cleanup after 14 days
        });

        // 3. Execute processing function with transaction
        await processFn(transaction, firestore);

        console.log(`[WebhookIdempotency] Webhook processed: ${eventId}`);
        return { isDuplicate: false, processed: true };
    });
}

/**
 * Check if webhook was already processed (read-only)
 */
export async function isWebhookProcessed(eventId) {
    const firestore = await getFirestore();
    const webhookRef = firestore.collection('processed_webhooks').doc(eventId);
    const webhookSnap = await webhookRef.get();

    return webhookSnap.exists;
}
