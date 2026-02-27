/**
 * Common Helper for Admin Impersonation with Audit Logging
 * This helper can be imported and used across all owner API routes
 */

import { getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';
import { logImpersonation, getClientIP, getUserAgent, isSessionExpired } from '@/lib/audit-logger';
import { verifyEmployeeAccess } from '@/lib/verify-employee-access';
import { PERMISSIONS, getPermissionsForRole, normalizeRole } from '@/lib/permissions';

const isOwnerAuditDebugEnabled = process.env.DEBUG_OWNER_AUDIT === 'true';
const debugLog = (...args) => {
    if (isOwnerAuditDebugEnabled) {
        console.log(...args);
    }
};

const OWNER_ROLES = new Set(['owner', 'restaurant-owner', 'shop-owner', 'street-vendor']);
const DEFAULT_COLLECTION_ORDER = ['restaurants', 'shops', 'street_vendors'];

function normalizeBusinessType(type) {
    const normalized = String(type || '').trim().toLowerCase();
    if (normalized === 'street_vendor') return 'street-vendor';
    if (normalized === 'shop' || normalized === 'store') return 'store';
    if (normalized === 'street-vendor' || normalized === 'restaurant') return normalized;
    return null;
}

function getBusinessTypeFromRole(role) {
    if (role === 'shop-owner') return 'store';
    if (role === 'street-vendor') return 'street-vendor';
    if (role === 'restaurant-owner' || role === 'owner') return 'restaurant';
    return null;
}

function getCollectionFromBusinessType(type) {
    const normalized = String(type || '').trim().toLowerCase();
    if (normalized === 'store') return 'shops';
    if (normalized === 'shop') return 'shops';
    if (normalized === 'street-vendor' || normalized === 'street_vendor') return 'street_vendors';
    if (normalized === 'restaurant') return 'restaurants';
    return null;
}

function getPreferredCollections(userRole, userBusinessType) {
    const resolvedBusinessType = normalizeBusinessType(userBusinessType) || getBusinessTypeFromRole(userRole);
    const preferredCollection = getCollectionFromBusinessType(resolvedBusinessType);

    if (!preferredCollection) return DEFAULT_COLLECTION_ORDER;
    return [preferredCollection, ...DEFAULT_COLLECTION_ORDER.filter((name) => name !== preferredCollection)];
}

/**
 * Verify owner/admin and get business with audit logging support
 * This is a common helper that can be used across all owner API routes
 * 
 * @param {Request} req - Next.js request object
 * @param {string} action - Action being performed (e.g., 'view_orders', 'update_settings')
 * @param {Object} metadata - Additional metadata to log (optional)
 * @param {string|string[]|null} requiredPermissions - Required RBAC permission(s). Any one is enough.
 * @returns {Object} - { uid, businessId, businessSnap, collectionName, isAdmin, isImpersonating }
 */
/**
 * Verify owner/admin and get business with audit logging support
 * This is a common helper that can be used across all owner API routes
 * 
 * @param {Request} req - Next.js request object
 * @param {string} action - Action being performed (e.g., 'view_orders', 'update_settings')
 * @param {Object} metadata - Additional metadata to log (optional)
 * @param {string|string[]|null} requiredPermissions - Required RBAC permission(s). Any one is enough.
 * @returns {Object} - { uid, businessId, businessSnap, collectionName, isAdmin, isImpersonating }
 */
export async function verifyOwnerWithAudit(req, action, metadata = {}, checkRevoked = false, requiredPermissions = null) {
    // 1. REQUEST-LEVEL CACHING: Reuse context if already resolved in this request
    // We attach it to the 'req' object as it persists through the life of the API call.
    if (!req._ownerContextPromise) {
        req._ownerContextPromise = (async () => {
            const firestore = await getFirestore();
            const uid = await verifyAndGetUid(req, checkRevoked);

            const userDoc = await firestore.collection('users').doc(uid).get();
            if (!userDoc.exists) {
                throw { message: 'Access Denied: User profile not found.', status: 403 };
            }

            const userData = userDoc.data();
            const userRole = userData.role;

            // --- RESOLVE TARGET OWNER ID ---
            const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
            const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
            const employeeOfOwnerId = url.searchParams.get('employee_of');
            const sessionExpiry = url.searchParams.get('session_expiry');

            let employeeAccessResult = null;
            let targetOwnerId = uid;
            let isImpersonating = false;
            let targetOwnerRole = null;
            let targetOwnerBusinessType = null;

            debugLog(`[verifyOwnerWithAudit] Auth check for UID: ${uid}, Role: ${userRole}`);

            if (userRole === 'admin' && impersonatedOwnerId) {
                if (sessionExpiry && isSessionExpired(parseInt(sessionExpiry, 10))) {
                    console.warn(`[verifyOwnerWithAudit] Impersonation session expired for admin ${uid}`);
                    throw { message: 'Impersonation session has expired. Please re-authenticate.', status: 401 };
                }
                targetOwnerId = impersonatedOwnerId;
                isImpersonating = true;

                // Use target owner's profile to resolve the correct business collection.
                const targetOwnerDoc = await firestore.collection('users').doc(targetOwnerId).get();
                if (targetOwnerDoc.exists) {
                    const targetOwnerData = targetOwnerDoc.data() || {};
                    targetOwnerRole = targetOwnerData.role || null;
                    targetOwnerBusinessType =
                        normalizeBusinessType(targetOwnerData.businessType) ||
                        getBusinessTypeFromRole(targetOwnerRole);
                }

                debugLog(`[verifyOwnerWithAudit] Admin impersonating owner: ${targetOwnerId}`);
            } else if (employeeOfOwnerId) {
                employeeAccessResult = await verifyEmployeeAccess(uid, employeeOfOwnerId, userData);
                if (!employeeAccessResult.authorized) {
                    console.warn(`[verifyOwnerWithAudit] Employee access denied: ${uid} for owner ${employeeOfOwnerId}`);
                    throw { message: 'Access Denied: You are not an employee of this outlet.', status: 403 };
                }
                targetOwnerId = employeeOfOwnerId;
                debugLog(`[verifyOwnerWithAudit] Employee access granted: ${uid} for owner ${targetOwnerId}`);
            } else {
                // For direct owner access, we check role BUT we'll have a fallback later if business exists
                const isKnownOwnerRole = OWNER_ROLES.has(userRole);
                if (!isKnownOwnerRole) {
                    debugLog(`[verifyOwnerWithAudit] UID ${uid} has role '${userRole}', checking business association fallback...`);
                }
            }

            // --- RESOLVE BUSINESS ---
            let resolvedBusinessDoc = null;
            let resolvedCollectionName = null;

            // Employee flow: lock to exact outlet from linkedOutlets to avoid shop/restaurant mix-ups.
            if (employeeOfOwnerId && employeeAccessResult?.outletId && employeeAccessResult?.collectionName) {
                const exactDoc = await firestore
                    .collection(employeeAccessResult.collectionName)
                    .doc(employeeAccessResult.outletId)
                    .get();

                if (exactDoc.exists && exactDoc.data()?.ownerId === targetOwnerId) {
                    resolvedBusinessDoc = exactDoc;
                    resolvedCollectionName = employeeAccessResult.collectionName;
                } else {
                    console.warn(
                        `[verifyOwnerWithAudit] Employee outlet mismatch for ${uid}. Falling back to ownerId lookup.`
                    );
                }
            }

            if (!resolvedBusinessDoc) {
                const roleForLookup = isImpersonating ? targetOwnerRole : userRole;
                const businessTypeForLookup = isImpersonating ? targetOwnerBusinessType : userData.businessType;
                const collectionsToTry = getPreferredCollections(roleForLookup, businessTypeForLookup);
                for (const collectionName of collectionsToTry) {
                    const querySnapshot = await firestore
                        .collection(collectionName)
                        .where('ownerId', '==', targetOwnerId)
                        .limit(1)
                        .get();

                    if (!querySnapshot.empty) {
                        resolvedBusinessDoc = querySnapshot.docs[0];
                        resolvedCollectionName = collectionName;
                        break;
                    }
                }
            }

            if (resolvedBusinessDoc && resolvedCollectionName) {
                // Determine callerRole
                let effectiveCallerRole = userRole;
                let effectiveCallerPermissions = [];
                if (isImpersonating) {
                    // FIX: When impersonating, the admin acts AS the owner.
                    // Downstream APIs check if (role === 'owner'), so we must return 'owner'.
                    effectiveCallerRole = 'owner';
                    effectiveCallerPermissions = Object.values(PERMISSIONS);
                } else if (employeeOfOwnerId && employeeAccessResult) {
                    effectiveCallerRole = employeeAccessResult.employeeRole || userRole;
                    // Prefer explicit per-employee permissions stored in linkedOutlets.
                    // Fallback to role defaults for backward compatibility.
                    effectiveCallerPermissions = (employeeAccessResult.permissions && employeeAccessResult.permissions.length > 0)
                        ? employeeAccessResult.permissions
                        : getPermissionsForRole(effectiveCallerRole);
                } else {
                    // For direct owner access, use getPermissionsForRole to properly flatten nested permissions
                    effectiveCallerPermissions = getPermissionsForRole(effectiveCallerRole);
                }

                // Normalize legacy role aliases (shop-owner/restaurant-owner/etc.)
                // so downstream APIs that check exact role strings remain consistent.
                effectiveCallerRole = normalizeRole(effectiveCallerRole);

                return {
                    uid: targetOwnerId,
                    businessId: resolvedBusinessDoc.id,
                    businessSnap: resolvedBusinessDoc,
                    collectionName: resolvedCollectionName,
                    isAdmin: userRole === 'admin',
                    isImpersonating,
                    userData,
                    callerRole: effectiveCallerRole,
                    callerPermissions: effectiveCallerPermissions,
                    adminId: isImpersonating ? uid : null,
                    adminEmail: isImpersonating ? userData.email : null
                };
            }

            // If we reached here, no business was found
            const isKnownOwnerRole = OWNER_ROLES.has(userRole);
            if (!isKnownOwnerRole && !isImpersonating && !employeeOfOwnerId) {
                console.warn(`[verifyOwnerWithAudit] Access Denied for UID ${uid} (Role: ${userRole}, No business found)`);
                throw { message: 'Access Denied: You do not have sufficient privileges.', status: 403 };
            }

            console.warn(`[verifyOwnerWithAudit] No business found for Owner ID: ${targetOwnerId}`);
            throw { message: 'No business associated with this owner.', status: 404 };
        })();
    }

    // 2. AWAIT RESOLUTION
    const context = await req._ownerContextPromise;

    // 2.5 OPTIONAL PERMISSION ENFORCEMENT
    if (requiredPermissions) {
        const required = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];
        const callerPermissions = context.callerPermissions || [];
        const hasRequiredPermission = required.some((permission) => callerPermissions.includes(permission));

        if (!hasRequiredPermission) {
            throw {
                message: `Access Denied: Missing required permission (${required.join(' OR ')}).`,
                status: 403
            };
        }
    }

    // 3. AUDIT LOGGING (Always run per check if impersonating)
    if (context.isImpersonating && action) {
        await logImpersonation({
            adminId: context.adminId,
            adminEmail: context.adminEmail,
            targetOwnerId: context.uid,
            action,
            metadata,
            ipAddress: getClientIP(req),
            userAgent: getUserAgent(req)
        });
    }

    return context;
}

