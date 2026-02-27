/**
 * CUSTOMER REPOSITORY
 * 
 * Manages customer data and statistics.
 * 
 * Phase 5 Step 2.3
 */

import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { getBusinessCollection } from '@/services/business/businessService';

export class CustomerRepository {
    constructor() {
        this.usersCollection = 'users';
        this.unclaimedCollection = 'unclaimed_profiles';
    }

    /**
     * Find customer by phone number
     */
    async getByPhone(phone) {
        const firestore = await getFirestore();
        const usersRef = firestore.collection(this.usersCollection);

        const snapshot = await usersRef.where('phone', '==', phone).limit(1).get();

        if (snapshot.empty) {
            console.log(`[CustomerRepository] Customer not found for phone: ${phone}`);
            return null;
        }

        const doc = snapshot.docs[0];
        return {
            id: doc.id,
            ...doc.data()
        };
    }

    /**
     * Update customer stats in business's customer collection
     */
    async updateBusinessStats(customerId, businessId, businessType, stats) {
        const firestore = await getFirestore();
        const collectionName = getBusinessCollection(businessType);

        const customerRef = firestore
            .collection(collectionName)
            .doc(businessId)
            .collection('customers')
            .doc(customerId);

        await customerRef.set({
            ...stats,
            totalSpend: FieldValue.increment(stats.spend || 0),
            loyaltyPoints: FieldValue.increment(stats.points || 0),
            totalOrders: FieldValue.increment(1),
            lastOrderDate: FieldValue.serverTimestamp()
        }, { merge: true });

        console.log(`[CustomerRepository] Updated stats for customer ${customerId} at ${businessId}`);
    }

    /**
     * Create unclaimed profile for new customer
     */
    async createUnclaimedProfile(phone, customerData) {
        const firestore = await getFirestore();
        const unclaimedRef = firestore.collection(this.unclaimedCollection).doc(phone);

        await unclaimed

        Ref.set({
            ...customerData,
            createdAt: FieldValue.serverTimestamp()
        }, { merge: true });

        console.log(`[CustomerRepository] Unclaimed profile created for ${phone}`);
    }
}

// Singleton export
export const customerRepository = new CustomerRepository();
