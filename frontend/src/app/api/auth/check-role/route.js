

import { NextResponse } from 'next/server';
import { getAuth, getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';

const OWNER_ROLES = new Set(['owner', 'restaurant-owner', 'shop-owner', 'street-vendor']);

function getBusinessTypeFromRole(role) {
    if (role === 'shop-owner') return 'store';
    if (role === 'street-vendor') return 'street-vendor';
    if (role === 'restaurant-owner') return 'restaurant';
    return null;
}

async function resolveBusinessType(firestore, uid, role, currentBusinessType) {
    if (currentBusinessType) {
        const normalized = String(currentBusinessType).trim().toLowerCase();
        if (normalized === 'street_vendor') return 'street-vendor';
        if (normalized === 'shop') return 'store';
        return normalized;
    }

    const roleMappedType = getBusinessTypeFromRole(role);
    if (roleMappedType) return roleMappedType;

    if (!OWNER_ROLES.has(role)) return null;

    const checks = [
        { collection: 'restaurants', type: 'restaurant' },
        { collection: 'shops', type: 'store' },
        { collection: 'street_vendors', type: 'street-vendor' },
    ];

    for (const check of checks) {
        const snap = await firestore
            .collection(check.collection)
            .where('ownerId', '==', uid)
            .limit(1)
            .get();
        if (!snap.empty) return check.type;
    }

    return null;
}

export async function POST(req) {
    console.log("[DEBUG] /api/auth/check-role: Received a request.");
    try {
        const uid = await verifyAndGetUid(req); // Use the new helper
        const firestore = await getFirestore();
        console.log(`[DEBUG] /api/auth/check-role: Token verified for UID: ${uid}`);

        // 1. Check the 'users' collection first (for customers, owners, admins, street vendors)
        const userRef = firestore.collection('users').doc(uid);
        const userDoc = await userRef.get();
        console.log(`[DEBUG] /api/auth/check-role: Firestore 'users' document fetched. Exists: ${userDoc.exists}`);

        if (userDoc.exists) {
            const userData = userDoc.data();
            console.log("[DEBUG] /api/auth/check-role: User document data:", userData);
            const role = userData.role;
            const businessType = await resolveBusinessType(firestore, uid, role, userData.businessType || null);
            const linkedOutlets = userData.linkedOutlets || [];

            console.log(`[DEBUG] /api/auth/check-role: Role: ${role}, LinkedOutlets count: ${linkedOutlets.length}`);
            console.log("[DEBUG] /api/auth/check-role: LinkedOutlets:", JSON.stringify(linkedOutlets));

            // Check for multiple roles (user is both owner/customer AND employee somewhere)
            const hasEmployeeRole = linkedOutlets.some(o => o.status === 'active');
            const isOwnerOrVendor = role === 'owner' || role === 'street-vendor' || role === 'restaurant-owner' || role === 'shop-owner';

            console.log(`[DEBUG] /api/auth/check-role: hasEmployeeRole: ${hasEmployeeRole}, isOwnerOrVendor: ${isOwnerOrVendor}, role: ${role}`);

            // If user has multiple roles, redirect to select-role page
            // Include admin, owner, vendor, and customer - anyone with a primary role + employee roles
            if (hasEmployeeRole && (isOwnerOrVendor || role === 'customer' || role === 'admin')) {
                console.log(`[DEBUG] /api/auth/check-role: User has MULTIPLE ROLES! Returning hasMultipleRoles: true`);
                return NextResponse.json({
                    role,
                    businessType,
                    hasMultipleRoles: true,
                    linkedOutlets: linkedOutlets.filter(o => o.status === 'active').map(o => ({
                        outletId: o.outletId,
                        outletName: o.outletName,
                        employeeRole: o.employeeRole,
                        collectionName: o.collectionName,
                        ownerId: o.ownerId, // Include ownerId for employee_of redirect
                    })),
                }, { status: 200 });
            }

            // If user is ONLY an employee (no owner role)
            if (hasEmployeeRole && (!role || role === 'customer' || role === 'employee')) {
                const primaryOutlet = linkedOutlets.find(o => o.status === 'active' && o.isActive);
                const firstActiveOutlet = linkedOutlets.find(o => o.status === 'active');
                const outlet = primaryOutlet || firstActiveOutlet;

                if (outlet) {
                    console.log(`[DEBUG] /api/auth/check-role: User is employee only. Redirecting to outlet dashboard.`);
                    const redirectTo = outlet.collectionName === 'street_vendors'
                        ? '/street-vendor-dashboard'
                        : '/owner-dashboard/live-orders';

                    return NextResponse.json({
                        role: 'employee',
                        employeeRole: outlet.employeeRole,
                        businessType: null,
                        redirectTo,
                        outletName: outlet.outletName,
                    }, { status: 200 });
                }
            }

            // This custom claim logic can be simplified, but let's keep it for now
            const auth = await getAuth();
            const { customClaims } = await auth.getUser(uid);

            if (role === 'admin' && !customClaims?.isAdmin) {
                await auth.setCustomUserClaims(uid, { isAdmin: true });
                console.log(`[DEBUG] /api/auth/check-role: Custom claim 'isAdmin: true' set for UID: ${uid}.`);
            } else if (role !== 'admin' && customClaims?.isAdmin) {
                await auth.setCustomUserClaims(uid, { isAdmin: null });
                console.log(`[DEBUG] /api/auth/check-role: User is no longer admin, removing custom claim for UID: ${uid}.`);
            }

            if (role) {
                console.log(`[DEBUG] /api/auth/check-role: Role found in 'users': '${role}'. Returning 200.`);
                return NextResponse.json({ role, businessType }, { status: 200 });
            }
        }

        console.log(`[DEBUG] /api/auth/check-role: User not in 'users' or has no role. Checking 'drivers' collection.`);
        const driverRef = firestore.collection('drivers').doc(uid);
        const driverDoc = await driverRef.get();
        console.log(`[DEBUG] /api/auth/check-role: Firestore 'drivers' document fetched. Exists: ${driverDoc.exists}`);

        if (driverDoc.exists) {
            console.log(`[DEBUG] /api/auth/check-role: Role found in 'drivers': 'rider'. Returning 200.`);
            return NextResponse.json({ role: 'rider', businessType: null }, { status: 200 });
        }

        console.log(`[DEBUG] /api/auth/check-role: User not found in any collection for UID: ${uid}. Returning 404.`);
        return NextResponse.json({ message: 'User profile not found.' }, { status: 404 });

    } catch (error) {
        console.error('[DEBUG] /api/auth/check-role: CRITICAL ERROR:', error);
        if (error.code === 'auth/id-token-expired') {
            return NextResponse.json({ message: 'Login token has expired. Please log in again.' }, { status: 401 });
        }
        // Handle custom errors from our helper
        if (error.status) {
            return NextResponse.json({ message: error.message }, { status: error.status });
        }
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}

