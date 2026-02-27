
import { NextResponse } from 'next/server';
import { getAuth, getFirestore, FieldValue, verifyAndGetUid } from '@/lib/firebase-admin';

// Helper to verify owner and get their business
async function verifyOwnerAndGetBusiness(req, auth, firestore) {
    const uid = await verifyAndGetUid(req);
    const url = new URL(req.url, `http://${req.headers.host}`);
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const userDoc = await firestore.collection('users').doc(uid).get();

    if (!userDoc.exists) {
        throw { message: 'Access Denied: User profile not found.', status: 403 };
    }

    const userData = userDoc.data();
    const userRole = userData.role;

    let targetOwnerId = uid;
    if (userRole === 'admin' && impersonatedOwnerId) {
        targetOwnerId = impersonatedOwnerId;
    } else if (!['owner', 'restaurant-owner', 'shop-owner', 'street-vendor'].includes(userRole)) {
        throw { message: 'Access Denied: You do not have sufficient privileges.', status: 403 };
    }
    
    const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];
    for (const collectionName of collectionsToTry) {
        const query = await firestore.collection(collectionName).where('ownerId', '==', targetOwnerId).limit(1).get();
        if (!query.empty) {
            const doc = query.docs[0];
            return { id: doc.id, data: doc.data(), ref: doc.ref };
        }
    }
    
    throw { message: 'No business associated with this owner.', status: 404 };
}


// POST an invitation to a rider
export async function POST(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { id: restaurantId, data: restaurantData, ref: restaurantRef } = await verifyOwnerAndGetBusiness(req, auth, firestore);

        const { riderEmail } = await req.json();

        if (!riderEmail) {
            return NextResponse.json({ message: 'Rider email is required.' }, { status: 400 });
        }
        
        const lowercasedEmail = riderEmail.toLowerCase().trim();

        let userRecord;
        try {
            userRecord = await auth.getUserByEmail(lowercasedEmail);
        } catch (error) {
            if (error.code === 'auth/user-not-found') {
                 return NextResponse.json({ message: 'No user found with this email address. Please ask them to register on the Rider Portal first.' }, { status: 404 });
            }
            throw error; // Re-throw other auth errors
        }

        const riderUid = userRecord.uid;
        
        const driverDocRef = firestore.collection('drivers').doc(riderUid);
        const driverDoc = await driverDocRef.get();
        
        if (!driverDoc.exists) {
            return NextResponse.json({ message: 'This user is not registered as a rider.' }, { status: 400 });
        }
        
        // --- START THE FIX: Use the correct collection name 'deliveryBoys' ---
        const existingRiderRef = restaurantRef.collection('deliveryBoys').doc(riderUid);
        // --- END THE FIX ---
        
        const existingRiderSnap = await existingRiderRef.get();
        if (existingRiderSnap.exists) {
            return NextResponse.json({ message: 'This rider is already part of your team.' }, { status: 409 });
        }
        
        const inviteRef = firestore.collection('drivers').doc(riderUid).collection('invites').doc(restaurantId);
        const existingInviteSnap = await inviteRef.get();
        if (existingInviteSnap.exists) {
            return NextResponse.json({ message: 'An invitation has already been sent to this rider.' }, { status: 409 });
        }
        
        await inviteRef.set({
            restaurantId: restaurantId,
            restaurantName: restaurantData.name,
            invitedAt: FieldValue.serverTimestamp(),
            status: 'pending',
        });

        return NextResponse.json({ message: `Invitation sent successfully to ${riderEmail}!` }, { status: 200 });

    } catch (error) {
        console.error("POST RIDER INVITE ERROR:", error);
        const message = error.message || 'Internal Server Error';
        const status = error.status || 500;
        return NextResponse.json({ message: `Backend Error: ${message}` }, { status: status });
    }
}

    