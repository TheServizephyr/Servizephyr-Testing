
import { NextResponse } from 'next/server';
import { getAuth, getFirestore, FieldValue, verifyAndGetUid } from '@/lib/firebase-admin';

// Helper to verify owner and get their first business Ref
async function verifyOwnerAndGetBusinessRef(req) {
    const firestore = await getFirestore();
    const uid = await verifyAndGetUid(req); // Use central helper
    
    const url = new URL(req.url, `http://${req.headers.host}`);
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const adminUserDoc = await firestore.collection('users').doc(uid).get();

    let finalUserId = uid;
    if (adminUserDoc.exists && adminUserDoc.data().role === 'admin' && impersonatedOwnerId) {
        finalUserId = impersonatedOwnerId;
    }
    
    const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', finalUserId).limit(1).get();
    if (!restaurantsQuery.empty) {
        return restaurantsQuery.docs[0].ref;
    }
    
    const shopsQuery = await firestore.collection('shops').where('ownerId', '==', finalUserId).limit(1).get();
    if (!shopsQuery.empty) {
        return shopsQuery.docs[0].ref;
    }

    throw { message: 'No business associated with this owner.', status: 404 };
}

// GET pending service requests for the owner's business
export async function GET(req) {
    try {
        const businessRef = await verifyOwnerAndGetBusinessRef(req);

        const requestsSnap = await businessRef.collection('serviceRequests')
            .where('status', '==', 'pending')
            .orderBy('createdAt', 'desc')
            .get();
        
        const requests = requestsSnap.docs.map(doc => {
            const data = doc.data();
            return {
                ...data,
                createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
            };
        });


        return NextResponse.json({ requests }, { status: 200 });

    } catch (error) {
        console.error("GET SERVICE REQUESTS ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

// POST a new service request from a customer
export async function POST(req) {
    try {
        const firestore = await getFirestore();
        const { restaurantId, tableId, dineInTabId } = await req.json();

        if (!restaurantId || !tableId) {
            return NextResponse.json({ message: 'Restaurant and Table ID are required.' }, { status: 400 });
        }
        
        let businessRef = firestore.collection('restaurants').doc(restaurantId);
        let businessSnap = await businessRef.get();

        if (!businessSnap.exists) {
            businessRef = firestore.collection('shops').doc(restaurantId);
            businessSnap = await businessRef.get();
        }

        if (!businessSnap.exists) {
            return NextResponse.json({ message: `Business with ID ${restaurantId} not found.`}, { status: 404 });
        }
        
        const newRequestRef = businessRef.collection('serviceRequests').doc();
        
        const newRequestData = {
            id: newRequestRef.id,
            tableId: tableId,
            dineInTabId: dineInTabId || null,
            status: 'pending',
            createdAt: FieldValue.serverTimestamp(),
        };

        await newRequestRef.set(newRequestData);

        return NextResponse.json({ message: 'Service request sent successfully!', id: newRequestRef.id }, { status: 201 });

    } catch (error) {
        console.error("POST SERVICE REQUEST ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}

// PATCH to update a service request's status (e.g., acknowledge)
export async function PATCH(req) {
    try {
        const businessRef = await verifyOwnerAndGetBusinessRef(req);
        const { requestId, status } = await req.json();

        if (!requestId || !status) {
            return NextResponse.json({ message: 'Request ID and new status are required.' }, { status: 400 });
        }
        
        const requestRef = businessRef.collection('serviceRequests').doc(requestId);
        
        const requestSnap = await requestRef.get();
        if(!requestSnap.exists){
            return NextResponse.json({ message: 'Service request not found.' }, { status: 404 });
        }

        await requestRef.update({ status: status });

        return NextResponse.json({ message: `Request marked as ${status}.` }, { status: 200 });

    } catch (error) {
        console.error("PATCH SERVICE REQUEST ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
