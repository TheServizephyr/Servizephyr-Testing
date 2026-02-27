import { NextResponse } from 'next/server';
import admin from 'firebase-admin';
import { getFirestore } from '@/lib/firebase-admin';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';
import { PERMISSIONS } from '@/lib/permissions';
import { trackApiTelemetry } from '@/lib/opsTelemetry';

export async function GET(req) {
    const telemetryStartedAt = Date.now();
    let telemetryStatus = 200;
    let telemetryError = null;
    const respond = (payload, status = 200) => {
        telemetryStatus = status;
        return NextResponse.json(payload, { status });
    };

    try {
        const { businessSnap } = await verifyOwnerWithAudit(
            req,
            'read_open_items',
            { resource: 'manual_billing' },
            false,
            PERMISSIONS.MANUAL_BILLING.READ
        );

        if (!businessSnap?.exists) {
            return respond({ error: 'Business not found' }, 404);
        }

        const openItems = businessSnap.data()?.openItems || [];
        return respond({ items: openItems }, 200);
    } catch (error) {
        telemetryStatus = error?.status || 500;
        telemetryError = error?.message || 'Owner open-items GET failed';
        console.error('[GET /api/owner/open-items]', error);
        return respond(
            { error: error.message || 'Failed to fetch open items' },
            telemetryStatus
        );
    } finally {
        void trackApiTelemetry({
            endpoint: 'api.owner.open-items.get',
            durationMs: Date.now() - telemetryStartedAt,
            statusCode: telemetryStatus,
            errorMessage: telemetryError,
        });
    }
}

export async function POST(req) {
    try {
        const { businessId, collectionName } = await verifyOwnerWithAudit(
            req,
            'create_open_item',
            { resource: 'manual_billing' },
            false,
            PERMISSIONS.MANUAL_BILLING.WRITE
        );

        const body = await req.json();
        const { name, price } = body;

        if (!name?.trim()) {
            return NextResponse.json(
                { error: 'Item name is required' },
                { status: 400 }
            );
        }

        const itemPrice = parseFloat(price);
        if (!Number.isFinite(itemPrice) || itemPrice <= 0) {
            return NextResponse.json(
                { error: 'Price must be a positive number' },
                { status: 400 }
            );
        }

        const firestore = await getFirestore();
        const businessRef = firestore.collection(collectionName).doc(businessId);

        const payload = await firestore.runTransaction(async (tx) => {
            const businessSnap = await tx.get(businessRef);
            if (!businessSnap.exists) {
                throw Object.assign(new Error('Business not found'), { status: 404 });
            }

            const existingItems = Array.isArray(businessSnap.data()?.openItems) ? businessSnap.data().openItems : [];
            const normalizedName = name.trim().toLowerCase();
            const duplicate = existingItems.find((item) => {
                const existingName = String(item?.name || '').trim().toLowerCase();
                const existingPrice = Number(item?.price || 0);
                return existingName === normalizedName && existingPrice === itemPrice;
            });

            if (duplicate) {
                return { item: duplicate, duplicate: true };
            }

            const newItem = {
                id: `open-item-${Date.now()}`,
                name: name.trim(),
                price: itemPrice,
                createdAt: new Date(),
            };

            tx.update(businessRef, {
                openItems: admin.firestore.FieldValue.arrayUnion(newItem),
                // Keep menu caches in sync (custom bill/menu page use menuVersion for cache invalidation)
                menuVersion: admin.firestore.FieldValue.increment(1),
            });
            return { item: newItem, duplicate: false };
        });

        return NextResponse.json(payload, { status: payload.duplicate ? 200 : 201 });
    } catch (error) {
        console.error('[POST /api/owner/open-items]', error);
        return NextResponse.json(
            { error: error.message || 'Failed to create open item' },
            { status: error.status || 500 }
        );
    }
}

export async function DELETE(req) {
    try {
        const { businessId, collectionName } = await verifyOwnerWithAudit(
            req,
            'delete_open_item',
            { resource: 'manual_billing' },
            false,
            PERMISSIONS.MANUAL_BILLING.WRITE
        );

        const body = await req.json();
        const { itemId } = body;

        if (!itemId) {
            return NextResponse.json(
                { error: 'Item ID is required' },
                { status: 400 }
            );
        }

        const firestore = await getFirestore();
        const businessRef = firestore.collection(collectionName).doc(businessId);
        const businessSnap = await businessRef.get();
        if (!businessSnap.exists) {
            return NextResponse.json({ error: 'Business not found' }, { status: 404 });
        }

        const openItems = businessSnap.data()?.openItems || [];
        const itemToDelete = openItems.find(item => item.id === itemId);

        if (!itemToDelete) {
            return NextResponse.json(
                { error: 'Item not found' },
                { status: 404 }
            );
        }

        await businessRef.update({
            openItems: admin.firestore.FieldValue.arrayRemove(itemToDelete),
            // Keep menu caches in sync (custom bill/menu page use menuVersion for cache invalidation)
            menuVersion: admin.firestore.FieldValue.increment(1),
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[DELETE /api/owner/open-items]', error);
        return NextResponse.json(
            { error: error.message || 'Failed to delete open item' },
            { status: error.status || 500 }
        );
    }
}
