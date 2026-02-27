import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';
import { PERMISSIONS } from '@/lib/permissions';

const toIsoString = (value) => {
    if (value?.toDate && typeof value.toDate === 'function') {
        return value.toDate().toISOString();
    }
    return null;
};

const normalizeSpotId = (spotLabel) => {
    return String(spotLabel || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40);
};

const toSpotPayload = (doc, businessId) => {
    const data = doc.data() || {};
    const safeSpotLabel = String(data.spotLabel || doc.id).trim();
    return {
        id: doc.id,
        spotLabel: safeSpotLabel,
        spotCode: data.spotCode || doc.id,
        isActive: data.isActive !== false,
        orderPath: data.orderPath || `/order/${businessId}?orderType=car&spot=${encodeURIComponent(safeSpotLabel)}`,
        createdAt: toIsoString(data.createdAt),
        updatedAt: toIsoString(data.updatedAt)
    };
};

async function getBusinessRef(req, action, requiredPermissions) {
    const { businessSnap } = await verifyOwnerWithAudit(
        req,
        action,
        {},
        false,
        requiredPermissions
    );

    if (!businessSnap || !businessSnap.exists) {
        throw { message: 'Business not found.', status: 404 };
    }

    return businessSnap.ref;
}

export async function GET(req) {
    try {
        const businessRef = await getBusinessRef(
            req,
            'fetch_car_spot_qrs',
            [PERMISSIONS.VIEW_DINE_IN_ORDERS, PERMISSIONS.MANAGE_DINE_IN]
        );

        const spotsSnap = await businessRef
            .collection('carSpots')
            .orderBy('updatedAt', 'desc')
            .get();

        const spots = spotsSnap.docs
            .map((doc) => toSpotPayload(doc, businessRef.id))
            .filter((spot) => spot.isActive !== false);

        return NextResponse.json({ spots }, { status: 200 });
    } catch (error) {
        console.error('[API owner/car-spots] GET error:', error);
        return NextResponse.json(
            { message: error?.message || 'Failed to fetch car spots.' },
            { status: error?.status || 500 }
        );
    }
}

export async function POST(req) {
    try {
        const firestore = await getFirestore();
        const businessRef = await getBusinessRef(
            req,
            'save_car_spot_qr',
            PERMISSIONS.MANAGE_DINE_IN
        );

        const body = await req.json();
        const rawSpotLabel = String(body?.spotLabel || '').trim();

        if (!rawSpotLabel) {
            return NextResponse.json({ message: 'Spot label is required.' }, { status: 400 });
        }

        const safeSpotLabel = rawSpotLabel.slice(0, 60);
        const spotId = normalizeSpotId(safeSpotLabel);

        if (!spotId) {
            return NextResponse.json({ message: 'Spot label is invalid.' }, { status: 400 });
        }

        const spotRef = businessRef.collection('carSpots').doc(spotId);
        const existingSpotSnap = await spotRef.get();

        const now = FieldValue.serverTimestamp();
        const payload = {
            id: spotId,
            spotLabel: safeSpotLabel,
            spotCode: spotId,
            isActive: true,
            orderPath: `/order/${businessRef.id}?orderType=car&spot=${encodeURIComponent(safeSpotLabel)}`,
            updatedAt: now
        };

        if (!existingSpotSnap.exists) {
            payload.createdAt = now;
        }

        await spotRef.set(payload, { merge: true });

        const savedSpotSnap = await spotRef.get();
        const savedSpot = toSpotPayload(savedSpotSnap, businessRef.id);

        return NextResponse.json(
            {
                message: existingSpotSnap.exists ? 'Car spot QR updated.' : 'Car spot QR saved.',
                spot: savedSpot
            },
            { status: existingSpotSnap.exists ? 200 : 201 }
        );
    } catch (error) {
        console.error('[API owner/car-spots] POST error:', error);
        return NextResponse.json(
            { message: error?.message || 'Failed to save car spot QR.' },
            { status: error?.status || 500 }
        );
    }
}

export async function DELETE(req) {
    try {
        const businessRef = await getBusinessRef(
            req,
            'delete_car_spot_qr',
            PERMISSIONS.MANAGE_DINE_IN
        );

        const body = await req.json();
        const spotId = normalizeSpotId(body?.spotId || body?.spotCode || '');

        if (!spotId) {
            return NextResponse.json({ message: 'Spot ID is required.' }, { status: 400 });
        }

        const spotRef = businessRef.collection('carSpots').doc(spotId);
        const spotSnap = await spotRef.get();

        if (!spotSnap.exists) {
            return NextResponse.json({ message: 'Car spot not found.' }, { status: 404 });
        }

        await spotRef.delete();

        return NextResponse.json({ message: 'Car spot QR deleted.' }, { status: 200 });
    } catch (error) {
        console.error('[API owner/car-spots] DELETE error:', error);
        return NextResponse.json(
            { message: error?.message || 'Failed to delete car spot QR.' },
            { status: error?.status || 500 }
        );
    }
}
