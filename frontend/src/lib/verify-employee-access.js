/**
 * Employee Access Verification Helper
 * 
 * SECURITY: This module verifies that a user is authorized to access an owner's data.
 * 
 * Access is granted if:
 * 1. User is the owner themselves
 * 2. User is an admin (impersonation)
 * 3. User is an employee of the owner's outlet (employee_of)
 * 
 * Access is DENIED for:
 * - Random users trying to access via URL manipulation
 * - Employees trying to access outlets they don't belong to
 */

import { getFirestore } from '@/lib/firebase-admin';

/**
 * Verify if a user has access to an owner's data
 * 
 * @param {string} requesterId - The UID of the user making the request
 * @param {string} targetOwnerId - The UID of the owner whose data is being accessed
 * @param {object} userData - The requester's user document data
 * @returns {Promise<object>} - { authorized: boolean, reason: string, employeeRole?: string }
 */
export async function verifyEmployeeAccess(requesterId, targetOwnerId, userData) {
    // Case 1: User is accessing their own data
    if (requesterId === targetOwnerId) {
        return { authorized: true, reason: 'owner_self' };
    }

    // Case 2: User is admin (impersonation allowed)
    if (userData.role === 'admin') {
        return { authorized: true, reason: 'admin_impersonation' };
    }

    // Case 3: Check if user is employee of this owner
    const linkedOutlets = userData.linkedOutlets || [];

    const matchingOutlet = linkedOutlets.find(outlet =>
        outlet.ownerId === targetOwnerId &&
        outlet.status === 'active'
    );

    if (matchingOutlet) {
        return {
            authorized: true,
            reason: 'employee_access',
            employeeRole: matchingOutlet.employeeRole,
            permissions: matchingOutlet.permissions || [],
            customAllowedPages: matchingOutlet.customAllowedPages || null,
            outletId: matchingOutlet.outletId,
            outletName: matchingOutlet.outletName,
            collectionName: matchingOutlet.collectionName || null,
        };
    }

    // Case 4: Unauthorized access attempt
    console.warn(`[SECURITY] Unauthorized access attempt: User ${requesterId} tried to access owner ${targetOwnerId}'s data`);
    return {
        authorized: false,
        reason: 'unauthorized',
        message: 'Access Denied: You are not authorized to access this data.'
    };
}

/**
 * Helper to get target owner ID and verify access
 * Use this in API routes to securely handle impersonate_owner_id and employee_of params
 * 
 * @param {Request} req - The incoming request
 * @param {string} uid - Current user's UID
 * @param {object} userData - Current user's data from Firestore
 * @returns {Promise<object>} - { targetOwnerId: string, accessInfo: object }
 */
export async function getAuthorizedTargetOwner(req, uid, userData) {
    const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
    const impersonateOwnerId = url.searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = url.searchParams.get('employee_of');

    // Determine which owner ID to use
    const targetOwnerId = impersonateOwnerId || employeeOfOwnerId || uid;

    // If accessing someone else's data, verify authorization
    if (targetOwnerId !== uid) {
        const accessResult = await verifyEmployeeAccess(uid, targetOwnerId, userData);

        if (!accessResult.authorized) {
            throw {
                message: accessResult.message || 'Access Denied',
                status: 403
            };
        }

        console.log(`[API Access] User ${uid} (${accessResult.reason}) accessing owner ${targetOwnerId}'s data`);
        return { targetOwnerId, accessInfo: accessResult };
    }

    return {
        targetOwnerId: uid,
        accessInfo: { authorized: true, reason: 'owner_self' }
    };
}
