/**
 * Employee Management API
 * 
 * Endpoints:
 * - POST: Invite new employee (send email invitation)
 * - GET: List employees for outlet
 * - PATCH: Update employee role/permissions/status
 * - DELETE: Remove employee from outlet
 */

import { NextResponse } from 'next/server';
import { getFirestore, FieldValue, verifyAndGetUid } from '@/lib/firebase-admin';
import { verifyAccessWithRBAC, PERMISSIONS } from '@/lib/verify-access-rbac';
import {
    ROLES,
    ROLE_PERMISSIONS,
    getPermissionsForRole,
    canManageRole,
    getRoleDisplayName,
    normalizeBusinessType,
    EMPLOYEE_ROLES,
    getInvitableRoles
} from '@/lib/permissions';
import { revokeUserAccess } from '@/lib/security/revoke-user-access';
import { logAuditEvent, AUDIT_ACTIONS, createRoleChangeMetadata } from '@/lib/security/audit-log';
import { employeeInviteLimiter, employeeRemoveLimiter, roleChangeLimiter } from '@/lib/security/rate-limiter';
import crypto from 'crypto';

// ============================================
// HELPER: Generate unique invite code
// ============================================
function generateInviteCode() {
    return crypto.randomBytes(16).toString('hex');
}

// ============================================
// HELPER: Get collection name for business type
// ============================================
function getCollectionName(businessType) {
    if (businessType === 'store' || businessType === 'shop') return 'shops';
    if (businessType === 'street-vendor') return 'street_vendors';
    return 'restaurants';
}

function getBusinessTypeFromCollectionName(collectionName) {
    if (collectionName === 'shops') return 'store';
    if (collectionName === 'street_vendors') return 'street-vendor';
    return 'restaurant';
}

// ============================================
// POST: Invite new employee
// ============================================
export async function POST(req) {
    try {
        const firestore = await getFirestore();

        // Verify owner/manager access with permission to invite
        const accessContext = await verifyAccessWithRBAC(req, PERMISSIONS.INVITE_EMPLOYEE);

        const body = await req.json();
        const { email, role, name, phone, customPermissions, customRoleName, customAllowedPages } = body;

        // Validation
        if (!email || !role) {
            return NextResponse.json(
                { message: 'Email and role are required.' },
                { status: 400 }
            );
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return NextResponse.json(
                { message: 'Invalid email format.' },
                { status: 400 }
            );
        }

        // Validate role - allow 'custom' role as well
        if (!EMPLOYEE_ROLES.includes(role) && role !== 'custom') {
            return NextResponse.json(
                { message: `Invalid role. Must be one of: ${EMPLOYEE_ROLES.join(', ')}, custom` },
                { status: 400 }
            );
        }

        // For custom role, require customRoleName and customAllowedPages
        if (role === 'custom') {
            if (!customRoleName || !customAllowedPages || customAllowedPages.length === 0) {
                return NextResponse.json(
                    { message: 'Custom role requires a name and at least one page access.' },
                    { status: 400 }
                );
            }
        }

        // Check if inviter can manage this role
        if (!canManageRole(accessContext.role, role)) {
            return NextResponse.json(
                { message: `You cannot invite ${role}. Only higher-level roles can invite.` },
                { status: 403 }
            );
        }

        const outletId = accessContext.outletId;
        const collectionName = accessContext.collectionName;
        const outletBusinessType =
            normalizeBusinessType(accessContext?.outletData?.businessType) ||
            getBusinessTypeFromCollectionName(collectionName);

        // 🔒 Rate limit check (10 invites per minute)
        const rateLimitCheck = employeeInviteLimiter.check(accessContext.uid, outletId);
        if (!rateLimitCheck.allowed) {
            // Log violation
            logAuditEvent({
                actorUid: accessContext.uid,
                actorRole: accessContext.role,
                action: AUDIT_ACTIONS.RATE_LIMIT_VIOLATION,
                targetUid: null,
                outletId,
                metadata: {
                    endpoint: 'employee_invite',
                    limit: '10/min',
                    retryAfter: rateLimitCheck.retryAfter
                },
                source: 'rate_limiter',
                req
            }).catch(err => console.error('[AUDIT_LOG_FAILED]', err));

            return NextResponse.json({
                message: `Too many employee invitations. Please wait ${rateLimitCheck.retryAfter} seconds before trying again.`
            }, {
                status: 429,
                headers: { 'Retry-After': rateLimitCheck.retryAfter.toString() }
            });
        }

        const outletData = accessContext.outletData;

        // ✅ NEW: Check duplication in Sub-Collection
        const employeeQuery = await firestore
            .collection(collectionName)
            .doc(outletId)
            .collection('employees')
            .where('email', '==', email.toLowerCase())
            .where('status', '==', 'active')
            .limit(1)
            .get();

        if (!employeeQuery.empty) {
            return NextResponse.json(
                { message: 'This email is already an employee at this outlet.' },
                { status: 409 }
            );
        }

        // Check for pending invitation
        const pendingInviteQuery = await firestore
            .collection('employee_invitations')
            .where('email', '==', email.toLowerCase())
            .where('outletId', '==', outletId)
            .where('status', '==', 'pending')
            .limit(1)
            .get();

        if (!pendingInviteQuery.empty) {
            return NextResponse.json(
                { message: 'An invitation is already pending for this email.' },
                { status: 409 }
            );
        }

        // Generate invite code
        const inviteCode = generateInviteCode();

        // Get permissions for this role (or custom if provided)
        const permissions = customPermissions || ROLE_PERMISSIONS[role] || [];

        // Create invitation document
        const invitationData = {
            inviteCode,
            email: email.toLowerCase(),
            name: name || '',
            phone: phone || '',
            role,
            permissions,
            outletId,
            outletName: outletData.name,
            collectionName,
            ownerId: accessContext.isOwner ? accessContext.uid : accessContext.ownerId,
            invitedBy: accessContext.uid,
            invitedByName: accessContext.isOwner ? outletData.name : accessContext.employeeName,
            status: 'pending',
            createdAt: FieldValue.serverTimestamp(),
            expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48 hours
            // Custom role fields
            ...(role === 'custom' && {
                customRoleName,
                customAllowedPages,  // Array of page IDs this employee can access
            }),
        };

        await firestore.collection('employee_invitations').doc(inviteCode).set(invitationData);

        // 🔍 Audit log: Employee invitation (fire-and-forget)
        logAuditEvent({
            actorUid: accessContext.uid,
            actorRole: accessContext.role,
            action: AUDIT_ACTIONS.EMPLOYEE_INVITE,
            targetUid: null, // No UID yet (pending acceptance)
            outletId,
            metadata: {
                employeeEmail: email,
                employeeRole: role,
                inviteCode,
                customRole: role === 'custom' ? { roleName: customRoleName, allowedPages: customAllowedPages } : null
            },
            source: 'employees_api',
            req
        }).catch(err => console.error('[AUDIT_LOG_FAILED]', err));

        // Generate invite link
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.servizephyr.com';
        const inviteLink = `${baseUrl}/join/${inviteCode}`;

        console.log(`[EMPLOYEES API] Invitation created for ${email} as ${role} at outlet ${outletId}`);

        return NextResponse.json({
            message: 'Invitation sent successfully!',
            invitation: {
                email,
                role,
                roleDisplay: role === 'custom' ? customRoleName : getRoleDisplayName(role, outletBusinessType),
                inviteLink,
                expiresAt: invitationData.expiresAt,
            }
        }, { status: 201 });

    } catch (error) {
        console.error('[EMPLOYEES API] POST Error:', error);
        return NextResponse.json(
            { message: error.message || 'Failed to invite employee.' },
            { status: error.status || 500 }
        );
    }
}

// ============================================
// GET: List employees for outlet
// ============================================
export async function GET(req) {
    try {
        const firestore = await getFirestore();

        // Verify access with permission to view employees
        const accessContext = await verifyAccessWithRBAC(req, PERMISSIONS.VIEW_EMPLOYEES);

        const outletData = accessContext.outletData;
        const outletId = accessContext.outletId;
        const collectionName = accessContext.collectionName;
        const outletBusinessType =
            normalizeBusinessType(outletData?.businessType) ||
            getBusinessTypeFromCollectionName(collectionName);
        const currentUserId = accessContext.uid;

        // Role hierarchy for sorting (lower number = higher rank)
        const ROLE_HIERARCHY = {
            'owner': 0,
            'manager': 1,
            'chef': 2,
            'waiter': 3,
            'cashier': 4,
            'order_taker': 5,
            'custom': 6,
        };

        // ✅ NEW: Fetch from Sub-Collection
        const employeesSnap = await firestore
            .collection(collectionName)
            .doc(outletId)
            .collection('employees')
            .get();

        const employeesFromOutlet = employeesSnap.docs.map(doc => ({
            ...doc.data(),
            userId: doc.id, // Ensure ID is present
            roleDisplay: doc.data().role === 'custom'
                ? (doc.data().customRoleName || 'Custom')
                : getRoleDisplayName(doc.data().role, outletBusinessType),
            hierarchyOrder: ROLE_HIERARCHY[doc.data().role] || 99,
        }));

        // Create owner entry (always at top)
        const ownerId = accessContext.isOwner
            ? accessContext.uid
            : (accessContext.ownerId || outletData.ownerId);

        const ownerEntry = {
            userId: ownerId,
            email: outletData.email || outletData.ownerEmail || '',
            name: outletData.ownerName || outletData.restaurantName || outletData.name || 'Owner',
            phone: outletData.phone || outletData.ownerPhone || '',
            role: 'owner',
            roleDisplay: outletBusinessType === 'store'
                ? 'Store Owner'
                : (outletBusinessType === 'street-vendor' ? 'Street Vendor Owner' : 'Restaurant Owner'),
            status: 'active',
            hierarchyOrder: 0,
            isOwner: true,
        };

        // Combine owner + employees, sort by hierarchy
        const allTeamMembers = [ownerEntry, ...employeesFromOutlet]
            .sort((a, b) => a.hierarchyOrder - b.hierarchyOrder);

        // Get pending invitations
        const pendingInvitesQuery = await firestore
            .collection('employee_invitations')
            .where('outletId', '==', outletId)
            .where('status', '==', 'pending')
            .get();

        const pendingInvites = pendingInvitesQuery.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                email: data.email,
                name: data.name,
                role: data.role,
                roleDisplay: data.role === 'custom'
                    ? (data.customRoleName || 'Custom')
                    : getRoleDisplayName(data.role, outletBusinessType),
                status: 'pending',
                invitedBy: data.invitedByName,
                createdAt: data.createdAt?.toDate?.() || data.createdAt,
                expiresAt: data.expiresAt,
                hierarchyOrder: ROLE_HIERARCHY[data.role] || 99,
            };
        }).sort((a, b) => a.hierarchyOrder - b.hierarchyOrder);

        // Get roles that current user can invite  
        const invitableRoles = getInvitableRoles(accessContext.role).map(role => ({
            value: role,
            label: getRoleDisplayName(role, outletBusinessType),
        }));

        return NextResponse.json({
            employees: allTeamMembers,
            pendingInvites,
            invitableRoles,
            currentUserId,
            canInvite: accessContext.permissions.includes(PERMISSIONS.INVITE_EMPLOYEE),
            canManage: accessContext.permissions.includes(PERMISSIONS.MANAGE_EMPLOYEES),
        }, { status: 200 });

    } catch (error) {
        console.error('[EMPLOYEES API] GET Error:', error);
        return NextResponse.json(
            { message: error.message || 'Failed to fetch employees.' },
            { status: error.status || 500 }
        );
    }
}

// ============================================
// PATCH: Update employee role/permissions/status
// ============================================
export async function PATCH(req) {
    try {
        const firestore = await getFirestore();

        // Verify access with permission to manage employees
        const accessContext = await verifyAccessWithRBAC(req, PERMISSIONS.MANAGE_EMPLOYEES);

        const body = await req.json();
        const {
            employeeId,
            action,
            newRole,
            newPermissions,
        } = body;

        if (!employeeId || !action) {
            return NextResponse.json(
                { message: 'Employee ID and action are required.' },
                { status: 400 }
            );
        }

        const outletId = accessContext.outletId;
        const collectionName = accessContext.collectionName;

        // ✅ NEW: Fetch individual doc from sub-collection
        const employeeRef = firestore
            .collection(collectionName)
            .doc(outletId)
            .collection('employees')
            .doc(employeeId);

        const employeeDoc = await employeeRef.get();

        if (!employeeDoc.exists) {
            return NextResponse.json(
                { message: 'Employee not found.' },
                { status: 404 }
            );
        }

        // Clone data for processing (no longer index based)
        const currentEmployee = { ...employeeDoc.data(), userId: employeeDoc.id };
        const updates = {};

        // Check if current user can manage this employee's role
        if (!canManageRole(accessContext.role, currentEmployee.role)) {
            return NextResponse.json(
                { message: 'You cannot manage employees at or above your level.' },
                { status: 403 }
            );
        }

        // Apply action
        switch (action) {
            case 'updateRole':
                if (!newRole || !EMPLOYEE_ROLES.includes(newRole)) {
                    return NextResponse.json(
                        { message: 'Invalid new role.' },
                        { status: 400 }
                    );
                }
                if (!canManageRole(accessContext.role, newRole)) {
                    return NextResponse.json(
                        { message: 'You cannot assign this role.' },
                        { status: 403 }
                    );
                }
                updates.role = newRole;
                updates.permissions = ROLE_PERMISSIONS[newRole];
                break;

            case 'updatePermissions':
                if (!newPermissions || !Array.isArray(newPermissions)) {
                    return NextResponse.json(
                        { message: 'New permissions array required.' },
                        { status: 400 }
                    );
                }
                updates.permissions = newPermissions;
                break;

            case 'deactivate':
                updates.status = 'inactive';
                updates.deactivatedAt = new Date();
                updates.deactivatedBy = accessContext.uid;
                break;

            case 'reactivate':
                updates.status = 'active';
                updates.reactivatedAt = new Date();
                break;

            default:
                return NextResponse.json(
                    { message: 'Invalid action.' },
                    { status: 400 }
                );
        }

        updates.updatedAt = new Date();
        updates.updatedBy = accessContext.uid;

        // ✅ NEW: Update sub-collection doc
        await employeeRef.update(updates);

        // Also update the employee's user document if deactivating/reactivating
        if (action === 'deactivate' || action === 'reactivate' || action === 'updateRole' || action === 'updatePermissions') {
            const employeeUserRef = firestore.collection('users').doc(employeeId);
            const employeeUserDoc = await employeeUserRef.get();

            if (employeeUserDoc.exists) {
                const linkedOutlets = employeeUserDoc.data().linkedOutlets || [];
                // 🔒 Rate limit check (10 role changes per minute)
                const rateLimitCheck = roleChangeLimiter.check(accessContext.uid, outletId);
                if (!rateLimitCheck.allowed) {
                    return NextResponse.json({
                        message: `Too many role changes. Please wait ${rateLimitCheck.retryAfter} seconds.`
                    }, { status: 429 });
                }

                // Update role in Firestore
                const outletIndex = linkedOutlets.findIndex(o => o.outletId === outletId);

                if (outletIndex !== -1) {
                    const newLinkedOutlet = { ...linkedOutlets[outletIndex] };
                    if (updates.status) newLinkedOutlet.status = updates.status;
                    if (updates.role) newLinkedOutlet.employeeRole = updates.role;
                    if (updates.permissions) newLinkedOutlet.permissions = updates.permissions;

                    linkedOutlets[outletIndex] = newLinkedOutlet;

                    await employeeUserRef.update({ linkedOutlets });

                    // 🔥 CRITICAL: Revoke tokens to force new permissions (fire-and-forget)
                    revokeUserAccess(employeeId, 'role_changed', 'employees_api')
                        .catch(err => {
                            console.error('[CRITICAL] Token revocation failed:', err.message);
                        });

                    // 🔍 Audit log
                    logAuditEvent({
                        actorUid: accessContext.uid,
                        actorRole: accessContext.role,
                        action: AUDIT_ACTIONS.ROLE_CHANGE,
                        targetUid: employeeId,
                        outletId,
                        metadata: createRoleChangeMetadata({
                            employeeId,
                            employeeName: currentEmployee.name,
                            oldRole: currentEmployee.role,
                            newRole: updates.role || currentEmployee.role
                        }),
                        source: 'employees_api',
                        req
                    }).catch(err => console.error('[AUDIT_LOG_FAILED]', err));
                }
            }
        }

        return NextResponse.json({
            message: `Employee ${action} successfully.`,
            employee: { ...currentEmployee, ...updates },
        }, { status: 200 });

    } catch (error) {
        console.error('[EMPLOYEES API] PATCH Error:', error);
        return NextResponse.json(
            { message: error.message || 'Failed to update employee.' },
            { status: error.status || 500 }
        );
    }
}

// ============================================
// DELETE: Remove employee from outlet
// ============================================
export async function DELETE(req) {
    try {
        const firestore = await getFirestore();

        // Only owner can permanently remove employees
        const accessContext = await verifyAccessWithRBAC(req, PERMISSIONS.REMOVE_EMPLOYEE);

        const { searchParams } = new URL(req.url);
        const employeeId = searchParams.get('employeeId');
        const inviteCode = searchParams.get('inviteCode');

        if (!employeeId && !inviteCode) {
            return NextResponse.json(
                { message: 'Employee ID or invite code required.' },
                { status: 400 }
            );
        }

        const outletId = accessContext.outletId;
        const collectionName = accessContext.collectionName;

        // Handle pending invite cancellation
        if (inviteCode) {
            const inviteRef = firestore.collection('employee_invitations').doc(inviteCode);
            const inviteDoc = await inviteRef.get();

            if (!inviteDoc.exists || inviteDoc.data().outletId !== outletId) {
                return NextResponse.json(
                    { message: 'Invitation not found.' },
                    { status: 404 }
                );
            }

            await inviteRef.update({
                status: 'cancelled',
                cancelledAt: FieldValue.serverTimestamp(),
                cancelledBy: accessContext.uid,
            });

            return NextResponse.json({
                message: 'Invitation cancelled.',
            }, { status: 200 });
        }

        // ✅ NEW: Handle sub-collection doc deletion
        const employeeRef = firestore
            .collection(collectionName)
            .doc(outletId)
            .collection('employees')
            .doc(employeeId);

        const employeeDoc = await employeeRef.get();

        if (!employeeDoc.exists) {
            return NextResponse.json(
                { message: 'Employee not found.' },
                { status: 404 }
            );
        }

        const removedEmployee = employeeDoc.data();

        // Check if current user can manage this employee
        if (!canManageRole(accessContext.role, removedEmployee.role)) {
            return NextResponse.json(
                { message: 'You cannot remove employees at or above your level.' },
                { status: 403 }
            );
        }

        // ✅ NEW: Delete from sub-collection
        await employeeRef.delete();

        // 🔒 Rate limit check
        const rateLimitCheck = employeeRemoveLimiter.check(accessContext.uid, outletId);
        if (!rateLimitCheck.allowed) {
            return NextResponse.json({
                message: `Too many employee removals. Please wait ${rateLimitCheck.retryAfter} seconds.`
            }, { status: 429 });
        }

        // Update employee's user document - remove this outlet from linkedOutlets
        const employeeUserRef = firestore.collection('users').doc(employeeId);
        const employeeUserDoc = await employeeUserRef.get();

        if (employeeUserDoc.exists) {
            const linkedOutlets = employeeUserDoc.data().linkedOutlets || [];
            const updatedLinkedOutlets = linkedOutlets.filter(o => o.outletId !== outletId);

            const updateData = { linkedOutlets: updatedLinkedOutlets };

            // If no more linked outlets, update role back to customer
            if (updatedLinkedOutlets.length === 0) {
                const currentRoles = employeeUserDoc.data().roles || [];
                updateData.roles = currentRoles.filter(r => r !== 'employee');
                if (updateData.roles.length === 0) {
                    updateData.roles = ['customer'];
                }
                updateData.role = updateData.roles[0];
            }

            await employeeUserRef.update(updateData);
        }

        // 🔥 CRITICAL: Revoke tokens
        revokeUserAccess(employeeId, 'employee_removed', 'employees_api')
            .catch(err => {
                console.error('[CRITICAL] Token revocation failed:', err.message);
            });

        // 🔍 Audit log
        logAuditEvent({
            actorUid: accessContext.uid,
            actorRole: accessContext.role,
            action: AUDIT_ACTIONS.EMPLOYEE_REMOVE,
            targetUid: employeeId,
            outletId,
            metadata: {
                employeeName: removedEmployee.name,
                employeeRole: removedEmployee.role,
                employeeEmail: removedEmployee.email || 'N/A',
                removedAt: new Date().toISOString(),
                wasFullyDeleted: false // logic simplified
            },
            source: 'employees_api',
            req
        }).catch(err => console.error('[AUDIT_LOG_FAILED]', err));

        console.log(`[EMPLOYEES API] Employee ${employeeId} removed from outlet ${outletId}`);

        return NextResponse.json({
            message: 'Employee removed successfully.',
        }, { status: 200 });

    } catch (error) {
        console.error('[EMPLOYEES API] DELETE Error:', error);
        return NextResponse.json(
            { message: error.message || 'Failed to remove employee.' },
            { status: error.status || 500 }
        );
    }
}
