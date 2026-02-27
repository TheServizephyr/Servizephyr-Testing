/**
 * ORDER REPOSITORY
 * 
 * Abstracts Firestore operations for orders collection.
 * Replaces 100+ direct firestore.collection('orders') calls.
 * 
 * Benefits:
 * - Single source of truth for order DB operations
 * - Easier to test (mockable)
 * - Prevents collection name typos
 * - Centralized error handling
 * 
 * Phase 5 Step 2.3
 */

import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { generateCustomerOrderId } from '@/utils/generateCustomerOrderId';

export class OrderRepository {
    constructor() {
        this.collectionName = 'orders';
    }

    /**
     * Get order by ID
     */
    async getById(orderId) {
        const firestore = await getFirestore();
        const docRef = firestore.collection(this.collectionName).doc(orderId);
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
            console.warn(`[OrderRepository] Order ${orderId} not found`);
            return null;
        }

        return {
            id: docSnap.id,
            ref: docRef,
            ...docSnap.data()
        };
    }

    /**
     * Create new order
     * Automatically generates a 10-digit customer-facing order ID
     */
    async create(orderData, customId = null) {
        const firestore = await getFirestore();
        const docRef = customId
            ? firestore.collection(this.collectionName).doc(customId)
            : firestore.collection(this.collectionName).doc();

        const timestamp = FieldValue.serverTimestamp();

        // Generate customer-facing order ID (10 digits: YYMMDD + 4 random)
        const customerOrderId = generateCustomerOrderId();

        await docRef.set({
            ...orderData,
            customerOrderId, // NEW: Customer-facing ID for UI/support
            createdAt: timestamp,
            updatedAt: timestamp
        });

        console.log(`[OrderRepository] Order created: ${docRef.id} (CustomerID: ${customerOrderId})`);
        return docRef.id;
    }

    /**
     * Update existing order
     */
    async update(orderId, updates) {
        const firestore = await getFirestore();
        const docRef = firestore.collection(this.collectionName).doc(orderId);

        await docRef.update({
            ...updates,
            updatedAt: FieldValue.serverTimestamp()
        });

        console.log(`[OrderRepository] Order updated: ${orderId}`);
    }

    /**
     * Add items to existing order (transaction-safe)
     */
    async addItems(orderId, newItems, pricing) {
        const firestore = await getFirestore();
        const orderRef = firestore.collection(this.collectionName).doc(orderId);

        await firestore.runTransaction(async (transaction) => {
            const orderDoc = await transaction.get(orderRef);

            if (!orderDoc.exists) {
                throw new Error(`Order ${orderId} not found`);
            }

            const orderData = orderDoc.data();

            // Security check: only pending/awaiting_payment orders can have items added
            const allowedStatuses = ['pending', 'awaiting_payment'];
            if (!allowedStatuses.includes(orderData.status)) {
                throw new Error(`Cannot add items to order with status: ${orderData.status}`);
            }

            const existingItems = orderData.items || [];
            const currentTimestamp = new Date();

            // Mark new items as addons
            const itemsWithMetadata = newItems.map(item => ({
                ...item,
                addedAt: currentTimestamp,
                isAddon: true
            }));

            const newSubtotal = orderData.subtotal + pricing.serverSubtotal;
            const newGrandTotal = orderData.totalAmount + pricing.grandTotal;

            transaction.update(orderRef, {
                items: [...existingItems, ...itemsWithMetadata],
                subtotal: newSubtotal,
                totalAmount: newGrandTotal,
                statusHistory: FieldValue.arrayUnion({
                    status: 'updated',
                    timestamp: currentTimestamp,
                    notes: `Added ${newItems.length} item(s)`
                }),
                updatedAt: FieldValue.serverTimestamp()
            });
        });

        console.log(`[OrderRepository] Added ${newItems.length} items to order ${orderId}`);
    }

    /**
     * Add payment details to order
     */
    async addPaymentDetails(orderId, paymentDetails) {
        const firestore = await getFirestore();
        const docRef = firestore.collection(this.collectionName).doc(orderId);

        await docRef.update({
            paymentDetails: FieldValue.arrayUnion(paymentDetails),
            updatedAt: FieldValue.serverTimestamp()
        });

        console.log(`[OrderRepository] Payment details added to order ${orderId}`);
    }

    /**
     * Update order status
     */
    async updateStatus(orderId, newStatus, notes = null) {
        const firestore = await getFirestore();
        const docRef = firestore.collection(this.collectionName).doc(orderId);

        const statusEntry = {
            status: newStatus,
            timestamp: new Date(),
            ...(notes && { notes })
        };

        await docRef.update({
            status: newStatus,
            statusHistory: FieldValue.arrayUnion(statusEntry),
            updatedAt: FieldValue.serverTimestamp()
        });

        console.log(`[OrderRepository] Status updated for order ${orderId}: ${newStatus}`);
    }
}

// Singleton export
export const orderRepository = new OrderRepository();
