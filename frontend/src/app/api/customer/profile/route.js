import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

const DEFAULT_NOTIFICATIONS = {
    orderUpdates: true,
    promotions: true,
    communityAlerts: false,
};

const normalizePhone = (value) => {
    const digits = String(value || '').replace(/\D/g, '');
    return digits ? digits.slice(-10) : '';
};

const buildProfilePayload = (userData = {}) => {
    const storedNotifications = userData?.customerPreferences?.notifications || {};

    return {
        name: userData.name || '',
        email: userData.email || '',
        phone: normalizePhone(userData.phone),
        profilePicture: userData.profilePictureUrl || userData.profilePicture || '',
        customerId: userData.customerId || '',
        notifications: {
            ...DEFAULT_NOTIFICATIONS,
            ...storedNotifications,
        },
    };
};

export async function GET(req) {
    try {
        const uid = await verifyAndGetUid(req);
        const firestore = await getFirestore();

        const userDoc = await firestore.collection('users').doc(uid).get();
        if (!userDoc.exists) {
            return NextResponse.json({ message: 'User profile not found.' }, { status: 404 });
        }

        return NextResponse.json(buildProfilePayload(userDoc.data()), { status: 200 });
    } catch (error) {
        if (error.status) {
            return NextResponse.json({ message: error.message }, { status: error.status });
        }
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}

export async function PATCH(req) {
    try {
        const uid = await verifyAndGetUid(req);
        const firestore = await getFirestore();
        const body = await req.json();

        const updateData = {};

        if (Object.prototype.hasOwnProperty.call(body, 'name')) {
            const name = String(body.name || '').trim();
            if (!name) {
                return NextResponse.json({ message: 'Name cannot be empty.' }, { status: 400 });
            }
            updateData.name = name;
        }

        if (Object.prototype.hasOwnProperty.call(body, 'phone')) {
            const normalizedPhone = normalizePhone(body.phone);
            if (normalizedPhone.length !== 10) {
                return NextResponse.json({ message: 'Phone must be a valid 10-digit number.' }, { status: 400 });
            }
            updateData.phone = normalizedPhone;
        }

        if (body.notifications && typeof body.notifications === 'object') {
            const sanitizedNotifications = {};
            for (const key of Object.keys(DEFAULT_NOTIFICATIONS)) {
                if (typeof body.notifications[key] === 'boolean') {
                    sanitizedNotifications[key] = body.notifications[key];
                }
            }
            if (Object.keys(sanitizedNotifications).length > 0) {
                updateData['customerPreferences.notifications'] = sanitizedNotifications;
            }
        }

        if (Object.keys(updateData).length === 0) {
            return NextResponse.json({ message: 'No valid profile updates provided.' }, { status: 400 });
        }

        updateData.updatedAt = FieldValue.serverTimestamp();

        const userRef = firestore.collection('users').doc(uid);
        await userRef.set(updateData, { merge: true });

        const updatedDoc = await userRef.get();
        return NextResponse.json(buildProfilePayload(updatedDoc.data()), { status: 200 });
    } catch (error) {
        if (error.status) {
            return NextResponse.json({ message: error.message }, { status: error.status });
        }
        if (error instanceof SyntaxError) {
            return NextResponse.json({ message: 'Invalid request body.' }, { status: 400 });
        }
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}

