
import { NextResponse } from 'next/server';
import { getFirestore, getAuth } from '@/lib/firebase-admin';

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

const firstAddressText = (addresses) => {
    if (!Array.isArray(addresses) || addresses.length === 0) return 'No Address';
    const addr = addresses[0] || {};
    return addr.full || [
        addr.street,
        addr.area,
        addr.city,
        addr.state,
        addr.postalCode,
        addr.country
    ].filter(Boolean).join(', ') || 'No Address';
};

export async function GET(req) {
    try {
        const { verifyAdmin } = await import('@/lib/verify-admin');
        await verifyAdmin(req);

        const firestore = await getFirestore();
        const [usersSnap, guestProfilesSnap] = await Promise.all([
            firestore.collection('users').get(),
            firestore.collection('guest_profiles').get()
        ]);

        const users = usersSnap.docs.map((doc) => {
            const data = doc.data();
            if (data.isDeleted) return null;

            // Determine user role based on businessType and role fields
            let userRole = 'Customer'; // Default

            if (data.role === 'admin' || data.isAdmin) {
                userRole = 'Admin';
            } else if (data.businessType === 'restaurant') {
                userRole = 'Owner';
            } else if (data.businessType === 'shop' || data.businessType === 'store') {
                userRole = 'Store Owner';
            } else if (data.businessType === 'street-vendor' || data.businessType === 'street_vendor') {
                userRole = 'Street Vendor';
            } else if (data.role === 'rider' || data.role === 'delivery') {
                userRole = 'Rider';
            } else if (data.role === 'owner') {
                userRole = 'Owner';
            } else if (data.role) {
                userRole = data.role.charAt(0).toUpperCase() + data.role.slice(1);
            }

            const joinDate = pickTimestamp(data, ['createdAt', 'created_at', 'registeredAt', 'timestamp', 'joinedAt']) || 'Unknown';
            const lastActivity = pickTimestamp(data, ['lastActivityAt', 'lastSeen', 'updatedAt', 'lastLoginAt', 'lastOrderAt']) || joinDate;
            const address = firstAddressText(data.addresses);

            return {
                id: doc.id,
                userType: 'user',
                name: data.name || 'Unnamed User',
                email: data.email || 'No Email',
                phone: data.phone || data.phoneNumber || 'No Phone',
                role: userRole,
                joinDate: joinDate,
                status: data.status || 'Active',
                profilePictureUrl: data.profilePictureUrl,
                address,
                lastActivity
            };
        });

        const guestUsers = await Promise.all(
            guestProfilesSnap.docs.map(async (doc) => {
                const data = doc.data() || {};

                if (data.isDeleted) return null;

                const joinDate = pickTimestamp(data, ['createdAt']) || 'Unknown';
                let lastActivity = pickTimestamp(data, ['lastActivityAt', 'lastSeen', 'updatedAt', 'lastOrderAt']) || null;

                // Fallback to latest order time if profile doesn't track activity timestamp.
                if (!lastActivity) {
                    try {
                        const lastOrderByDate = await firestore
                            .collection('orders')
                            .where('userId', '==', doc.id)
                            .orderBy('orderDate', 'desc')
                            .limit(1)
                            .get();
                        if (!lastOrderByDate.empty) {
                            const orderData = lastOrderByDate.docs[0].data();
                            lastActivity = pickTimestamp(orderData, ['orderDate', 'createdAt', 'updatedAt']);
                        }
                    } catch (_) {
                        // Keep null if no index/order data; we still show profile.
                    }
                }

                const normalizedStatus = data.status === 'Blocked' || data.blocked ? 'Blocked' : 'Active';
                const phone = data.phone || 'No Phone';
                const suffix = phone !== 'No Phone' ? String(phone).slice(-4) : String(doc.id).slice(-4);

                return {
                    id: doc.id,
                    userType: 'guest',
                    name: data.name || `Guest ${suffix}`,
                    email: data.email || 'Guest (No Email)',
                    phone,
                    role: 'Guest Customer',
                    joinDate,
                    status: normalizedStatus,
                    profilePictureUrl: data.profilePictureUrl || '',
                    address: firstAddressText(data.addresses),
                    lastActivity: lastActivity || joinDate
                };
            })
        );

        const mergedUsers = [...users.filter(Boolean), ...guestUsers.filter(Boolean)];

        // Sort by join date - latest first, invalid dates at the end
        mergedUsers.sort((a, b) => {
            const dateA = new Date(a.joinDate);
            const dateB = new Date(b.joinDate);

            const isValidA = !isNaN(dateA.getTime()) && a.joinDate !== 'Unknown';
            const isValidB = !isNaN(dateB.getTime()) && b.joinDate !== 'Unknown';

            if (isValidA && isValidB) {
                return dateB - dateA;
            }
            if (isValidA && !isValidB) {
                return -1;
            }
            if (!isValidA && isValidB) {
                return 1;
            }
            return 0;
        });

        return NextResponse.json({ users: mergedUsers }, { status: 200 });

    } catch (error) {
        console.error("GET /api/admin/users ERROR:", error);
        return NextResponse.json({ message: 'Internal Server Error', error: error.message }, { status: 500 });
    }
}


export async function PATCH(req) {
    try {
        const { verifyAdmin } = await import('@/lib/verify-admin');
        await verifyAdmin(req);

        const { userId, status, userType = 'user', action = 'status' } = await req.json();

        if (!userId) {
            return NextResponse.json({ message: 'Missing required fields' }, { status: 400 });
        }

        const firestore = await getFirestore();

        if (action === 'remove') {
            if (userType === 'guest') {
                await firestore.collection('guest_profiles').doc(userId).set({
                    isDeleted: true,
                    status: 'Removed',
                    removedAt: new Date()
                }, { merge: true });
                return NextResponse.json({ message: 'Guest removed successfully' }, { status: 200 });
            }
            if (userType === 'user') {
                await firestore.collection('users').doc(userId).set({
                    isDeleted: true,
                    status: 'Removed',
                    removedAt: new Date(),
                    updatedAt: new Date()
                }, { merge: true });

                const auth = await getAuth();
                await auth.updateUser(userId, { disabled: true });
                return NextResponse.json({ message: 'User removed successfully' }, { status: 200 });
            }
            return NextResponse.json({ message: 'Invalid user type for remove action.' }, { status: 400 });
        }

        const validStatuses = ['Active', 'Blocked'];
        if (!status || !validStatuses.includes(status)) {
            return NextResponse.json({ message: 'Invalid status provided' }, { status: 400 });
        }

        if (userType === 'guest') {
            await firestore.collection('guest_profiles').doc(userId).set({
                status,
                blocked: status === 'Blocked',
                updatedAt: new Date()
            }, { merge: true });
            return NextResponse.json({ message: 'Guest status updated successfully' }, { status: 200 });
        }

        const userRef = firestore.collection('users').doc(userId);
        await userRef.update({ status });

        const auth = await getAuth();
        await auth.updateUser(userId, {
            disabled: status === 'Blocked'
        });

        return NextResponse.json({ message: 'User status updated successfully' }, { status: 200 });

    } catch (error) {
        console.error("PATCH /api/admin/users ERROR:", error);
        return NextResponse.json({ message: 'Internal Server Error', error: error.message }, { status: 500 });
    }
}
