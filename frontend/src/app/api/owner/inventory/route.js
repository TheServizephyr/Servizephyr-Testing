import { NextResponse } from 'next/server';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';
import { PERMISSIONS } from '@/lib/permissions';
import {
    INVENTORY_COLLECTION,
    calculateAvailable,
    normalizeSearchValue,
} from '@/lib/server/inventory';

export const dynamic = 'force-dynamic';

function normalizeBusinessType(value, collectionName) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'street_vendor') return 'street-vendor';
    if (normalized === 'shop' || normalized === 'store') return 'store';
    if (normalized === 'street-vendor' || normalized === 'restaurant') {
        return normalized;
    }
    if (collectionName === 'shops') return 'store';
    if (collectionName === 'street_vendors') return 'street-vendor';
    return 'restaurant';
}

export async function GET(req) {
    try {
        const context = await verifyOwnerWithAudit(
            req,
            'view_inventory',
            {},
            false,
            PERMISSIONS.VIEW_MENU
        );
        const { businessId, businessSnap, collectionName } = context;

        const { searchParams } = new URL(req.url);
        const limitParam = Number(searchParams.get('limit') || 50);
        const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50;
        const cursor = String(searchParams.get('cursor') || '').trim();
        const q = normalizeSearchValue(searchParams.get('q'));

        const inventoryRef = businessSnap.ref.collection(INVENTORY_COLLECTION);
        let inventoryQuery;

        if (q) {
            inventoryQuery = inventoryRef
                .where('searchTokens', 'array-contains', q)
                .limit(limit);
        } else {
            inventoryQuery = inventoryRef
                .orderBy('updatedAt', 'desc')
                .limit(limit);

            if (cursor) {
                const cursorDoc = await inventoryRef.doc(cursor).get();
                if (cursorDoc.exists) {
                    inventoryQuery = inventoryQuery.startAfter(cursorDoc);
                }
            }
        }

        const snapshot = await inventoryQuery.get();
        const items = snapshot.docs.map((doc) => {
            const data = doc.data() || {};
            const stockOnHand = Number(data.stockOnHand || 0);
            const reserved = Number(data.reserved || 0);
            return {
                id: doc.id,
                ...data,
                stockOnHand,
                reserved,
                available: Number.isFinite(Number(data.available))
                    ? Number(data.available)
                    : calculateAvailable(stockOnHand, reserved),
            };
        });

        const nextCursor = !q && snapshot.size === limit && snapshot.docs.length > 0
            ? snapshot.docs[snapshot.docs.length - 1].id
            : null;

        return NextResponse.json(
            {
                items,
                nextCursor,
                businessId,
                businessType: normalizeBusinessType(businessSnap.data()?.businessType, collectionName),
            },
            { status: 200 }
        );
    } catch (error) {
        console.error('[Inventory API] GET failed:', error);
        return NextResponse.json(
            { message: error.message || 'Failed to load inventory.' },
            { status: error.status || 500 }
        );
    }
}
