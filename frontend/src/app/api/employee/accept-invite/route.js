/**
 * Employee Accept Invite API
 * 
 * This API handles when an employee clicks the magic link and accepts the invitation.
 * 
 * Flow:
 * 1. Employee clicks link: /join/{inviteCode}
 * 2. Frontend shows "Sign in with Google"
 * 3. After Google login, frontend calls this API with inviteCode
 * 4. This API verifies invite, links employee to outlet, updates user document
 */

import { NextResponse } from 'next/server';
import { getFirestore, FieldValue, verifyAndGetUid } from '@/lib/firebase-admin';
import { ROLE_PERMISSIONS, ROLE_DISPLAY_NAMES } from '@/lib/permissions';

// ============================================
// POST: Accept invitation and link employee to outlet
// ============================================
export async function POST(req) {
    try {
        const firestore = await getFirestore();

        // User must be logged in (via Google)
        const uid = await verifyAndGetUid(req);

        const body = await req.json();
        const { inviteCode, name, phone } = body;

        if (!inviteCode) {
            return NextResponse.json(
                { message: 'Invite code is required.' },
                { status: 400 }
            );
        }

        // Get invitation document
        const inviteRef = firestore.collection('employee_invitations').doc(inviteCode);
        const inviteDoc = await inviteRef.get();

        if (!inviteDoc.exists) {
            return NextResponse.json(
                { message: 'Invalid or expired invitation link.' },
                { status: 404 }
            );
        }

        const inviteData = inviteDoc.data();

        // Check invitation status
        if (inviteData.status !== 'pending') {
            return NextResponse.json(
                { message: `This invitation has already been ${inviteData.status}.` },
                { status: 400 }
            );
        }

        // Check if expired
        const expiresAt = inviteData.expiresAt?.toDate?.() || new Date(inviteData.expiresAt);
        if (new Date() > expiresAt) {
            await inviteRef.update({ status: 'expired' });
            return NextResponse.json(
                { message: 'This invitation has expired. Please ask the owner to send a new one.' },
                { status: 410 }
            );
        }

        // Get current user's data
        const userRef = firestore.collection('users').doc(uid);
        const userDoc = await userRef.get();

        let userData = {};
        if (userDoc.exists) {
            userData = userDoc.data();
        }

        // Verify email matches invitation (if user has email)
        if (userData.email && inviteData.email) {
            if (userData.email.toLowerCase() !== inviteData.email.toLowerCase()) {
                return NextResponse.json(
                    { message: `This invitation was sent to ${inviteData.email}. Please sign in with that email.` },
                    { status: 403 }
                );
            }
        }

        const batch = firestore.batch();

        // 1. Prepare employee data for outlet's employees array
        const employeeEntryForOutlet = {
            userId: uid,
            email: userData.email || inviteData.email,
            name: name || userData.name || inviteData.name || '',
            phone: phone || userData.phone || '',
            role: inviteData.role,
            permissions: inviteData.permissions || ROLE_PERMISSIONS[inviteData.role] || [],
            status: 'active',
            addedAt: new Date(),
            addedBy: inviteData.invitedBy,
            // Custom role fields
            ...(inviteData.role === 'custom' && {
                customRoleName: inviteData.customRoleName,
                customAllowedPages: inviteData.customAllowedPages,
            }),
        };

        // 2. Update outlet's employees array
        const outletRef = firestore.collection(inviteData.collectionName).doc(inviteData.outletId);
        batch.update(outletRef, {
            employees: FieldValue.arrayUnion(employeeEntryForOutlet),
            // Enable employee management feature
            'features.employeeManagement': true,
        });

        // 3. Prepare linked outlet data for user's document
        const linkedOutletEntry = {
            outletId: inviteData.outletId,
            outletName: inviteData.outletName,
            collectionName: inviteData.collectionName,
            ownerId: inviteData.ownerId,
            employeeRole: inviteData.role,
            permissions: inviteData.permissions || ROLE_PERMISSIONS[inviteData.role] || [],
            status: 'active',
            joinedAt: new Date(),
            isActive: true, // Currently active outlet
            // Custom role fields - used for sidebar/access control
            ...(inviteData.role === 'custom' && {
                customRoleName: inviteData.customRoleName,
                customAllowedPages: inviteData.customAllowedPages,
            }),
        };

        // 4. Update user document
        const currentRoles = userData.roles || [];
        const newRoles = currentRoles.includes('employee')
            ? currentRoles
            : [...currentRoles, 'employee'];

        // If user doesn't have 'customer' role and this is first role, add it
        if (newRoles.length === 1 && newRoles[0] === 'employee') {
            newRoles.unshift('customer');
        }

        const currentLinkedOutlets = userData.linkedOutlets || [];
        // Remove any existing entry for same outlet (in case of re-invite)
        const filteredLinkedOutlets = currentLinkedOutlets.filter(
            o => o.outletId !== inviteData.outletId
        );
        const newLinkedOutlets = [...filteredLinkedOutlets, linkedOutletEntry];

        const userUpdateData = {
            roles: newRoles,
            linkedOutlets: newLinkedOutlets,
            // Update name and phone if provided and not already set
            ...(name && !userData.name && { name }),
            ...(phone && !userData.phone && { phone }),
            // If user is new, set email and createdAt
            ...(!userData.email && { email: inviteData.email }),
            ...(!userData.createdAt && { createdAt: FieldValue.serverTimestamp() }),
        };

        // If user is new, set primary role
        if (!userData.role) {
            userUpdateData.role = 'employee';
        }

        batch.set(userRef, userUpdateData, { merge: true });

        // 5. Update invitation status to accepted
        batch.update(inviteRef, {
            status: 'accepted',
            acceptedAt: FieldValue.serverTimestamp(),
            acceptedBy: uid,
        });

        // Commit all changes
        await batch.commit();

        console.log(`[ACCEPT INVITE] User ${uid} accepted invitation as ${inviteData.role} at outlet ${inviteData.outletId}`);

        // Determine redirect URL based on outlet type
        // CRITICAL: Add employee_of parameter so employee sees EMPLOYER's dashboard
        const ownerId = inviteData.ownerId;
        let redirectTo = `/owner-dashboard/live-orders?employee_of=${ownerId}`;
        if (inviteData.collectionName === 'street_vendors') {
            redirectTo = `/street-vendor-dashboard?employee_of=${ownerId}`;
        }

        return NextResponse.json({
            message: 'Welcome to the team!',
            employee: {
                outletId: inviteData.outletId,
                outletName: inviteData.outletName,
                role: inviteData.role,
                roleDisplay: ROLE_DISPLAY_NAMES[inviteData.role],
                permissions: linkedOutletEntry.permissions,
            },
            redirectTo,
        }, { status: 200 });

    } catch (error) {
        console.error('[ACCEPT INVITE] Error:', error);
        return NextResponse.json(
            { message: error.message || 'Failed to accept invitation.' },
            { status: error.status || 500 }
        );
    }
}

// ============================================
// GET: Verify invitation details (before accepting)
// ============================================
export async function GET(req) {
    try {
        const firestore = await getFirestore();

        const { searchParams } = new URL(req.url);
        const inviteCode = searchParams.get('code');

        if (!inviteCode) {
            return NextResponse.json(
                { message: 'Invite code is required.' },
                { status: 400 }
            );
        }

        // Get invitation document
        const inviteRef = firestore.collection('employee_invitations').doc(inviteCode);
        const inviteDoc = await inviteRef.get();

        if (!inviteDoc.exists) {
            return NextResponse.json(
                { valid: false, message: 'Invalid invitation link.' },
                { status: 404 }
            );
        }

        const inviteData = inviteDoc.data();

        // Check status
        if (inviteData.status !== 'pending') {
            return NextResponse.json({
                valid: false,
                message: `This invitation has been ${inviteData.status}.`,
                status: inviteData.status,
            }, { status: 200 });
        }

        // Check if expired
        const expiresAt = inviteData.expiresAt?.toDate?.() || new Date(inviteData.expiresAt);
        if (new Date() > expiresAt) {
            await inviteRef.update({ status: 'expired' });
            return NextResponse.json({
                valid: false,
                message: 'This invitation has expired.',
                status: 'expired',
            }, { status: 200 });
        }

        // Return invitation details (for UI to show)
        return NextResponse.json({
            valid: true,
            invitation: {
                outletName: inviteData.outletName,
                role: inviteData.role,
                roleDisplay: ROLE_DISPLAY_NAMES[inviteData.role],
                invitedEmail: inviteData.email,
                invitedName: inviteData.name,
                expiresAt: inviteData.expiresAt,
            },
        }, { status: 200 });

    } catch (error) {
        console.error('[ACCEPT INVITE] GET Error:', error);
        return NextResponse.json(
            { valid: false, message: error.message || 'Failed to verify invitation.' },
            { status: 500 }
        );
    }
}
