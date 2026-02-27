
import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

function generateDisplayId(prefix, timestamp) {
    let date = new Date(); // Default to now if missing
    if (timestamp) {
        if (typeof timestamp.toDate === 'function') {
            date = timestamp.toDate();
        } else if (timestamp.seconds) {
            date = new Date(timestamp.seconds * 1000);
        } else {
            const parsed = new Date(timestamp);
            if (!isNaN(parsed.getTime())) date = parsed;
        }
    }

    const yy = String(date.getFullYear()).slice(-2);
    const MM = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const HH = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');

    // Pattern: YYMMDDHHmm + 2 random digits
    const rr = Math.floor(10 + Math.random() * 90).toString();

    return `${prefix}${yy}${MM}${dd}${HH}${mm}${rr}`;
}

export async function GET(req) {
    try {
        const { verifyAdmin } = await import('@/lib/verify-admin');
        await verifyAdmin(req);

        const firestore = await getFirestore();
        const batchSize = 100; // Process in chunks if needed, but for now simple loop with Promise.all for batch commits
        const writeStats = { users: 0, restaurants: 0, shops: 0, vendors: 0 };

        // 1. Process USERS (Customers)
        console.log("Starting Migration: USERS...");
        const usersSnap = await firestore.collection('users').get();
        const userUpdates = [];

        usersSnap.forEach(doc => {
            const data = doc.data();
            const newId = generateDisplayId('CS_', data.createdAt || data.created_at);
            userUpdates.push(doc.ref.update({ customerId: newId }));
            writeStats.users++;
        });

        await Promise.all(userUpdates);
        console.log(`Updated ${userUpdates.length} users.`);

        // 2. Process RESTAURANTS
        console.log("Starting Migration: RESTAURANTS...");
        const restSnap = await firestore.collection('restaurants').get();
        const restUpdates = [];

        restSnap.forEach(doc => {
            const data = doc.data();
            const newId = generateDisplayId('RS_', data.createdAt || data.created_at);
            restUpdates.push(doc.ref.update({ merchantId: newId }));
            writeStats.restaurants++;
        });

        await Promise.all(restUpdates);

        // 3. Process SHOPS
        console.log("Starting Migration: SHOPS...");
        const shopSnap = await firestore.collection('shops').get();
        const shopUpdates = [];

        shopSnap.forEach(doc => {
            const data = doc.data();
            const newId = generateDisplayId('RS_', data.createdAt || data.created_at);
            shopUpdates.push(doc.ref.update({ merchantId: newId }));
            writeStats.shops++;
        });

        await Promise.all(shopUpdates);

        // 4. Process STREET VENDORS
        console.log("Starting Migration: STREET VENDORS...");
        const vendorSnap = await firestore.collection('street_vendors').get();
        const vendorUpdates = [];

        vendorSnap.forEach(doc => {
            const data = doc.data();
            const newId = generateDisplayId('RS_', data.createdAt || data.created_at);
            vendorUpdates.push(doc.ref.update({ merchantId: newId }));
            writeStats.vendors++;
        });

        await Promise.all(vendorUpdates);

        return NextResponse.json({
            message: 'Migration Complete',
            stats: writeStats
        });

    } catch (error) {
        console.error("Migration Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
