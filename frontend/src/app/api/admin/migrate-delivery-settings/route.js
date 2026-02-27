import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { verifyAdmin } from '@/lib/verify-admin';

export const dynamic = 'force-dynamic';

export async function POST(req) {
    try {
        await verifyAdmin(req);
        const firestore = await getFirestore();
        const results = {
            migrated: 0,
            errors: []
        };

        const collections = ['restaurants', 'shops', 'street_vendors'];

        for (const collectionName of collections) {
            const snapshot = await firestore.collection(collectionName).get();

            for (const doc of snapshot.docs) {
                const data = doc.data();
                const deliverySettings = {
                    deliveryEnabled: data.deliveryEnabled ?? true,
                    deliveryRadius: data.deliveryRadius ?? 5,
                    deliveryFeeType: data.deliveryFeeType ?? 'fixed',
                    deliveryFixedFee: data.deliveryFixedFee ?? 30,
                    deliveryPerKmFee: data.deliveryPerKmFee ?? 5,
                    deliveryFreeThreshold: data.deliveryFreeThreshold ?? 500,

                    // Payment Modes
                    deliveryOnlinePaymentEnabled: data.deliveryOnlinePaymentEnabled ?? true,
                    deliveryCodEnabled: data.deliveryCodEnabled ?? true,

                    migratedAt: new Date()
                };

                // Write to sub-collection
                await doc.ref.collection('delivery_settings').doc('config').set(deliverySettings, { merge: true });
                results.migrated++;
            }
        }

        return NextResponse.json({
            success: true,
            message: 'Delivery settings migration started',
            details: results
        });

    } catch (error) {
        console.error('Migration Error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
