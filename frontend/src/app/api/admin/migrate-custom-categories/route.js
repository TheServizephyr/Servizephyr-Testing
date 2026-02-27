import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { verifyAdmin } from '@/lib/verify-admin';

export const dynamic = 'force-dynamic';

export async function POST(req) {
    try {
        await verifyAdmin(req);
        const firestore = await getFirestore();
        const results = {
            processed: 0,
            migrated_items: 0,
            errors: []
        };

        const collections = ['restaurants', 'shops', 'street_vendors'];

        for (const collectionName of collections) {
            const snapshot = await firestore.collection(collectionName).get();

            for (const doc of snapshot.docs) {
                results.processed++;
                const data = doc.data();

                if (data.customCategories && Array.isArray(data.customCategories) && data.customCategories.length > 0) {
                    const batch = firestore.batch();
                    const subCollRef = doc.ref.collection('custom_categories');

                    let order = 1;
                    for (const cat of data.customCategories) {
                        if (cat.id && cat.title) {
                            // Use cat.id as document ID
                            const newDocRef = subCollRef.doc(cat.id);
                            batch.set(newDocRef, {
                                id: cat.id,
                                title: cat.title,
                                order: order++,
                                migratedAt: new Date()
                            }, { merge: true });
                            results.migrated_items++;
                        }
                    }

                    await batch.commit();
                }
            }
        }

        return NextResponse.json({
            success: true,
            message: 'Custom Categories migration completed',
            details: results
        });

    } catch (error) {
        console.error('Migration Error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
