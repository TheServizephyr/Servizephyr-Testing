import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

// Admin endpoint to clean up stale tabs and recalculate table occupancy
export async function POST(req) {
    try {
        const { restaurantId, dryRun = true } = await req.json();

        if (!restaurantId) {
            return NextResponse.json({ message: 'Restaurant ID required' }, { status: 400 });
        }

        const firestore = await getFirestore();

        // Try restaurants first, then shops
        let businessRef = firestore.collection('restaurants').doc(restaurantId);
        let businessSnap = await businessRef.get();

        if (!businessSnap.exists) {
            businessRef = firestore.collection('shops').doc(restaurantId);
            businessSnap = await businessRef.get();
        }

        if (!businessSnap.exists) {
            return NextResponse.json({ message: 'Business not found' }, { status: 404 });
        }

        const results = {
            tabsFound: 0,
            staleTabsDeleted: 0,
            tablesUpdated: 0,
            details: []
        };

        // Get all dine-in tabs
        const tabsSnap = await businessRef.collection('dineInTabs').get();
        results.tabsFound = tabsSnap.size;

        const staleTabs = [];
        const validTabs = {};

        for (const tabDoc of tabsSnap.docs) {
            const tabData = tabDoc.data();
            const tableId = tabData.tableId;

            // Check if tab has any orders in last 24 hours
            const ordersSnap = await firestore.collection('orders')
                .where('dineInTabId', '==', tabData.id)
                .where('createdAt', '>', new Date(Date.now() - 24 * 60 * 60 * 1000))
                .limit(1)
                .get();

            const hasRecentOrders = !ordersSnap.empty;

            // Mark as stale if:
            // 1. Status is 'inactive' AND no recent orders
            // 2. Status is 'active' AND no recent orders
            if (!hasRecentOrders && (tabData.status === 'inactive' || tabData.status === 'active')) {
                staleTabs.push({
                    id: tabData.id,
                    tableId,
                    tab_name: tabData.tab_name,
                    pax_count: tabData.pax_count,
                    status: tabData.status,
                    createdAt: tabData.createdAt?.toDate()
                });
            } else {
                // Valid tab - track for table recalculation
                if (!validTabs[tableId]) validTabs[tableId] = [];
                validTabs[tableId].push(tabData);
            }
        }

        results.details = staleTabs;

        if (!dryRun) {
            // Delete stale tabs
            const batch = firestore.batch();

            for (const tab of staleTabs) {
                const tabRef = businessRef.collection('dineInTabs').doc(tab.id);
                batch.delete(tabRef);
            }

            // Recalculate table occupancy
            const tablesSnap = await businessRef.collection('tables').get();

            for (const tableDoc of tablesSnap.docs) {
                const tableId = tableDoc.id;
                const validTabsForTable = validTabs[tableId] || [];
                const current_pax = validTabsForTable.reduce((sum, tab) => sum + (tab.pax_count || 0), 0);

                const tableRef = businessRef.collection('tables').doc(tableId);
                batch.update(tableRef, {
                    current_pax,
                    state: current_pax >= tableDoc.data().max_capacity ? 'full' :
                        (current_pax > 0 ? 'occupied' : 'available')
                });
                results.tablesUpdated++;
            }

            await batch.commit();
            results.staleTabsDeleted = staleTabs.length;
        }

        return NextResponse.json({
            message: dryRun ? 'Dry run completed (no changes made)' : 'Cleanup completed',
            dryRun,
            results
        }, { status: 200 });

    } catch (error) {
        console.error('[Cleanup Stale Tabs] Error:', error);
        return NextResponse.json({
            message: 'Internal Server Error',
            error: error.message
        }, { status: 500 });
    }
}
