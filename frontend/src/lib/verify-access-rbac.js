/**
 * ServiZephyr RBAC - Access Verification Helper
 * 
 * This replaces/extends the existing verify-owner-with-audit.js for RBAC support.
 * It handles both:
 * 1. Old users (owner with ownerId in restaurant) - backward compatible
 * 2. New users (employees with linkedOutlets) - RBAC enabled
 * 
 * Usage:
 * const { outletId, role, permissions, isOwner } = await verifyAccessWithRBAC(req, 'view_orders');
 */

import { getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES, hasPermission } from '@/lib/permissions';

// ============================================
// MAIN RBAC VERIFICATION FUNCTION
// ============================================

/**
 * Verify user access with RBAC support
 * Works for both owners and employees
 * 
 * @param {Request} req - Next.js request object
 * @param {string|string[]} requiredPermission - Permission(s) required for this action
 * @param {Object} options - Additional options
 * @param {string} options.outletId - Specific outlet ID (optional, uses query param or default)
 * @returns {Object} Access context with outletId, role, permissions, etc.
 * @throws Error if access denied
 */
export async function verifyAccessWithRBAC(req, requiredPermission = null, options = {}) {
    const firestore = await getFirestore();
    const uid = await verifyAndGetUid(req);

    // Get outlet ID from query params or options
    const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
    const requestedOutletId = options.outletId || url.searchParams.get('outletId');

    // Admin impersonation support (from existing system)
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = url.searchParams.get('employee_of');

    // Get user document
    const userDoc = await firestore.collection('users').doc(uid).get();
    if (!userDoc.exists) {
        throw { message: 'User not found.', status: 404 };
    }

    const userData = userDoc.data();
    const userRole = userData.role;

    // ============================================
    // CASE 1: Admin impersonating owner
    // ============================================
    if (userRole === 'admin' && impersonatedOwnerId) {
        console.log(`[RBAC] Admin ${uid} impersonating owner ${impersonatedOwnerId}`);
        // Delegate to owner verification with impersonated ID
        return await verifyOwnerAccess(firestore, impersonatedOwnerId, requestedOutletId, requiredPermission, true, uid);
    }

    if (userRole === 'admin') {
        throw { message: 'Admin access to this endpoint requires impersonate_owner_id.', status: 403 };
    }

    // ============================================
    // CASE 2: User is an Owner (old or new system)
    // ============================================
    const isKnownOwnerRole = ['owner', 'restaurant-owner', 'shop-owner', 'street-vendor'].includes(userRole);
    if (isKnownOwnerRole || userData.businessType) {
        return await verifyOwnerAccess(firestore, uid, requestedOutletId, requiredPermission, false, null);
    }

    // ============================================
    // CASE 3: User is an Employee (new RBAC system)
    // ============================================
    if (userRole === 'employee' || (userData.linkedOutlets && userData.linkedOutlets.length > 0)) {
        return await verifyEmployeeAccess(
            firestore,
            uid,
            userData,
            requestedOutletId,
            requiredPermission,
            employeeOfOwnerId
        );
    }

    // ============================================
    // CASE 4: Unknown role - deny access
    // ============================================
    console.warn(`[RBAC] Access Denied: UID ${uid} has role '${userRole}' but no businessType or active employee outlets.`);
    throw { message: 'Access denied. Invalid user role.', status: 403 };
}

// ============================================
// OWNER ACCESS VERIFICATION
// ============================================

async function verifyOwnerAccess(firestore, ownerId, requestedOutletId, requiredPermission, isImpersonating, adminId) {
    // Try to find business in all collections (backward compatible)
    const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];

    for (const collectionName of collectionsToTry) {
        let query;

        if (requestedOutletId) {
            // Specific outlet requested - verify owner owns it
            const docRef = firestore.collection(collectionName).doc(requestedOutletId);
            const docSnap = await docRef.get();

            if (docSnap.exists && docSnap.data().ownerId === ownerId) {
                return buildOwnerContext(docSnap, collectionName, ownerId, isImpersonating, adminId);
            }
        } else {
            // No specific outlet - get first one (or default)
            query = await firestore
                .collection(collectionName)
                .where('ownerId', '==', ownerId)
                .limit(1)
                .get();

            if (!query.empty) {
                const docSnap = query.docs[0];
                return buildOwnerContext(docSnap, collectionName, ownerId, isImpersonating, adminId);
            }
        }
    }

    throw { message: 'No business found for this owner.', status: 404 };
}

function buildOwnerContext(docSnap, collectionName, ownerId, isImpersonating, adminId) {
    return {
        uid: ownerId,
        outletId: docSnap.id,
        outletRef: docSnap.ref,
        outletData: docSnap.data(),
        collectionName,
        role: ROLES.OWNER,
        permissions: Object.values(PERMISSIONS), // Owner has ALL permissions
        isOwner: true,
        isEmployee: false,
        isImpersonating,
        adminId,
        // Backward compatibility fields
        businessId: docSnap.id,
        businessSnap: docSnap,
    };
}

// ============================================
// EMPLOYEE ACCESS VERIFICATION
// ============================================

async function verifyEmployeeAccess(firestore, uid, userData, requestedOutletId, requiredPermission, targetOwnerId = null) {
    const linkedOutlets = userData.linkedOutlets || [];

    if (linkedOutlets.length === 0) {
        throw { message: 'No outlets linked to this employee.', status: 403 };
    }

    const scopedOutlets = targetOwnerId
        ? linkedOutlets.filter(o => o.ownerId === targetOwnerId)
        : linkedOutlets;

    if (scopedOutlets.length === 0) {
        throw { message: 'Access denied. You are not linked to this owner.', status: 403 };
    }

    // Find the relevant outlet
    let linkedOutlet;

    if (requestedOutletId) {
        // Specific outlet requested
        linkedOutlet = scopedOutlets.find(o => o.outletId === requestedOutletId);
        if (!linkedOutlet) {
            throw { message: 'Access denied. You are not linked to this outlet.', status: 403 };
        }
    } else {
        // Use first linked outlet (or active one if stored)
        linkedOutlet =
            scopedOutlets.find(o => o.isActive && o.status === 'active') ||
            scopedOutlets.find(o => o.status === 'active') ||
            scopedOutlets[0];
    }

    // Check if employee is active
    if (linkedOutlet.status === 'inactive' || linkedOutlet.status === 'removed') {
        throw { message: 'Your access to this outlet has been revoked.', status: 403 };
    }

    // Get permissions for this employee at this outlet
    const permissions = linkedOutlet.permissions || ROLE_PERMISSIONS[linkedOutlet.employeeRole] || [];

    // Check required permission
    if (requiredPermission) {
        const requiredPerms = Array.isArray(requiredPermission) ? requiredPermission : [requiredPermission];
        const hasRequired = requiredPerms.some(p => permissions.includes(p));

        if (!hasRequired) {
            throw {
                message: `Permission denied. Required: ${requiredPerms.join(' or ')}.`,
                status: 403
            };
        }
    }

    // Get outlet document for additional data
    const outletRef = firestore.collection(linkedOutlet.collectionName || 'restaurants').doc(linkedOutlet.outletId);
    const outletSnap = await outletRef.get();

    if (!outletSnap.exists) {
        throw { message: 'Outlet not found.', status: 404 };
    }

    return {
        uid,
        outletId: linkedOutlet.outletId,
        outletRef,
        outletData: outletSnap.data(),
        collectionName: linkedOutlet.collectionName || 'restaurants',
        role: linkedOutlet.employeeRole,
        permissions,
        isOwner: false,
        isEmployee: true,
        isImpersonating: false,
        adminId: null,
        ownerId: linkedOutlet.ownerId,
        employeeName: userData.name,
        // Backward compatibility
        businessId: linkedOutlet.outletId,
        businessSnap: outletSnap,
    };
}

// ============================================
// PERMISSION CHECK HELPERS
// ============================================

/**
 * Quick permission check without full context
 * Use when you already have the access context
 * 
 * @param {Object} accessContext - Context from verifyAccessWithRBAC
 * @param {string} permission - Permission to check
 * @returns {boolean}
 */
export function checkPermission(accessContext, permission) {
    if (!accessContext || !accessContext.permissions) return false;
    return accessContext.permissions.includes(permission);
}

/**
 * Throw error if permission not present
 * 
 * @param {Object} accessContext - Context from verifyAccessWithRBAC
 * @param {string} permission - Permission to require
 * @throws Error if permission not present
 */
export function requirePermission(accessContext, permission) {
    if (!checkPermission(accessContext, permission)) {
        throw {
            message: `Permission denied. Required: ${permission}.`,
            status: 403
        };
    }
}

// ============================================
// BACKWARD COMPATIBILITY
// ============================================

/**
 * Legacy function - wraps new RBAC for existing code
 * Drop-in replacement for verifyOwnerWithAudit in existing APIs
 */
export async function verifyOwnerWithRBAC(req, action, metadata = {}) {
    const context = await verifyAccessWithRBAC(req);

    // Log action for audit (if needed)
    if (context.isImpersonating) {
        console.log(`[AUDIT] Admin ${context.adminId} performing ${action} on behalf of owner ${context.uid}`);
    }

    return context;
}

// ============================================
// EXPORTS
// ============================================

export { PERMISSIONS, ROLES } from '@/lib/permissions';
