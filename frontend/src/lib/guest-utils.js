import { nanoid } from 'nanoid';
import { FieldValue } from 'firebase-admin/firestore';

// --- OBFUSCATION LOGIC ---

/**
 * Obfuscates a Guest ID into a public reference string.
 * Format: <4_random_chars><base64_encoded_id_with_noise>
 * Goal: Make it look complex and hide the standard "g_" pattern in URL.
 */
export const obfuscateGuestId = (guestId) => {
    if (!guestId) return null;

    // 1. Add noise (salt) inside the string before encoding
    // Insert a random char after every 3rd char of the real ID
    let saltedId = "";
    const chars = guestId.split('');
    const noiseChars = "XpOr9LaZwQ";

    chars.forEach((c, index) => {
        saltedId += c;
        if ((index + 1) % 3 === 0) {
            saltedId += noiseChars[Math.floor(Math.random() * noiseChars.length)];
        }
    });

    // 2. Base64 encode the salted string
    const encoded = Buffer.from(saltedId).toString('base64');

    // 3. Add a random 4-char prefix to make the start of the string look changing
    const prefix = nanoid(4);

    // Public Ref
    return `${prefix}${encoded}`.replace(/\=/g, ''); // Remove padding for cleaner URL
};

/**
 * De-obfuscates a public reference string back to the real Guest ID.
 */
export const deobfuscateGuestId = (publicRef) => {
    try {
        if (!publicRef || publicRef.length < 5) return null;

        // 1. Remove 4-char prefix
        const encodedRaw = publicRef.substring(4);
        // Base64 strings in URLs may lose "=" padding; restore it.
        const paddingNeeded = (4 - (encodedRaw.length % 4)) % 4;
        const encoded = `${encodedRaw}${'='.repeat(paddingNeeded)}`;

        // 2. Base64 decode
        const saltedId = Buffer.from(encoded, 'base64').toString('utf-8');

        // 3. Remove noise (every 4th char was noise)
        // Obfuscation logic: Adds noise AFTER every 3 chars of original ID
        // Example: "ABC" → "ABCn" (n=noise), "ABCDEF" → "ABCnDEFn"
        // So in salted string: positions 3, 7, 11, 15... (0-indexed) are noise

        let guestId = "";
        for (let i = 0; i < saltedId.length; i++) {
            // Skip every 4th character (indices 3, 7, 11, 15... which is (i+1) % 4 === 0)
            if ((i + 1) % 4 !== 0) {
                guestId += saltedId[i];
            }
        }

        return guestId;
    } catch (e) {
        console.error(`[GuestUtils] ❌ Failed to deobfuscate ref: ${publicRef}`);
        console.error(`[GuestUtils] Error details:`, e.message);
        return null;
    }
};


// --- PROFILE MANAGEMENT ---

/**
 * Gets or creates a user identifier (UID or Guest ID) for a given phone number.
 * PRIORITY ORDER:
 * 1. Check if user is logged in (UID exists in 'users' collection)
 * 2. Check if guest profile exists
 * 3. Migrate from legacy unclaimed profile
 * 4. Create new guest profile
 * 
 * Returns: { userId: string, isGuest: boolean, data: object, isNew: boolean }
 */
export const getOrCreateGuestProfile = async (firestore, phone) => {
    if (!phone) return null;
    const normalizedPhone = phone.startsWith('91') && phone.length === 12 ? phone.substring(2) : (phone.length > 10 ? phone.slice(-10) : phone);

    console.log(`[GuestUtils] Processing profile for phone: ${normalizedPhone}`);

    // ✅ STEP 1: Check if user is LOGGED IN (has UID in 'users' collection)
    const userQuery = await firestore.collection('users')
        .where('phone', '==', normalizedPhone)
        .limit(1)
        .get();

    if (!userQuery.empty) {
        const userDoc = userQuery.docs[0];
        console.log(`[GuestUtils] ✅ Found LOGGED-IN USER with UID: ${userDoc.id}`);
        return {
            userId: userDoc.id,  // Return UID
            isGuest: false,      // NOT a guest - logged in user
            data: userDoc.data(),
            isNew: false
        };
    }

    console.log(`[GuestUtils] No logged-in user found. Checking guest profiles...`);

    // STEP 2: Check if Guest Profile already exists
    const guestQuery = await firestore.collection('guest_profiles')
        .where('phone', '==', normalizedPhone)
        .limit(1)
        .get();

    if (!guestQuery.empty) {
        const doc = guestQuery.docs[0];
        console.log(`[GuestUtils] Found existing Guest Profile: ${doc.id}`);
        return {
            userId: doc.id,       // Return guest ID
            isGuest: true,        // IS a guest
            guestId: doc.id,      // Keep backward compatibility
            data: doc.data(),
            isNew: false
        };
    }

    // STEP 3: Create New Guest Profile (no more unclaimed_profile migration)
    const guestId = `g_${nanoid(16)}`; // Internal Secure ID
    const guestRef = firestore.collection('guest_profiles').doc(guestId);

    const initialData = {
        phone: normalizedPhone,
        createdAt: FieldValue.serverTimestamp(),
        addresses: []
    };

    await guestRef.set(initialData);

    console.log(`[GuestUtils] Created New Guest Profile: ${guestId}`);
    return {
        userId: guestId,      // Return guest ID
        isGuest: true,        // IS a guest
        guestId: guestId,     // Keep backward compatibility
        data: initialData,
        isNew: true
    };
};

/**
 * Migrates guest profile data to logged-in user account.
 * Called during/after login when guest converts to authenticated user.
 * 
 * @param {Firestore} firestore - Firestore instance
 * @param {string} uid - User's UID from authentication
 * @param {string} phone - User's phone number
 */
export const migrateGuestToUser = async (firestore, uid, phone, finalUserData = {}) => {
    const normalizedPhone = phone.startsWith('91') && phone.length === 12 ? phone.substring(2) : (phone.length > 10 ? phone.slice(-10) : phone);

    console.log(`[GuestUtils] Checking for guest profile to migrate for UID: ${uid}, phone: ${normalizedPhone}`);

    // Check if guest profile exists for this phone
    const guestQuery = await firestore.collection('guest_profiles')
        .where('phone', '==', normalizedPhone)
        .limit(1)
        .get();

    if (guestQuery.empty) {
        console.log(`[GuestUtils] No guest profile found to migrate.`);
        return { migrated: false };
    }

    const guestDoc = guestQuery.docs[0];
    const guestData = guestDoc.data();
    const guestId = guestDoc.id;

    console.log(`[GuestUtils] Found guest profile ${guestId}. Migrating to UID ${uid}...`);

    // Get user document
    const userRef = firestore.collection('users').doc(uid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
        console.error(`[GuestUtils] User document not found for UID: ${uid}`);
        return { migrated: false, error: 'User document not found' };
    }

    // Prepare migration
    const userData = userDoc.data();
    const existingAddresses = userData.addresses || [];
    const guestAddresses = guestData.addresses || [];
    const mergedAddresses = [...existingAddresses, ...guestAddresses];

    const batch = firestore.batch();

    // 1. Update user document with merged addresses
    batch.update(userRef, {
        addresses: mergedAddresses,
        migratedFromGuest: guestId,
        migratedAt: FieldValue.serverTimestamp()
    });

    // 2. Migrate Restaurant Customer Records & joined_restaurants
    if (guestData.orderedFrom && Array.isArray(guestData.orderedFrom)) {
        console.log(`[GuestUtils] Migrating ${guestData.orderedFrom.length} restaurant connections...`);

        for (const restaurantInfo of guestData.orderedFrom) {
            if (restaurantInfo.restaurantId) {
                const restaurantId = restaurantInfo.restaurantId;
                const normalizedType = String(restaurantInfo.businessType || '').toLowerCase();
                const collectionPath = (normalizedType === 'shop' || normalizedType === 'store') ? 'shops' : 'restaurants';

                // Old customer record (by guestId)
                const oldCustomerRef = firestore.collection(collectionPath)
                    .doc(restaurantId)
                    .collection('customers')
                    .doc(guestId);

                // New customer record (by uid)
                const newCustomerRef = firestore.collection(collectionPath)
                    .doc(restaurantId)
                    .collection('customers')
                    .doc(uid);

                const oldCustomerSnap = await oldCustomerRef.get();

                let oldCustomerData = {};
                if (oldCustomerSnap.exists) {
                    oldCustomerData = oldCustomerSnap.data();
                    batch.delete(oldCustomerRef);
                    console.log(`[GuestUtils] Migrating customer record from ${collectionPath}/${restaurantId}/customers/${guestId}`);
                }

                // Create/update customer record with UID
                const newCustomerPayload = {
                    ...oldCustomerData,
                    name: finalUserData.name || userData.name,
                    email: finalUserData.email || userData.email,
                    status: 'verified',
                    lastSeen: FieldValue.serverTimestamp()
                };

                batch.set(newCustomerRef, newCustomerPayload, { merge: true });

                // Add to joined_restaurants subcollection
                const userRestaurantLinkRef = userRef.collection('joined_restaurants').doc(restaurantId);
                batch.set(userRestaurantLinkRef, {
                    restaurantName: restaurantInfo.restaurantName,
                    joinedAt: FieldValue.serverTimestamp(),
                    totalSpend: oldCustomerData.totalSpend || 0,
                    loyaltyPoints: oldCustomerData.loyaltyPoints || 0,
                    lastOrderDate: oldCustomerData.lastOrderDate,
                    totalOrders: oldCustomerData.totalOrders || 0,
                }, { merge: true });
            }
        }
    }

    // 3. Migrate Orders (userId field from guestId to uid)
    const ordersQuery = await firestore.collection('orders')
        .where('userId', '==', guestId)
        .get();

    if (!ordersQuery.empty) {
        console.log(`[GuestUtils] Migrating ${ordersQuery.size} orders from guestId to UID...`);
        ordersQuery.docs.forEach(orderDoc => {
            batch.update(orderDoc.ref, {
                userId: uid,
                migratedFromGuest: guestId
            });
        });
    }

    // 4. Delete guest profile
    batch.delete(firestore.collection('guest_profiles').doc(guestId));

    // Commit all changes
    await batch.commit();

    console.log(`[GuestUtils] ✅ Successfully migrated guest profile ${guestId} to UID ${uid}.`);
    console.log(`[GuestUtils] - Addresses: ${guestAddresses.length}, Orders: ${ordersQuery.size}, Restaurants: ${guestData.orderedFrom?.length || 0}`);

    return {
        migrated: true,
        guestId: guestId,
        addressesMigrated: guestAddresses.length,
        ordersMigrated: ordersQuery.size,
        restaurantsMigrated: guestData.orderedFrom?.length || 0
    };
};
