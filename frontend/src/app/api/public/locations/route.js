

import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

async function fetchCollection(firestore, collectionName) {
    const snapshot = await firestore.collection(collectionName).where('approvalStatus', '==', 'approved').get();
    
    return snapshot.docs.map(doc => {
        const data = doc.data();
        if (data.address && data.address.latitude && data.address.longitude) {
            const businessTypeRaw = data.businessType || collectionName.slice(0, -1);
            const businessType = businessTypeRaw === 'shop' ? 'store' : businessTypeRaw;
            return {
                id: doc.id,
                name: data.name || 'Unnamed Business',
                businessType,
                lat: data.address.latitude,
                lng: data.address.longitude,
                address: `${data.address.street}, ${data.address.city}`
            };
        }
        return null;
    }).filter(Boolean); // Filter out any null entries
}

export async function GET(req) {
    try {
        const firestore = await getFirestore();
        
        const [restaurants, shops] = await Promise.all([
            fetchCollection(firestore, 'restaurants'),
            fetchCollection(firestore, 'shops')
        ]);
        
        const allLocations = [...restaurants, ...shops];

        return NextResponse.json({ locations: allLocations }, { status: 200 });

    } catch (error) {
        console.error("GET /api/public/locations ERROR:", error);
        return NextResponse.json({ message: 'Internal Server Error', error: error.message }, { status: 500 });
    }
}
