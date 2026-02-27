import { getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';

/**
 * Verify if the request is from an authenticated Admin.
 * 
 * @param {Request} req - Next.js Request object
 * @returns {Promise<Object>} - The user document data if admin, throws error otherwise.
 */
export async function verifyAdmin(req) {
    const firestore = await getFirestore();
    const uid = await verifyAndGetUid(req);

    const userDoc = await firestore.collection('users').doc(uid).get();

    if (!userDoc.exists) {
        throw { message: 'Access Denied: User profile not found.', status: 403 };
    }

    const userData = userDoc.data();

    // STRICT ADMIN CHECK
    if (userData.role !== 'admin' && userData.isAdmin !== true) {
        throw { message: 'Access Denied: Admins only.', status: 403 };
    }

    return { uid, userData };
}
