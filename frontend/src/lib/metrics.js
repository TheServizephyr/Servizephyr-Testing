/**
 * LIGHTWEIGHT METRICS
 * 
 * Simple Firestore-based counters for production visibility.
 * Metrics written OUTSIDE transactions (best-effort, no blocking).
 * 
 * Phase 5 Stage 4.4
 */

import { getFirestore, FieldValue } from '@/lib/firebase-admin';

export const METRICS = {
    ORDERS_CREATED: 'orders_created',
    PAYMENTS_SUCCESS: 'payments_success',
    PAYMENTS_FAILED: 'payments_failed',
    WEBHOOK_DUPLICATES: 'webhook_duplicates',
    WEBHOOK_PROCESSED: 'webhook_processed',
    PRICE_MISMATCHES: 'price_mismatches',
    IDEMPOTENCY_HITS: 'idempotency_hits'
};

/**
 * Increment a metric counter (best-effort, non-blocking)
 * 
 * CRITICAL: Called OUTSIDE transaction (after success)
 * 
 * @param {string} metric - Metric name from METRICS enum
 * @param {number} count - Amount to increment (default: 1)
 */
export async function incrementMetric(metric, count = 1) {
    try {
        const firestore = await getFirestore();
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

        const metricRef = firestore
            .collection('analytics_runtime')
            .doc(today);

        // Best-effort increment (don't throw on failure)
        await metricRef.set({
            [metric]: FieldValue.increment(count),
            lastUpdated: FieldValue.serverTimestamp()
        }, { merge: true });

        console.log(`[Metrics] Incremented ${metric} by ${count}`);
    } catch (error) {
        // Don't fail the main operation if metrics fail
        console.error(`[Metrics] Failed to increment ${metric}:`, error.message);
    }
}

/**
 * Get today's metrics
 */
export async function getTodayMetrics() {
    try {
        const firestore = await getFirestore();
        const today = new Date().toISOString().split('T')[0];

        const metricRef = firestore.collection('analytics_runtime').doc(today);
        const doc = await metricRef.get();

        if (!doc.exists) {
            return {};
        }

        return doc.data();
    } catch (error) {
        console.error('[Metrics] Failed to get metrics:', error);
        return {};
    }
}

/**
 * Get metrics for date range
 */
export async function getMetricsRange(startDate, endDate) {
    try {
        const firestore = await getFirestore();

        const snapshot = await firestore
            .collection('analytics_runtime')
            .where('__name__', '>=', startDate)
            .where('__name__', '<=', endDate)
            .get();

        const metrics = {};
        snapshot.forEach(doc => {
            metrics[doc.id] = doc.data();
        });

        return metrics;
    } catch (error) {
        console.error('[Metrics] Failed to get range:', error);
        return {};
    }
}

/**
 * Example usage:
 * 
 * // After order created successfully
 * await incrementMetric(METRICS.ORDERS_CREATED);
 * 
 * // After payment success
 * await incrementMetric(METRICS.PAYMENTS_SUCCESS);
 * 
 * // After duplicate webhook detected
 * await incrementMetric(METRICS.WEBHOOK_DUPLICATES);
 * 
 * // After price mismatch
 * await incrementMetric(METRICS.PRICE_MISMATCHES);
 */
