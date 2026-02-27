import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

const toIso = (value) => {
    if (!value) return null;
    if (typeof value?.toDate === 'function') return value.toDate().toISOString();
    if (value instanceof Date) return value.toISOString();
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const pickTimestamp = (data, fields) => {
    for (const field of fields) {
        const iso = toIso(data?.[field]);
        if (iso) return iso;
    }
    return null;
};

const normalizeAddress = (address = {}) => ({
    full: address.full || [
        address.street,
        address.area,
        address.city,
        address.state,
        address.postalCode,
        address.country
    ].filter(Boolean).join(', '),
    ...address
});

const normalizeRole = (data = {}) => {
    if (data.role === 'admin' || data.isAdmin) return 'Admin';
    if (data.businessType === 'restaurant' || data.role === 'owner') return 'Owner';
    if (data.businessType === 'shop' || data.businessType === 'store') return 'Store Owner';
    if (data.businessType === 'street-vendor' || data.businessType === 'street_vendor') return 'Street Vendor';
    if (data.role === 'rider' || data.role === 'delivery') return 'Rider';
    return 'Customer';
};

export async function GET(req, { params }) {
    try {
        const { verifyAdmin } = await import('@/lib/verify-admin');
        await verifyAdmin(req);

        const firestore = await getFirestore();
        const { userId } = params;
        const { searchParams } = new URL(req.url);
        const userType = searchParams.get('userType') || 'user';

        if (!userId) {
            return NextResponse.json({ message: 'userId is required' }, { status: 400 });
        }

        let profile = null;
        let raw = null;
        let role = 'Customer';

        if (userType === 'guest') {
            const guestDoc = await firestore.collection('guest_profiles').doc(userId).get();
            if (!guestDoc.exists) {
                return NextResponse.json({ message: 'Guest profile not found' }, { status: 404 });
            }
            raw = guestDoc.data() || {};
            role = 'Guest Customer';
            profile = {
                id: guestDoc.id,
                userType: 'guest',
                name: raw.name || `Guest ${String(raw.phone || guestDoc.id).slice(-4)}`,
                email: raw.email || 'Guest (No Email)',
                phone: raw.phone || 'No Phone',
                status: raw.status === 'Blocked' || raw.blocked ? 'Blocked' : 'Active',
                role,
                joinDate: pickTimestamp(raw, ['createdAt']) || 'Unknown',
                addresses: Array.isArray(raw.addresses) ? raw.addresses.map(normalizeAddress) : [],
                profilePictureUrl: raw.profilePictureUrl || '',
            };
        } else {
            const userDoc = await firestore.collection('users').doc(userId).get();
            if (!userDoc.exists) {
                return NextResponse.json({ message: 'User not found' }, { status: 404 });
            }
            raw = userDoc.data() || {};
            role = normalizeRole(raw);
            profile = {
                id: userDoc.id,
                userType: 'user',
                name: raw.name || 'Unnamed User',
                email: raw.email || 'No Email',
                phone: raw.phone || raw.phoneNumber || 'No Phone',
                status: raw.status || 'Active',
                role,
                joinDate: pickTimestamp(raw, ['createdAt', 'created_at', 'registeredAt', 'timestamp', 'joinedAt']) || 'Unknown',
                addresses: Array.isArray(raw.addresses) ? raw.addresses.map(normalizeAddress) : [],
                profilePictureUrl: raw.profilePictureUrl || '',
            };
        }

        // Activity from orders
        let ordersSnap;
        try {
            ordersSnap = await firestore
                .collection('orders')
                .where('userId', '==', userId)
                .orderBy('orderDate', 'desc')
                .limit(50)
                .get();
        } catch (_) {
            ordersSnap = await firestore
                .collection('orders')
                .where('userId', '==', userId)
                .limit(50)
                .get();
        }

        const activity = ordersSnap.docs
            .map((doc) => {
                const data = doc.data() || {};
                const orderDate = pickTimestamp(data, ['orderDate', 'createdAt', 'updatedAt']);
                return {
                    orderId: doc.id,
                    customerOrderId: data.customerOrderId || null,
                    status: data.status || 'unknown',
                    orderDate,
                    totalAmount: data.grandTotal ?? data.totalAmount ?? data.subtotal ?? 0,
                    restaurantId: data.restaurantId || '',
                    deliveryType: data.deliveryType || 'delivery',
                };
            })
            .sort((a, b) => new Date(b.orderDate || 0) - new Date(a.orderDate || 0));

        // If no saved profile addresses, fallback from latest order customer.address
        if (profile.addresses.length === 0 && activity.length > 0) {
            const latestOrderDoc = ordersSnap.docs.find((d) => d.id === activity[0].orderId) || ordersSnap.docs[0];
            const latestData = latestOrderDoc?.data() || {};
            const customerAddress = latestData.customer?.address || latestData.address;
            if (customerAddress) {
                profile.addresses = [normalizeAddress(customerAddress)];
            }
        }

        const lastOrderCustomerOrderId = activity[0]?.customerOrderId || null;
        const profileLastActivity =
            pickTimestamp(raw, ['lastActivityAt', 'lastSeen', 'updatedAt', 'lastLoginAt', 'lastOrderAt']) ||
            null;
        const lastActivity = activity[0]?.orderDate || profileLastActivity || profile.joinDate;

        return NextResponse.json({
            user: {
                ...profile,
                totalOrders: activity.length,
                lastActivity,
                lastOrderCustomerOrderId,
            },
            activity,
        }, { status: 200 });
    } catch (error) {
        console.error('GET /api/admin/users/[userId] ERROR:', error);
        return NextResponse.json({ message: 'Internal Server Error', error: error.message }, { status: 500 });
    }
}

