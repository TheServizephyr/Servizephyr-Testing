/**
 * Audit Logging Module
 * 
 * Logs high-risk actions for:
 * - Security (who did what)
 * - Debugging (trace issues)
 * - Compliance (SOC2, GDPR, ISO-27001)
 * - Accountability (internal trust)
 * 
 * NEVER blocks API operations - silently logs errors.
 */

import { getFirestore, FieldValue } from '@/lib/firebase-admin';

// ============================================
// AUDIT ACTION CONSTANTS (ENUM-like)
// ============================================

export const AUDIT_ACTIONS = {
    // Employee Management
    EMPLOYEE_INVITE: 'EMPLOYEE_INVITE',
    EMPLOYEE_REMOVE: 'EMPLOYEE_REMOVE',
    ROLE_CHANGE: 'ROLE_CHANGE',

    // Menu Management
    MENU_PRICE_UPDATE: 'MENU_PRICE_UPDATE',
    MENU_ITEM_DELETE: 'MENU_ITEM_DELETE',

    // Financial
    PAYMENT_SETTINGS_UPDATE: 'PAYMENT_SETTINGS_UPDATE',
    ORDER_REFUND: 'ORDER_REFUND',

    // Marketing
    COUPON_CREATE: 'COUPON_CREATE',
    COUPON_DELETE: 'COUPON_DELETE',

    // Security
    RATE_LIMIT_VIOLATION: 'RATE_LIMIT_VIOLATION',
};

// Metadata size limit (soft cap - Firestore doc limit is 1MB)
const MAX_METADATA_SIZE = 8000; // bytes

// ============================================
// MAIN AUDIT LOGGING FUNCTION
// ============================================

/**
 * Log an audit event to Firestore
 * 
 * @param {Object} params
 * @param {string} params.actorUid - User performing the action
 * @param {string} params.actorRole - Role of the actor (owner, manager, etc.)
 * @param {string} params.action - Action type (use AUDIT_ACTIONS constants)
 * @param {string} [params.targetUid] - User affected by action (for employee actions)
 * @param {string} [params.outletId] - Outlet where action occurred
 * @param {Object} [params.metadata] - Action-specific data
 * @param {string} [params.source] - API source (employees_api, menu_api, etc.)
 * @param {Request} [params.req] - Next.js request object for IP/UA
 * @returns {Promise<void>}
 * 
 * @example
 * await logAuditEvent({
 *     actorUid: 'owner123',
 *     actorRole: 'owner',
 *     action: AUDIT_ACTIONS.ROLE_CHANGE,
 *     targetUid: 'emp456',
 *     outletId: 'restaurant-123',
 *     metadata: { oldRole: 'waiter', newRole: 'manager' },
 *     source: 'employees_api',
 *     req
 * });
 */
export async function logAuditEvent({
    actorUid,
    actorRole,
    action,
    targetUid = null,
    outletId = null,
    metadata = {},
    source = 'api',
    req = null
}) {
    try {
        const firestore = await getFirestore();

        // Validate action (prevent typos)
        if (!Object.values(AUDIT_ACTIONS).includes(action)) {
            console.warn('[AUDIT_LOG] Unknown action type:', action);
            // Continue anyway - log even if action not in enum
        }

        // Extract IP and User Agent from request
        const ipAddress = req?.headers?.get('x-forwarded-for') ||
            req?.headers?.get('x-real-ip') ||
            'unknown';
        const userAgent = req?.headers?.get('user-agent') || 'unknown';

        // Safeguard: Truncate metadata if too large
        let safeMetadata = metadata;
        const metadataSize = JSON.stringify(metadata).length;
        if (metadataSize > MAX_METADATA_SIZE) {
            console.warn('[AUDIT_LOG] Metadata too large, truncating:', {
                action,
                originalSize: metadataSize,
                limit: MAX_METADATA_SIZE
            });
            safeMetadata = {
                truncated: true,
                originalSize: metadataSize,
                note: 'Metadata exceeded size limit and was truncated'
            };
        }

        // Create audit log entry
        await firestore.collection('audit_logs').add({
            actorUid,
            actorRole,
            action,
            targetUid,
            outletId,
            metadata: safeMetadata,
            source,
            ipAddress,
            userAgent,
            createdAt: FieldValue.serverTimestamp()
        });

        // Structured logging for monitoring
        console.info('[AUDIT_LOG]', {
            action,
            actorUid,
            targetUid,
            outletId,
            source,
            status: 'logged'
        });

    } catch (error) {
        // CRITICAL: Never throw - audit logging must NOT block API operations
        console.error('[AUDIT_LOG_FAILED]', {
            action,
            actorUid,
            targetUid,
            outletId,
            error: error.message,
            stack: error.stack
        });

        // Silently fail - main business operation continues
        // DO NOT re-throw
    }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Mask sensitive data (account numbers, keys, etc.)
 * 
 * @param {string} value - Value to mask
 * @param {number} visibleChars - Number of chars to show at end (default: 4)
 * @returns {string} Masked value (e.g., "****1234")
 * 
 * @example
 * maskSensitiveData('1234567890', 4) // Returns "******7890"
 * maskSensitiveData('sk_live_abc123', 4) // Returns "*************23"
 */
export function maskSensitiveData(value, visibleChars = 4) {
    if (!value || typeof value !== 'string') {
        return '****';
    }

    if (value.length <= visibleChars) {
        return '*'.repeat(value.length);
    }

    const maskedPart = '*'.repeat(value.length - visibleChars);
    const visiblePart = value.slice(-visibleChars);

    return maskedPart + visiblePart;
}

/**
 * Create metadata object for price changes
 * 
 * @param {Object} params
 * @param {string} params.itemId - Menu item ID
 * @param {string} params.itemName - Menu item name
 * @param {number} params.oldPrice - Previous price
 * @param {number} params.newPrice - New price
 * @param {string} [params.category] - Item category
 * @returns {Object} Metadata object
 */
export function createPriceChangeMetadata({ itemId, itemName, oldPrice, newPrice, category }) {
    return {
        itemId,
        itemName,
        oldPrice,
        newPrice,
        priceChange: newPrice - oldPrice,
        priceChangePercent: oldPrice > 0 ? ((newPrice - oldPrice) / oldPrice * 100).toFixed(2) : 'N/A',
        category: category || 'uncategorized'
    };
}

/**
 * Create metadata object for role changes
 * 
 * @param {Object} params
 * @param {string} params.employeeId - Employee UID
 * @param {string} params.employeeName - Employee name
 * @param {string} params.oldRole - Previous role
 * @param {string} params.newRole - New role
 * @returns {Object} Metadata object
 */
export function createRoleChangeMetadata({ employeeId, employeeName, oldRole, newRole }) {
    return {
        employeeId,
        employeeName,
        oldRole,
        newRole,
        changedAt: new Date().toISOString()
    };
}
