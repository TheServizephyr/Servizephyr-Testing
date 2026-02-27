/**
 * Audit Logger Utility
 * Logs all admin impersonation activities for security and compliance
 */

import { getFirestore } from '@/lib/firebase-admin';

/**
 * Log an admin impersonation event
 * @param {Object} params - Logging parameters
 * @param {string} params.adminId - Admin user ID
 * @param {string} params.adminEmail - Admin email
 * @param {string} params.targetOwnerId - Impersonated owner ID
 * @param {string} params.targetOwnerEmail - Impersonated owner email (optional)
 * @param {string} params.action - Action performed (e.g., 'start_impersonation', 'view_menu', 'update_order')
 * @param {Object} params.metadata - Additional metadata (optional)
 * @param {string} params.ipAddress - Client IP address
 * @param {string} params.userAgent - Client user agent
 */
export async function logImpersonation({
    adminId,
    adminEmail,
    targetOwnerId,
    targetOwnerEmail = null,
    action,
    metadata = {},
    ipAddress = null,
    userAgent = null,
}) {
    try {
        const firestore = await getFirestore();

        const logEntry = {
            adminId,
            adminEmail,
            targetOwnerId,
            targetOwnerEmail,
            action,
            metadata,
            ipAddress,
            userAgent,
            timestamp: new Date(),
            // Add ISO string for easier querying
            timestampISO: new Date().toISOString(),
        };

        await firestore.collection('audit_logs').add(logEntry);

        console.log(`[AUDIT LOG] ${action} by ${adminEmail} for ${targetOwnerId}`);
    } catch (error) {
        // Don't throw error - logging failure shouldn't break the app
        console.error('[AUDIT LOG ERROR]', error);
    }
}

/**
 * Get client IP address from request headers
 * @param {Request} req - Next.js request object
 * @returns {string|null} IP address
 */
export function getClientIP(req) {
    // Check various headers for IP address
    const forwarded = req.headers.get('x-forwarded-for');
    const real = req.headers.get('x-real-ip');
    const cfConnecting = req.headers.get('cf-connecting-ip');

    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }
    if (real) {
        return real;
    }
    if (cfConnecting) {
        return cfConnecting;
    }

    return null;
}

/**
 * Get user agent from request headers
 * @param {Request} req - Next.js request object
 * @returns {string|null} User agent
 */
export function getUserAgent(req) {
    return req.headers.get('user-agent') || null;
}

/**
 * Create session expiry timestamp
 * @param {number} hours - Hours until expiry (default: 2)
 * @returns {number} Expiry timestamp in milliseconds
 */
export function createSessionExpiry(hours = 2) {
    return Date.now() + (hours * 60 * 60 * 1000);
}

/**
 * Check if session has expired
 * @param {number} expiryTimestamp - Expiry timestamp in milliseconds
 * @returns {boolean} True if expired
 */
export function isSessionExpired(expiryTimestamp) {
    return Date.now() > expiryTimestamp;
}
