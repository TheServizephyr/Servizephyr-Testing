
import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function POST(req) {
    try {
        const { verifyAdmin } = await import('@/lib/verify-admin');
        await verifyAdmin(req);

        const firestore = await getFirestore();
        const results = {
            cleaned: 0,
            checked: 0,
            errors: []
        };

        const collections = ['restaurants', 'shops', 'street_vendors'];

        for (const collectionName of collections) {
            const snapshot = await firestore.collection(collectionName).get();

            for (const doc of snapshot.docs) {
                results.checked++;
                const data = doc.data();

                // Only clean if fields exist
                if (data.deliveryFeeType !== undefined || data.deliveryRadius !== undefined) {

                    // Verify sub-collection exists before deleting?
                    const configRef = doc.ref.collection('delivery_settings').doc('config');
                    const configSnap = await configRef.get();

                    if (configSnap.exists) {
                        await doc.ref.update({
                            deliveryEnabled: FieldValue.delete(),
                            deliveryRadius: FieldValue.delete(),
                            deliveryFeeType: FieldValue.delete(),
                            deliveryFixedFee: FieldValue.delete(),
                            deliveryPerKmFee: FieldValue.delete(),
                            deliveryFreeThreshold: FieldValue.delete(),
                            deliveryOnlinePaymentEnabled: FieldValue.delete(),
                            deliveryCodEnabled: FieldValue.delete()
                        });
                        results.cleaned++;
                    } else {
                        results.errors.push(`Skipped ${doc.id}: Sub-collection missing`);
                    }
                }
            }
        }

        return NextResponse.json({
            success: true,
            message: 'Delivery settings cleanup completed',
            details: results
        });

    } catch (error) {
        console.error('Cleanup Error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
