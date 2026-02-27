/**
 * UNIFIED WEBHOOK SERVICE
 * 
 * Single entry point for all payment gateway webhooks.
 * Handles signature verification, idempotency, and routing.
 * 
 * Phase 5 Stage 4.2
 */

import { extractEventId, ensureWebhookIdempotent } from './webhookIdempotency';
import { handleRazorpayWebhook } from './razorpay.handler';
import { handlePhonePeWebhook } from './phonepe.handler';
import { logger } from '@/lib/logger';
import { incrementMetric, METRICS } from '@/lib/metrics';
import crypto from 'crypto';

function timingSafeEqualHex(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const left = Buffer.from(a, 'hex');
    const right = Buffer.from(b, 'hex');
    if (left.length === 0 || right.length === 0 || left.length !== right.length) {
        return false;
    }
    return crypto.timingSafeEqual(left, right);
}

/**
 * Process webhook (main entry point)
 * 
 * @param {Object} params
 * @param {string} params.gateway - 'razorpay' | 'phonepe'
 * @param {Object} params.payload - Webhook payload
 * @param {string} params.signature - Webhook signature (for verification)
 */
export async function handleWebhook({ gateway, payload, signature }) {
    logger.info('Webhook received', {
        gateway,
        timestamp: new Date().toISOString()
    });

    try {
        // 1. Verify signature (gateway-specific)
        const isValid = await verifyWebhookSignature(gateway, payload, signature);

        if (!isValid) {
            logger.error('Invalid webhook signature', { gateway });
            throw new Error('Invalid webhook signature');
        }

        // 2. Extract event ID
        const eventId = extractEventId(gateway, payload);
        const orderId = extractOrderId(gateway, payload);
        const eventType = extractEventType(gateway, payload);

        logger.info('Webhook details extracted', {
            gateway,
            eventId,
            orderId,
            eventType
        });

        // 3. Check idempotency (atomic transaction)
        const { isDuplicate } = await ensureWebhookIdempotent(
            eventId,
            gateway,
            orderId,
            eventType
        );

        if (isDuplicate) {
            logger.warn('Duplicate webhook detected', {
                gateway,
                eventId,
                orderId
            });

            // Increment duplicate counter (best-effort)
            await incrementMetric(METRICS.WEBHOOK_DUPLICATES);

            return {
                status: 'duplicate',
                eventId,
                message: 'Webhook already processed'
            };
        }

        // 4. Route to gateway handler
        let result;
        switch (gateway) {
            case 'razorpay':
                result = await handleRazorpayWebhook(payload);
                break;

            case 'phonepe':
                result = await handlePhonePeWebhook(payload);
                break;

            default:
                throw new Error(`Unknown gateway: ${gateway}`);
        }

        // 5. Increment processed counter (best-effort)
        await incrementMetric(METRICS.WEBHOOK_PROCESSED);

        logger.info('Webhook processed successfully', {
            gateway,
            eventId,
            result
        });

        return {
            status: 'success',
            eventId,
            ...result
        };

    } catch (error) {
        logger.error('Webhook processing failed', {
            gateway,
            error: error.message,
            stack: error.stack
        });

        throw error;
    }
}

/**
 * Verify webhook signature (gateway-specific)
 */
async function verifyWebhookSignature(gateway, payload, signature) {
    switch (gateway) {
        case 'razorpay':
            return verifyRazorpaySignature(payload, signature);

        case 'phonepe':
            return verifyPhonePeSignature(payload, signature);

        default:
            throw new Error(`Unknown gateway: ${gateway}`);
    }
}

/**
 * Verify Razorpay webhook signature
 */
function verifyRazorpaySignature(payload, signature) {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET;

    if (!secret) {
        logger.error('Razorpay webhook secret not configured');
        return false;
    }

    const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(payload))
        .digest('hex');

    return timingSafeEqualHex(signature, expectedSignature);
}

/**
 * Verify PhonePe webhook signature
 */
function verifyPhonePeSignature(payload, signature) {
    const secret = process.env.PHONEPE_WEBHOOK_SECRET;

    if (!secret) {
        logger.error('PhonePe webhook secret not configured');
        return false;
    }

    const expectedSignature = crypto
        .createHash('sha256')
        .update(JSON.stringify(payload) + secret)
        .digest('hex');

    return timingSafeEqualHex(signature, expectedSignature);
}

/**
 * Extract order ID from webhook payload
 */
function extractOrderId(gateway, payload) {
    switch (gateway) {
        case 'razorpay':
            return payload.payload?.payment?.entity?.notes?.firestore_order_id ||
                payload.payload?.order?.entity?.notes?.firestore_order_id;

        case 'phonepe':
            return payload.merchantTransactionId;

        default:
            return null;
    }
}

/**
 * Extract event type from webhook payload
 */
function extractEventType(gateway, payload) {
    switch (gateway) {
        case 'razorpay':
            return payload.event;

        case 'phonepe':
            return payload.code; // e.g., 'PAYMENT_SUCCESS'

        default:
            return 'unknown';
    }
}
