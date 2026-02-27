import { NextResponse } from 'next/server';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';
import { PERMISSIONS } from '@/lib/permissions';
import {
    INVENTORY_COLLECTION,
    RESERVED_OPEN_ITEMS_CATEGORY_ID,
    createInventoryPayloadFromMenuItem,
} from '@/lib/server/inventory';

export const dynamic = 'force-dynamic';

const WRITE_BATCH_SIZE = 400;

async function commitInChunks(firestore, writes) {
    let committed = 0;
    for (let i = 0; i < writes.length; i += WRITE_BATCH_SIZE) {
        const batch = firestore.batch();
        writes.slice(i, i + WRITE_BATCH_SIZE).forEach(({ ref, data }) => {
            batch.set(ref, data, { merge: true });
        });
        await batch.commit();
        committed += Math.min(WRITE_BATCH_SIZE, writes.length - i);
    }
    return committed;
}

export async function POST(req) {
    try {
        const context = await verifyOwnerWithAudit(
            req,
            'sync_inventory_from_menu',
            {},
            false,
            PERMISSIONS.EDIT_MENU
        );
        const { businessSnap, collectionName, businessId } = context;

        const firestore = businessSnap.ref.firestore;
        const menuRef = businessSnap.ref.collection('menu');
        const inventoryRef = businessSnap.ref.collection(INVENTORY_COLLECTION);

        const [menuSnapshot, inventorySnapshot] = await Promise.all([
            menuRef.get(),
            inventoryRef.get(),
        ]);

        const existingInventoryById = new Map(
            inventorySnapshot.docs.map((doc) => [doc.id, doc.data() || {}])
        );

        const writes = [];
        let created = 0;
        let updated = 0;
        let skipped = 0;

        menuSnapshot.docs.forEach((menuDoc) => {
            const menuItem = menuDoc.data() || {};
            if (menuItem.isDeleted === true) {
                skipped += 1;
                return;
            }
            const categoryId = String(menuItem.categoryId || '').trim().toLowerCase();
            if (categoryId === RESERVED_OPEN_ITEMS_CATEGORY_ID) {
                skipped += 1;
                return;
            }

            const existingInventory = existingInventoryById.get(menuDoc.id) || null;
            const payload = createInventoryPayloadFromMenuItem(menuDoc, existingInventory);
            writes.push({ ref: inventoryRef.doc(menuDoc.id), data: payload });
            if (existingInventory) {
                updated += 1;
            } else {
                created += 1;
            }
        });

        if (writes.length > 0) {
            await commitInChunks(firestore, writes);
        }

        return NextResponse.json(
            {
                message: 'Inventory synced from menu successfully.',
                businessId,
                collectionName,
                processed: writes.length,
                created,
                updated,
                skipped,
                menuItemsScanned: menuSnapshot.size,
            },
            { status: 200 }
        );
    } catch (error) {
        console.error('[Inventory API] Sync failed:', error);
        return NextResponse.json(
            { message: error.message || 'Failed to sync inventory from menu.' },
            { status: error.status || 500 }
        );
    }
}
