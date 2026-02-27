import { NextResponse } from 'next/server';
import { getAuth, getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';

// This API is now simplified. It expects a fresh ID token from the client,
// which the client gets after re-authenticating the user.
export async function POST(req) {
    console.log("[API /user/delete] POST request received for deletion.");
    try {
        // The token is verified here. If it's old, this will fail.
        // The client is responsible for providing a fresh token after re-auth.
        const uid = await verifyAndGetUid(req);
        if (!uid) {
            throw { message: 'Authentication required to delete an account.', status: 401 };
        }
        
        console.log(`[API /user/delete] Authenticated request for UID: ${uid}`);

        const firestore = await getFirestore();
        const auth = await getAuth();

        const userRef = firestore.collection('users').doc(uid);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            console.warn(`[API /user/delete] User document not found in Firestore for UID: ${uid}. Proceeding to delete auth record only.`);
            await auth.deleteUser(uid);
            return NextResponse.json({ message: 'User authentication record deleted. Firestore document was not found.' }, { status: 200 });
        }
        
        const userData = userDoc.data();
        const businessType = userData.businessType;
        const batch = firestore.batch();
        
        // 1. Find and mark the associated business document for deletion
        if (businessType) {
            let collectionName;
            if (businessType === 'restaurant') collectionName = 'restaurants';
            else if (businessType === 'shop' || businessType === 'store') collectionName = 'shops';
            else if (businessType === 'street-vendor') collectionName = 'street_vendors';

            if (collectionName) {
                const businessQuery = await firestore.collection(collectionName).where('ownerId', '==', uid).limit(1).get();
                if (!businessQuery.empty) {
                    const businessDoc = businessQuery.docs[0];
                    batch.delete(businessDoc.ref);
                    console.log(`[API /user/delete] Batch: Marked business document for deletion at '${businessDoc.ref.path}'.`);
                } else {
                    console.warn(`[API /user/delete] User had businessType '${businessType}' but no matching document was found for ownerId ${uid}.`);
                }
            }
        } else {
            console.log(`[API /user/delete] User with UID ${uid} has no associated businessType. Skipping business data deletion.`);
        }

        // 2. Mark the Firestore user document for deletion
        batch.delete(userRef);
        console.log(`[API /user/delete] Batch: Marked Firestore user document for deletion at 'users/${uid}'.`);
        
        // 3. Delete the user from Firebase Authentication (This is done after batch commit)
        await auth.deleteUser(uid);
        console.log(`[API /user/delete] Successfully deleted user from Firebase Authentication for UID: ${uid}.`);
        
        // 4. Commit the batched Firestore deletes
        await batch.commit();
        console.log(`[API /user/delete] Batch committed. Firestore data deleted successfully.`);

        return NextResponse.json({ message: 'Account permanently deleted from all systems.' }, { status: 200 });

    } catch (error) {
        console.error('[API /user/delete] CRITICAL ERROR:', error);
        
        if (error.status) {
            return NextResponse.json({ message: error.message }, { status: error.status });
        }
        
        if (error.code === 'auth/user-not-found') {
             return NextResponse.json({ message: 'User not found in authentication system. May have been already deleted.' }, { status: 404 });
        }
        
        // This will catch the 'auth/requires-recent-login' if the client fails to re-authenticate
        if (error.code === 'auth/requires-recent-login') {
            return NextResponse.json({ message: 'This is a sensitive operation and requires recent authentication. Please sign in again.' }, { status: 401 });
        }
        
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
