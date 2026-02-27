/**
 * Price Validation Utility
 * Validates menu item price changes based on user role and change percentage
 * Prevents accidental pricing disasters by managers
 */

export const PRICE_CHANGE_LIMITS = {
    WARNING_DECREASE_THRESHOLD: 30, // Warn if price decreases more than 30%
    BLOCK_INCREASE_THRESHOLD: 50,   // Block if price increases more than 50%
};

/**
 * Validates a price change based on user role
 * @param {number} oldPrice - Original price
 * @param {number} newPrice - New price
 * @param {string} userRole - User's role (owner, manager, etc.)
 * @returns {Object} Validation result
 */
export function validatePriceChange(oldPrice, newPrice, userRole) {
    // Owner has no restrictions
    if (userRole === 'owner') {
        return { allowed: true };
    }

    // Validate inputs
    if (!oldPrice || oldPrice <= 0) {
        return {
            allowed: false,
            requiresConfirmation: false,
            message: 'Invalid original price.',
            severity: 'error'
        };
    }

    if (!newPrice || newPrice <= 0) {
        return {
            allowed: false,
            requiresConfirmation: false,
            message: 'Price must be greater than zero.',
            severity: 'error'
        };
    }

    // Calculate percentage change
    const percentChange = ((newPrice - oldPrice) / oldPrice) * 100;
    const absPercentChange = Math.abs(percentChange);

    // Price decrease > 30% - Requires confirmation
    if (percentChange < -PRICE_CHANGE_LIMITS.WARNING_DECREASE_THRESHOLD) {
        return {
            allowed: false,
            requiresConfirmation: true,
            message: `Large price decrease detected (${absPercentChange.toFixed(1)}%). This could impact revenue significantly. Please confirm this change.`,
            severity: 'warning',
            percentChange: percentChange.toFixed(1),
            oldPrice,
            newPrice
        };
    }

    // Price increase > 50% - Blocked (owner approval required)
    if (percentChange > PRICE_CHANGE_LIMITS.BLOCK_INCREASE_THRESHOLD) {
        return {
            allowed: false,
            requiresConfirmation: false,
            message: `Price increase of ${percentChange.toFixed(1)}% requires owner approval. Large price increases can negatively impact customer satisfaction. Please contact the owner.`,
            severity: 'error',
            percentChange: percentChange.toFixed(1),
            oldPrice,
            newPrice
        };
    }

    // All checks passed
    return { allowed: true };
}

/**
 * Creates an audit log entry for price changes
 * @param {Object} params - Price change parameters
 * @returns {Object} Audit log entry
 */
export function createPriceChangeAuditLog({ itemId, itemName, oldPrice, newPrice, userId, userName, userRole }) {
    const percentChange = ((newPrice - oldPrice) / oldPrice) * 100;

    return {
        timestamp: new Date().toISOString(),
        action: 'price_change',
        itemId,
        itemName,
        changes: {
            oldPrice,
            newPrice,
            percentChange: percentChange.toFixed(2),
        },
        user: {
            id: userId,
            name: userName,
            role: userRole,
        },
    };
}

/**
 * Formats price change for display
 * @param {number} oldPrice - Original price
 * @param {number} newPrice - New price
 * @returns {string} Formatted price change message
 */
export function formatPriceChangeMessage(oldPrice, newPrice) {
    const percentChange = ((newPrice - oldPrice) / oldPrice) * 100;
    const direction = percentChange > 0 ? 'increase' : 'decrease';
    const absPercent = Math.abs(percentChange).toFixed(1);

    return `${direction} of ${absPercent}% (₹${oldPrice} → ₹${newPrice})`;
}
