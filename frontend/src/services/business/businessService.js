/**
 * BUSINESS SERVICE
 * 
 * Abstracts business type handling to eliminate scattered ternaries.
 * 
 * Replaces 30+ instances of:
 *   businessType === 'street-vendor' ? 'street_vendors' : (businessType === 'shop' ? 'shops' : 'restaurants')
 * 
 * With single source of truth.
 * 
 * Phase 5 Step 2.2
 */

import { getFirestore } from '@/lib/firebase-admin';

/**
 * Business type to Firestore collection mapping
 */
const BUSINESS_TYPE_MAP = {
    'restaurant': 'restaurants',
    'shop': 'shops',
    'street-vendor': 'street_vendors',
    'street_vendor': 'street_vendors', // Handle both formats
};

/**
 * Get Firestore collection name for a business type
 * 
 * @param {string} businessType - Business type from request
 * @returns {string} Firestore collection name
 */
export function getBusinessCollection(businessType) {
    const collection = BUSINESS_TYPE_MAP[businessType];

    if (!collection) {
        console.warn(`[BusinessService] Unknown business type: ${businessType}, defaulting to 'restaurants'`);
        return 'restaurants';
    }

    return collection;
}

/**
 * Find business by ID across all business collections
 * 
 * @param {Firestore} firestore - Firestore instance
 * @param {string} businessId - Business document ID
 * @returns {Promise<Object|null>} Business data with metadata
 */
export async function findBusinessById(firestore, businessId) {
    const collections = ['restaurants', 'shops', 'street_vendors'];

    const cleanBusinessId = businessId?.trim();
    if (!cleanBusinessId) return null;

    // Detect if ID is URL encoded (recurisvely decode)
    let decodedId = cleanBusinessId;
    try {
        // Decode up to 3 times to handle double/triple encoding
        for (let i = 0; i < 3; i++) {
            const next = decodeURIComponent(decodedId);
            if (next === decodedId) break;
            decodedId = next;
        }
    } catch (e) {
        // Ignore decoding errors
    }

    // IDs to try: Decoded (Priority) -> Original
    const idsToTry = [decodedId];
    if (cleanBusinessId !== decodedId) {
        idsToTry.push(cleanBusinessId);
    }

    // Eliminate duplicates
    const uniqueIds = [...new Set(idsToTry)];

    console.log(`[BusinessService] Lookup candidates: ${JSON.stringify(uniqueIds)}`);

    // 1. Try direct business lookup (Document ID)
    for (const targetId of uniqueIds) {
        for (const collectionName of collections) {
            try {
                const docRef = firestore.collection(collectionName).doc(targetId);
                const docSnap = await docRef.get();

                if (docSnap.exists) {
                    console.log(`[BusinessService] Found business ${targetId} in collection: ${collectionName}`);


                    // Fetch delivery settings sub-collection
                    let deliverySettings = {};
                    try {
                        const dsSnap = await docRef.collection('delivery_settings').doc('config').get();
                        if (dsSnap.exists) {
                            deliverySettings = dsSnap.data();
                        }
                    } catch (e) {
                        console.warn(`[BusinessService] Failed to load delivery settings for ${targetId}`, e);
                    }

                    return {
                        id: targetId,
                        ref: docRef,
                        data: { ...docSnap.data(), ...deliverySettings }, // Merge settings
                        collection: collectionName,
                        type: getBusinessTypeFromCollection(collectionName)
                    };
                }
            } catch (error) {
                console.error(`[BusinessService] Error checking ${collectionName} for ${targetId}:`, error);
            }
        }

        // 2. Fallback: Check if it's an Owner UID (Legacy Support / Common Mistake)
        console.warn(`[BusinessService] Direct lookup failed for ID: ${targetId}. Checking if Owner UID...`);
        try {
            const userDoc = await firestore.collection('users').doc(targetId).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                if (userData.role === 'owner' && userData.businessId) {
                    console.log(`[BusinessService] Resolved Owner UID ${cleanBusinessId} to Business ID: ${userData.businessId}`);

                    // Recursive call with the REAL business ID
                    // (We return the result of the recursive call)
                    return await findBusinessById(firestore, userData.businessId);
                }
            }
        } catch (err) {
            console.error(`[BusinessService] Owner UID lookup failed:`, err);
        }

        // 3. Fallback: Check if it's a Merchant ID (formatted ID like RS_...)
        if (cleanBusinessId.startsWith('RS_') || cleanBusinessId.startsWith('SH_') || cleanBusinessId.startsWith('SV_')) {
            console.warn(`[BusinessService] Lookup failed for ID: ${cleanBusinessId}. Detecting Merchant ID format. Querying field...`);
            for (const collectionName of collections) {
                try {
                    const querySnap = await firestore.collection(collectionName).where('merchantId', '==', cleanBusinessId).limit(1).get();
                    if (!querySnap.empty) {
                        const docSnap = querySnap.docs[0];
                        console.log(`[BusinessService] Found business via Merchant ID in collection: ${collectionName}`);

                        // Fetch delivery settings sub-collection
                        let deliverySettings = {};
                        try {
                            const dsSnap = await docSnap.ref.collection('delivery_settings').doc('config').get();
                            if (dsSnap.exists) {
                                deliverySettings = dsSnap.data();
                            }
                        } catch (e) {
                            console.warn(`[BusinessService] Failed to load delivery settings for ${docSnap.id}`, e);
                        }

                        return {
                            id: docSnap.id, // Return the actual document ID
                            ref: docSnap.ref,
                            data: { ...docSnap.data(), ...deliverySettings },
                            collection: collectionName,
                            type: getBusinessTypeFromCollection(collectionName)
                        };
                    }
                } catch (error) {
                    console.error(`[BusinessService] Error querying merchantId in ${collectionName}:`, error);
                }
            }
        }


        // 4. Fallback: Check if it's a Slug (URL-friendly name)
        // The logs show: "up-14-food-point-%26-chaap-junction" which suggests URL encoding might be present.
        // We should try both raw and decoded versions.
        let possibleSlugs = [cleanBusinessId];
        try {
            const decoded = decodeURIComponent(cleanBusinessId);
            if (decoded !== cleanBusinessId) {
                possibleSlugs.push(decoded);
            }
        } catch (e) {
            // Ignore decoding errors
        }

        console.warn(`[BusinessService] Lookup failed for ID: ${cleanBusinessId}. Checking if Slug...`);

        for (const slug of possibleSlugs) {
            for (const collectionName of collections) {
                try {
                    const querySnap = await firestore.collection(collectionName).where('slug', '==', slug).limit(1).get();
                    if (!querySnap.empty) {
                        const docSnap = querySnap.docs[0];
                        console.log(`[BusinessService] Found business via Slug '${slug}' in collection: ${collectionName}`);

                        // Fetch delivery settings sub-collection
                        let deliverySettings = {};
                        try {
                            const dsSnap = await docSnap.ref.collection('delivery_settings').doc('config').get();
                            if (dsSnap.exists) {
                                deliverySettings = dsSnap.data();
                            }
                        } catch (e) {
                            console.warn(`[BusinessService] Failed to load delivery settings for ${docSnap.id}`, e);
                        }

                        return {
                            id: docSnap.id, // Return the actual document ID
                            ref: docSnap.ref,
                            data: { ...docSnap.data(), ...deliverySettings },
                            collection: collectionName,
                            type: getBusinessTypeFromCollection(collectionName)
                        };
                    }
                } catch (error) {
                    console.error(`[BusinessService] Error querying slug in ${collectionName}:`, error);
                }
            }
        }

        console.error(`[BusinessService] Business ${businessId} not found in any collection`);
        return null;
    }

    // Default if not found after checking all IDs and fallbacks
    console.error(`[BusinessService] Business ${businessId} not found in any collection`);
    return null;
}

/**
 * Get business type from collection name (reverse mapping)
 * 
 * @param {string} collectionName - Firestore collection name
 * @returns {string} Business type
 */
function getBusinessTypeFromCollection(collectionName) {
    const reverseMap = {
        'restaurants': 'restaurant',
        'shops': 'shop',
        'street_vendors': 'street-vendor'
    };

    return reverseMap[collectionName] || 'restaurant';
}

/**
 * Get business by ID with known type
 * 
 * @param {Firestore} firestore - Firestore instance
 * @param {string} businessId - Business document ID
 * @param {string} businessType - Known business type
 * @returns {Promise<Object|null>} Business data
 */
export async function getBusinessById(firestore, businessId, businessType) {
    const collectionName = getBusinessCollection(businessType);
    const docRef = firestore.collection(collectionName).doc(businessId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
        console.error(`[BusinessService] Business ${businessId} not found in ${collectionName}`);
        return null;
    }

    // Fetch delivery settings sub-collection
    let deliverySettings = {};
    try {
        const dsSnap = await docRef.collection('delivery_settings').doc('config').get();
        if (dsSnap.exists) {
            deliverySettings = dsSnap.data();
        }
    } catch (e) {
        console.warn(`[BusinessService] Failed to load delivery settings for ${businessId}`, e);
    }

    return {
        id: businessId,
        ref: docRef,
        data: { ...docSnap.data(), ...deliverySettings }, // Merge settings
        collection: collectionName,
        type: businessType
    };
}
