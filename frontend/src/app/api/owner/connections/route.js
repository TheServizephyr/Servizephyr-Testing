
import { NextResponse } from 'next/server';
import { getAuth, getFirestore } from '@/lib/firebase-admin';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';
import { PERMISSIONS } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export async function GET(req) {
    try {
        const firestore = await getFirestore();

        // Use centralized resolver with request-level caching
        const { uid: ownerId } = await verifyOwnerWithAudit(
            req,
            'view_connections',
            {},
            false,
            PERMISSIONS.VIEW_SETTINGS
        );

        const restaurantsQuery = await firestore.collection('restaurants')
            .where('ownerId', '==', ownerId)
            .where('botPhoneNumberId', '!=', null)
            .get();

        const shopsQuery = await firestore.collection('shops')
            .where('ownerId', '==', ownerId)
            .where('botPhoneNumberId', '!=', null)
            .get();

        if (restaurantsQuery.empty && shopsQuery.empty) {
            return NextResponse.json({ connections: [] }, { status: 200 });
        }

        const restaurantConnections = restaurantsQuery.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                restaurantName: data.name,
                whatsAppNumber: data.botPhoneNumberId,
                status: data.botStatus || 'Connected'
            };
        });

        const shopConnections = shopsQuery.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                restaurantName: data.name,
                whatsAppNumber: data.botPhoneNumberId,
                status: data.botStatus || 'Connected'
            };
        });

        const connections = [...restaurantConnections, ...shopConnections];

        return NextResponse.json({ connections }, { status: 200 });

    } catch (error) {
        console.error("GET /api/owner/connections ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}

