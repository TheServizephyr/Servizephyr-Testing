import { NextResponse } from 'next/server';
import { FieldValue } from '@/lib/firebase-admin';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';
import { PERMISSIONS } from '@/lib/permissions';
import {
    INVENTORY_COLLECTION,
    INVENTORY_LEDGER_COLLECTION,
    calculateAvailable,
    normalizeAdjustmentReason,
    toFiniteNumber,
} from '@/lib/server/inventory';

export const dynamic = 'force-dynamic';

export async function POST(req) {
    try {
        const context = await verifyOwnerWithAudit(
            req,
            'adjust_inventory',
            {},
            false,
            PERMISSIONS.EDIT_MENU
        );
        const { businessSnap, callerRole, uid, adminId } = context;

        const body = await req.json();
        const itemId = String(body?.itemId || '').trim();
        const qtyDelta = toFiniteNumber(body?.qtyDelta, NaN);
        const reason = normalizeAdjustmentReason(body?.reason);
        const note = String(body?.note || '').trim().slice(0, 200);

        if (!itemId) {
            return NextResponse.json({ message: 'itemId is required.' }, { status: 400 });
        }
        if (!Number.isFinite(qtyDelta) || qtyDelta === 0) {
            return NextResponse.json({ message: 'qtyDelta must be a non-zero number.' }, { status: 400 });
        }

        const actorId = String(adminId || uid);
        const inventoryRef = businessSnap.ref.collection(INVENTORY_COLLECTION).doc(itemId);
        const ledgerRef = businessSnap.ref.collection(INVENTORY_LEDGER_COLLECTION).doc();

        const result = await businessSnap.ref.firestore.runTransaction(async (transaction) => {
            const inventorySnap = await transaction.get(inventoryRef);
            if (!inventorySnap.exists) {
                throw { status: 404, message: 'Inventory item not found. Sync items first.' };
            }

            const current = inventorySnap.data() || {};
            const beforeOnHand = toFiniteNumber(current.stockOnHand, 0);
            const reserved = toFiniteNumber(current.reserved, 0);
            const afterOnHand = beforeOnHand + qtyDelta;

            if (afterOnHand < 0) {
                throw { status: 400, message: 'Adjustment would make stock negative.' };
            }

            const available = calculateAvailable(afterOnHand, reserved);

            transaction.update(inventoryRef, {
                stockOnHand: afterOnHand,
                available,
                updatedAt: FieldValue.serverTimestamp(),
                lastAdjustedAt: FieldValue.serverTimestamp(),
                lastAdjustedBy: actorId,
            });

            transaction.set(ledgerRef, {
                itemId,
                sku: current.sku || null,
                name: current.name || null,
                type: reason,
                qtyDelta,
                before: {
                    stockOnHand: beforeOnHand,
                    reserved,
                    available: toFiniteNumber(current.available, calculateAvailable(beforeOnHand, reserved)),
                },
                after: {
                    stockOnHand: afterOnHand,
                    reserved,
                    available,
                },
                note: note || null,
                actorId,
                actorRole: callerRole || 'owner',
                createdAt: FieldValue.serverTimestamp(),
            });

            return {
                itemId,
                stockOnHand: afterOnHand,
                reserved,
                available,
            };
        });

        return NextResponse.json(
            {
                message: 'Inventory adjusted successfully.',
                item: result,
            },
            { status: 200 }
        );
    } catch (error) {
        console.error('[Inventory API] Adjust failed:', error);
        return NextResponse.json(
            { message: error.message || 'Failed to adjust inventory.' },
            { status: error.status || 500 }
        );
    }
}
