/**
 * IDEMPOTENCY REPOSITORY
 * 
 * Manages idempotency keys for preventing duplicate requests.
 * 
 * Phase 5 Step 2.3
 */

import { getFirestore, FieldValue } from '@/lib/firebase-admin';

export class IdempotencyRepository {
    constructor() {
        this.collectionName = 'idempotency_keys';
    }

    /**
     * Check if key already exists (duplicate check)
     */
    async checkDuplicate(idempotencyKey) {
        const firestore = await getFirestore();
        const docRef = firestore.collection(this.collectionName).doc(idempotencyKey);
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
            return { isDuplicate: false };
        }

        const data = docSnap.data();

        // If completed, return existing order
        if (data.status === 'completed' && data.orderId) {
            console.log(`[IdempotencyRepository] Duplicate request detected: ${idempotencyKey}`);
            return {
                isDuplicate: true,
                orderId: data.orderId,
                razorpayOrderId: data.razorpayOrderId
            };
        }

        // If reserved but not completed, check if stale (>30s)
        if (data.status === 'reserved') {
            const reservedAt = data.createdAt?.toDate();
            if (reservedAt && (Date.now() - reservedAt.getTime() < 30000)) {
                throw new Error('Request already in progress. Please wait.');
            }
        }

        return { isDuplicate: false };
    }

    /**
     * Reserve idempotency key (mark as in-progress)
     */
    async reserve(idempotencyKey, metadata = {}) {
        const firestore = await getFirestore();
        const docRef = firestore.collection(this.collectionName).doc(idempotencyKey);

        await docRef.set({
            status: 'reserved',
            ...metadata,
            createdAt: FieldValue.serverTimestamp()
        }, { merge: true });

        console.log(`[IdempotencyRepository] Key reserved: ${idempotencyKey}`);
    }

    /**
     * Mark idempotency key as completed
     */
    async complete(idempotencyKey, result) {
        const firestore = await getFirestore();
        const docRef = firestore.collection(this.collectionName).doc(idempotencyKey);

        await docRef.update({
            status: 'completed',
            ...result,
            completedAt: FieldValue.serverTimestamp()
        });

        console.log(`[IdempotencyRepository] Key completed: ${idempotencyKey}`);
    }

    /**
     * Mark idempotency key as failed
     */
    async fail(idempotencyKey, error) {
        const firestore = await getFirestore();
        const docRef = firestore.collection(this.collectionName).doc(idempotencyKey);

        await docRef.update({
            status: 'failed',
            error: error.message,
            failedAt: FieldValue.serverTimestamp()
        });

        console.log(`[IdempotencyRepository] Key marked as failed: ${idempotencyKey}`);
    }

    /**
     * Reserve key with transaction (atomic)
     */
    async reserveAtomic(idempotencyKey, metadata = {}) {
        const firestore = await getFirestore();

        return await firestore.runTransaction(async (transaction) => {
            const keyRef = firestore.collection(this.collectionName).doc(idempotencyKey);
            const keySnap = await transaction.get(keyRef);

            if (keySnap.exists) {
                const data = keySnap.data();

                // If completed, return existing
                if (data.status === 'completed') {
                    return {
                        isDuplicate: true,
                        orderId: data.orderId,
                        razorpayOrderId: data.razorpayOrderId
                    };
                }

                // If reserved recently, reject
                const reservedAt = data.createdAt?.toDate();
                if (reservedAt && (Date.now() - reservedAt.getTime() < 30000)) {
                    throw new Error('Request already in progress');
                }
            }

            // Reserve the key
            transaction.set(keyRef, {
                status: 'reserved',
                ...metadata,
                createdAt: FieldValue.serverTimestamp()
            }, { merge: true });

            return { isDuplicate: false };
        });
    }
}

// Singleton export
export const idempotencyRepository = new IdempotencyRepository();
