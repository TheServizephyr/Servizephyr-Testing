/**
 * Security Module: Token Revocation
 * 
 * Immediately invalidates all refresh tokens for a user when:
 * - Employee is removed from outlet
 * - Employee role is changed
 * - Security breach detected
 * 
 * Implementation:
 * - Uses Firebase Admin SDK's revokeRefreshTokens()
 * - Forces user to re-authenticate on next API call
 * - Designed as fire-and-forget for reliability
 */

import { getAuth } from '@/lib/firebase-admin';

/**
 * Revoke all refresh tokens for a user
 * Forces user to re-authenticate on next API call
 * 
 * @param {string} uid - User ID to revoke access for
 * @param {string} reason - Reason for revocation (for logging/audit)
 * @param {string} source - Source of revocation (e.g., 'employees_api', 'security_breach')
 * @returns {Promise<void>}
 */
export async function revokeUserAccess(uid, reason = 'security_update', source = 'api') {
    try {
        const auth = await getAuth();
        await auth.revokeRefreshTokens(uid);

        // Structured logging for future audit trail
        console.info('[SECURITY][TOKEN_REVOKE]', {
            uid,
            reason,
            source,
            timestamp: new Date().toISOString(),
            status: 'success'
        });

    } catch (error) {
        // Log failure but don't throw (fire-and-forget pattern)
        console.error('[CRITICAL][TOKEN_REVOKE]', {
            uid,
            reason,
            source,
            error: error.message,
            timestamp: new Date().toISOString(),
            status: 'failed'
        });

        // Re-throw error so caller can decide whether to alert
        throw new Error(`Token revocation failed: ${error.message}`);
    }
}
