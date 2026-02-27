import { verifyAndGetUid, getFirestore, getAuth } from '@/lib/firebase-admin';

/**
 * GET /api/employee/me
 * 
 * Returns the current user's employee role for the current outlet.
 * Used by dashboard layouts to determine sidebar menu visibility.
 * 
 * IMPORTANT: Queries only by userId to avoid Firestore composite index requirements.
 * All filtering (status, ownerId) is done in code.
 */
export async function GET(request) {
    try {
        // Get employee_of param if provided (for when accessing specific owner's dashboard)
        const { searchParams } = new URL(request.url);
        const employeeOfOwnerId = searchParams.get('employee_of');

        // Verify authentication
        const uid = await verifyAndGetUid(request);
        console.log(`[API /employee/me] UID verified: ${uid}`);
        const db = await getFirestore();
        const auth = await getAuth();
        console.log(`[API /employee/me] Firebase services initialized`);

        // Get user email from auth
        const userRecord = await auth.getUser(uid);
        console.log(`[API /employee/me] User record fetched for ${uid}`);
        const email = userRecord.email;

        // First check if user is an owner (for their own dashboard) - skip if employee_of is set
        if (!employeeOfOwnerId) {
            const userDoc = await db.collection('users').doc(uid).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                if (userData.role === 'owner' || userData.businessType) {
                    // User is an owner, return owner role
                    return Response.json({
                        isEmployee: false,
                        role: 'owner',
                        ownerId: uid,
                        name: userData.name,
                        phone: userData.phone,
                    });
                }
            }
        }

        // Check if user is an employee - query ONLY by userId (no composite index needed)
        let matchingEmployees = [];
        try {
            const employeesSnapshot = await db.collectionGroup('employees')
                .where('userId', '==', uid)
                .get();

            // Filter by status='active' AND ownerId in code (completely avoid Firestore indexes)
            matchingEmployees = employeesSnapshot.docs.filter(doc => {
                const data = doc.data();
                return data.status === 'active';
            });

            if (employeeOfOwnerId) {
                matchingEmployees = matchingEmployees.filter(doc => doc.data().ownerId === employeeOfOwnerId);
            }
        } catch (employeeQueryError) {
            console.error('[API /employee/me] ❌ Firestore collection group query failed:', employeeQueryError.message);
            // Return non-employee response if query fails
            return Response.json({
                isEmployee: false,
                isOwner,
                hasMultipleRoles: false,
                uid,
                email,
                name: userData.name,
                role: userRole,
                outlet: null,
                error: 'Failed to fetch employee data. Please contact support if this persists.'
            });
        }

        if (matchingEmployees.length === 0) {
            // Also check by email for pending employees who just accepted invitation
            try {
                const employeesByEmailSnapshot = await db.collectionGroup('employees')
                    .where('email', '==', email?.toLowerCase())
                    .get();

                let employeesByEmail = employeesByEmailSnapshot.docs.filter(doc => {
                    const data = doc.data();
                    return data.status === 'active';
                });

                if (employeeOfOwnerId) {
                    employeesByEmail = employeesByEmail.filter(doc => doc.data().ownerId === employeeOfOwnerId);
                }

                if (employeesByEmail.length > 0) {
                    matchingEmployees = employeesByEmail;
                }
            } catch (emailQueryError) {
                console.error('[API /employee/me] ⚠️ Email-based employee query failed:', emailQueryError.message);
                // Continue with empty matchingEmployees - will return non-employee response
            }

            if (matchingEmployees.length === 0) {
                return Response.json({
                    isEmployee: false,
                    role: null,
                    message: 'User is not an employee of this outlet'
                });
            }

            const employeeDoc = employeesByEmail[0];
            const employeeData = employeeDoc.data();

            console.log(`[API /employee/me] Found employee role via email: ${employeeData.role} for user ${uid}`);

            return Response.json({
                isEmployee: true,
                role: employeeData.role,
                ownerId: employeeData.ownerId,
                outletId: employeeData.outletId || employeeData.ownerId,
                name: employeeData.name,
                phone: employeeData.phone,
            });
        }

        const employeeDoc = matchingEmployees[0];
        const employeeData = employeeDoc.data();

        console.log(`[API /employee/me] Found employee role: ${employeeData.role} for user ${uid} with owner ${employeeOfOwnerId || 'any'}`);

        return Response.json({
            isEmployee: true,
            role: employeeData.role,
            ownerId: employeeData.ownerId,
            outletId: employeeData.outletId || employeeData.ownerId,
            name: employeeData.name,
            phone: employeeData.phone,
        });

    } catch (error) {
        console.error('GET /api/employee/me error:', error);

        // Check if it's an auth error
        if (error.status) {
            return Response.json({ message: error.message }, { status: error.status });
        }

        return Response.json(
            { message: 'Internal server error', error: error.message },
            { status: 500 }
        );
    }
}

/**
 * PATCH /api/employee/me
 * 
 * Updates the current user's profile (name, phone).
 */
export async function PATCH(request) {
    try {
        const { searchParams } = new URL(request.url);
        const employeeOfOwnerId = searchParams.get('employee_of');

        const uid = await verifyAndGetUid(request);
        const db = await getFirestore();
        const auth = await getAuth();

        const body = await request.json();
        const { name, phone } = body;

        // Get user email from auth
        const userRecord = await auth.getUser(uid);
        const email = userRecord.email;

        // Check if user is an owner updating their own profile
        if (!employeeOfOwnerId) {
            const userDoc = await db.collection('users').doc(uid).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                if (userData.role === 'owner' || userData.businessType) {
                    // Update owner's user profile
                    const updateData = {};
                    if (name) updateData.name = name;
                    if (phone) updateData.phone = phone;

                    await db.collection('users').doc(uid).update(updateData);

                    return Response.json({
                        message: 'Profile updated successfully',
                        name: name || userData.name,
                        phone: phone || userData.phone,
                    });
                }
            }
        }

        // Find employee record and update it
        const employeesSnapshot = await db.collectionGroup('employees')
            .where('userId', '==', uid)
            .get();

        let matchingEmployees = employeesSnapshot.docs.filter(doc => {
            const data = doc.data();
            return data.status === 'active';
        });

        if (employeeOfOwnerId) {
            matchingEmployees = matchingEmployees.filter(doc => doc.data().ownerId === employeeOfOwnerId);
        }

        if (matchingEmployees.length === 0) {
            // Try by email
            const employeesByEmailSnapshot = await db.collectionGroup('employees')
                .where('email', '==', email?.toLowerCase())
                .get();

            matchingEmployees = employeesByEmailSnapshot.docs.filter(doc => {
                const data = doc.data();
                return data.status === 'active';
            });

            if (employeeOfOwnerId) {
                matchingEmployees = matchingEmployees.filter(doc => doc.data().ownerId === employeeOfOwnerId);
            }
        }

        if (matchingEmployees.length === 0) {
            return Response.json({ message: 'Employee record not found' }, { status: 404 });
        }

        const employeeDocRef = matchingEmployees[0].ref;
        const updateData = {};
        if (name) updateData.name = name;
        if (phone) updateData.phone = phone;

        await employeeDocRef.update(updateData);

        // Also update user document if exists
        const userDoc = await db.collection('users').doc(uid).get();
        if (userDoc.exists) {
            await db.collection('users').doc(uid).update(updateData);
        }

        return Response.json({
            message: 'Profile updated successfully',
            name,
            phone,
        });

    } catch (error) {
        console.error('PATCH /api/employee/me error:', error);

        if (error.status) {
            return Response.json({ message: error.message }, { status: error.status });
        }

        return Response.json(
            { message: 'Internal server error', error: error.message },
            { status: 500 }
        );
    }
}
