
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

                // Only clean if field exists
                if (data.customCategories !== undefined) {

                    // Allow simple check: if existing sub-collection has data, we assume safe to delete.
                    // Or we just proceed if migration ran.
                    const subColSnap = await doc.ref.collection('custom_categories').limit(1).get();

                    // If subcollection has docs OR the array was empty/null, we clean.
                    if (!subColSnap.empty || !data.customCategories || data.customCategories.length === 0) {
                        await doc.ref.update({
                            customCategories: FieldValue.delete()
                        });
                        results.cleaned++;
                    } else {
                        results.errors.push(`Skipped ${doc.id}: Sub-collection empty but array had data?`);
                    }
                }
            }
        }

        return NextResponse.json({
            success: true,
            message: 'Custom Categories cleanup completed',
            details: results
        });

    } catch (error) {
        console.error('Cleanup Error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
