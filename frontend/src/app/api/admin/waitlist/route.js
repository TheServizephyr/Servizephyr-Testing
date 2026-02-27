import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function GET(req) {
    try {
        const { verifyAdmin } = await import('@/lib/verify-admin');
        await verifyAdmin(req);

        const firestore = await getFirestore();

        // Fetch waitlist entries sorted by creation date (newest first)
        const waitlistSnap = await firestore
            .collection('waitlist_entries')
            .orderBy('createdAt', 'desc')
            .get();

        const entries = waitlistSnap.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                name: data.name || 'N/A',
                phone: data.phone || data.phoneNumber || 'N/A',
                email: data.email || '',
                businessName: data.businessName || data.restaurantName || 'N/A',
                address: data.address || 'N/A',
                createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
            };
        });

        return NextResponse.json({ entries }, { status: 200 });

    } catch (error) {
        console.error("GET /api/admin/waitlist ERROR:", error);
        return NextResponse.json({
            message: 'Internal Server Error',
            error: error.message
        }, { status: 500 });
    }
}
