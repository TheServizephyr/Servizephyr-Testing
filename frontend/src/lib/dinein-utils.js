/**
 * DINE-IN UTILITIES
 * 
 * Source of truth pattern for tab management.
 * Orders collection = always accurate
 * Tab totals = cached/derived for performance
 * 
 * Critical for preventing data corruption and ensuring integrity.
 */

import { getFirestore, FieldValue } from './firebase-admin';

/**
 * CRITICAL: Recalculate tab totals from orders (source of truth)
 * 
 * Use when:
 * - After any order modification
 * - Before payment processing
 * - Periodic integrity checks
 * - Suspected mismatch
 * 
 * @param {string} tabId - Dine-in tab ID
 * @returns {Promise<{totalAmount: number, paidAmount: number, pendingAmount: number}>}
 */
export async function recalculateTabTotals(tabId) {
    const firestore = await getFirestore();

    const result = await firestore.runTransaction(async (transaction) => {
        // Get all orders from subcollection (SOURCE OF TRUTH)
        const ordersRef = firestore
            .collection('dine_in_tabs')
            .doc(tabId)
            .collection('orders');

        const ordersSnap = await transaction.get(ordersRef);

        let totalAmount = 0;
        let paidAmount = 0;

        // Calculate from actual order documents
        for (const orderDoc of ordersSnap.docs) {
            const orderRef = firestore.collection('orders').doc(orderDoc.id);
            const orderSnap = await transaction.get(orderRef);

            if (!orderSnap.exists) {
                console.warn(`[DineIn] Order ${orderDoc.id} not found in main collection`);
                continue;
            }

            const orderData = orderSnap.data();

            totalAmount += orderData.totalAmount || 0;

            if (orderData.paymentDetails?.status === 'paid') {
                paidAmount += orderData.totalAmount || 0;
            }
        }

        const pendingAmount = totalAmount - paidAmount;

        // Update tab with recalculated values
        const tabRef = firestore.collection('dine_in_tabs').doc(tabId);
        transaction.update(tabRef, {
            totalAmount,
            paidAmount,
            pendingAmount,
            lastRecalculatedAt: FieldValue.serverTimestamp()
        });

        return { totalAmount, paidAmount, pendingAmount };
    });

    console.log(`[DineIn] ✅ Recalculated tab ${tabId}:`, result);
    return result;
}

/**
 * Verify tab totals match orders (integrity check)
 * Auto-corrects mismatches by recalculating
 * 
 * @param {string} tabId - Dine-in tab ID
 * @returns {Promise<{isValid: boolean, mismatch?: number, corrected?: boolean}>}
 */
export async function verifyTabIntegrity(tabId) {
    const firestore = await getFirestore();

    const tabRef = firestore.collection('dine_in_tabs').doc(tabId);
    const tabSnap = await tabRef.get();

    if (!tabSnap.exists) {
        throw new Error('Tab not found');
    }

    const tabData = tabSnap.data();
    const cachedTotal = tabData.totalAmount || 0;
    const cachedPaid = tabData.paidAmount || 0;
    const cachedPending = tabData.pendingAmount || 0;

    // Recalculate from source of truth
    const { totalAmount, paidAmount, pendingAmount } = await recalculateTabTotals(tabId);

    const totalMismatch = Math.abs(cachedTotal - totalAmount);
    const paidMismatch = Math.abs(cachedPaid - paidAmount);
    const pendingMismatch = Math.abs(cachedPending - pendingAmount);

    const hasMismatch = totalMismatch > 0.01 || paidMismatch > 0.01 || pendingMismatch > 0.01;

    if (hasMismatch) {
        console.warn(`[DineIn] ⚠️ Tab ${tabId} integrity mismatch detected:`, {
            cached: { total: cachedTotal, paid: cachedPaid, pending: cachedPending },
            actual: { total: totalAmount, paid: paidAmount, pending: pendingAmount },
            difference: { total: totalMismatch, paid: paidMismatch, pending: pendingMismatch }
        });

        return {
            isValid: false,
            mismatch: totalMismatch,
            corrected: true
        };
    }

    return { isValid: true };
}

/**
 * Check if all orders in a tab are paid
 * 
 * @param {string} tabId - Dine-in tab ID
 * @returns {Promise<boolean>}
 */
export async function areAllOrdersPaid(tabId) {
    const firestore = await getFirestore();

    const ordersRef = firestore
        .collection('dine_in_tabs')
        .doc(tabId)
        .collection('orders');

    const ordersSnap = await ordersRef.get();

    // Check each order in main collection
    for (const orderDoc of ordersSnap.docs) {
        const orderRef = firestore.collection('orders').doc(orderDoc.id);
        const orderSnap = await orderRef.get();

        if (!orderSnap.exists) continue;

        const orderData = orderSnap.data();
        if (orderData.paymentDetails?.status !== 'paid') {
            return false;
        }
    }

    return true;
}

/**
 * Validate token for tab access
 * 
 * @param {string} tabId - Dine-in tab ID
 * @param {string} token - Token to verify
 * @returns {Promise<boolean>}
 */
export async function validateTabToken(tabId, token) {
    const firestore = await getFirestore();

    const tabRef = firestore.collection('dine_in_tabs').doc(tabId);
    const tabSnap = await tabRef.get();

    if (!tabSnap.exists) {
        return false;
    }

    const tabData = tabSnap.data();
    return tabData.token === token;
}
