/**
 * BUSINESS REPOSITORY
 * 
 * Abstracts Firestore operations for business collections
 * (restaurants, shops, street_vendors).
 * 
 * Phase 5 Step 2.3
 */

import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { getBusinessCollection } from '@/services/business/businessService';

export class BusinessRepository {
    /**
     * Get business by ID and type
     */
    async getById(businessId, businessType = 'restaurant') {
        const firestore = await getFirestore();
        const collectionName = getBusinessCollection(businessType);

        const docRef = firestore.collection(collectionName).doc(businessId);
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
            console.warn(`[BusinessRepository] Business ${businessId} not found in ${collectionName}`);
            return null;
        }

        return {
            id: docSnap.id,
            ref: docRef,
            collection: collectionName,
            type: businessType,
            ...docSnap.data()
        };
    }

    /**
     * Get menu for a business
     */
    async getMenu(businessId, businessType = 'restaurant') {
        const firestore = await getFirestore();
        const collectionName = getBusinessCollection(businessType);

        const menuRef = firestore
            .collection(collectionName)
            .doc(businessId)
            .collection('menu');

        const menuSnapshot = await menuRef.get();

        const menu = [];
        menuSnapshot.forEach(doc => {
            menu.push({
                id: doc.id,
                ...doc.data()
            });
        });

        console.log(`[BusinessRepository] Retrieved ${menu.length} menu categories for ${businessId}`);
        return menu;
    }

    /**
     * Update business field
     */
    async update(businessId, businessType, updates) {
        const firestore = await getFirestore();
        const collectionName = getBusinessCollection(businessType);

        const docRef = firestore.collection(collectionName).doc(businessId);
        await docRef.update({
            ...updates,
            updatedAt: FieldValue.serverTimestamp()
        });

        console.log(`[BusinessRepository] Business ${businessId} updated`);
    }

    /**
     * Increment last order token (for dine-in/street vendor)
     */
    async incrementOrderToken(businessId, businessType) {
        const firestore = await getFirestore();
        const collectionName = getBusinessCollection(businessType);

        const docRef = firestore.collection(collectionName).doc(businessId);
        await docRef.update({
            lastOrderToken: FieldValue.increment(1)
        });

        console.log(`[BusinessRepository] Order token incremented for ${businessId}`);
    }
}

// Singleton export
export const businessRepository = new BusinessRepository();
