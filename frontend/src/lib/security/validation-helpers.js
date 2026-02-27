/**
 * Validation Helpers for Sensitive Operations
 * 
 * Provides extra validation beyond basic input checks
 * to prevent mistakes and abuse in critical operations.
 */

/**
 * Validate menu item price change
 * Prevents extreme price increases while allowing reasonable changes
 * 
 * @param {Array} oldPortions - Array of {name, price} objects
 * @param {Array} newPortions - Array of {name, price} objects
 * @param {string} itemName - Item name for error messages
 * @returns {{valid: boolean, error?: string, warning?: string}}
 */
export function validatePriceChange(oldPortions, newPortions, itemName) {
    const MAX_INCREASE_MULTIPLIER = 3; // Block >300% increase
    const MIN_DECREASE_MULTIPLIER = 0.3; // Warn on >70% decrease

    // Validate all portions (not just first one)
    for (let i = 0; i < newPortions.length; i++) {
        const newPortion = newPortions[i];
        const newPrice = newPortion.price;

        // Basic validation
        if (newPrice <= 0) {
            return {
                valid: false,
                error: `Invalid price for ${itemName} (${newPortion.name}). Price must be greater than 0.`
            };
        }

        // Find matching old portion by name
        const oldPortion = oldPortions.find(p => p.name === newPortion.name);

        if (oldPortion && oldPortion.price > 0) {
            const oldPrice = oldPortion.price;
            const increaseRatio = newPrice / oldPrice;

            // Block extreme increases (>3x)
            if (increaseRatio > MAX_INCREASE_MULTIPLIER) {
                return {
                    valid: false,
                    error: `Price increase too large for ${itemName} (${newPortion.name}). Old: ₹${oldPrice}, New: ₹${newPrice}. Maximum allowed increase: ${MAX_INCREASE_MULTIPLIER}x (₹${(oldPrice * MAX_INCREASE_MULTIPLIER).toFixed(2)}). Please verify this is not a mistake.`
                };
            }

            // Warn on large decreases (but allow)
            if (increaseRatio < MIN_DECREASE_MULTIPLIER) {
                return {
                    valid: true,
                    warning: `Large price decrease detected for ${itemName} (${newPortion.name}). Old: ₹${oldPrice}, New: ₹${newPrice} (${Math.round((1 - increaseRatio) * 100)}% decrease). Please verify this is intentional.`
                };
            }
        }
    }

    return { valid: true };
}

/**
 * Helper to extract portions array for comparison
 */
export function extractPortions(item) {
    if (!item || !item.portions || !Array.isArray(item.portions)) {
        return [];
    }
    return item.portions.map(p => ({
        name: p.name || 'default',
        price: parseFloat(p.price) || 0
    }));
}

/**
 * Validate refund amount
 * Extra check on top of existing refund API validation
 * 
 * @param {number} refundAmount - Amount to refund
 * @param {number} orderTotal - Total order amount
 * @param {number} alreadyRefunded - Amount already refunded
 * @returns {{valid: boolean, error?: string}}
 */
export function validateRefundAmount(refundAmount, orderTotal, alreadyRefunded = 0) {
    const maxRefundable = orderTotal - alreadyRefunded;

    if (refundAmount <= 0) {
        return {
            valid: false,
            error: 'Refund amount must be greater than 0.'
        };
    }

    if (refundAmount > maxRefundable) {
        return {
            valid: false,
            error: `Refund amount (₹${refundAmount.toFixed(2)}) exceeds maximum refundable amount (₹${maxRefundable.toFixed(2)}). Already refunded: ₹${alreadyRefunded.toFixed(2)}.`
        };
    }

    // Warn if refunding entire order (might be intentional)
    if (refundAmount === orderTotal && alreadyRefunded === 0) {
        return {
            valid: true,
            warning: `Full order refund requested for ₹${orderTotal.toFixed(2)}. Please confirm this is intentional.`
        };
    }

    return { valid: true };
}

/**
 * Validate employee role change
 * Extra check on top of existing canManageRole() check
 * 
 * @param {string} actorRole - Role of user making the change
 * @param {string} newRole - New role being assigned
 * @returns {{valid: boolean, error?: string}}
 */
export function validateRoleChange(actorRole, newRole) {
    // Manager cannot create another Manager (only owner can)
    if (actorRole === 'manager' && newRole === 'manager') {
        return {
            valid: false,
            error: 'Managers cannot promote employees to Manager role. Only owners can create managers.'
        };
    }

    // Waiter/Chef cannot invite anyone
    if (['waiter', 'chef'].includes(actorRole)) {
        return {
            valid: false,
            error: 'Your role does not have permission to manage employees.'
        };
    }

    return { valid: true };
}

/**
 * Validate coupon discount value
 * Prevents absurd discount values
 * 
 * @param {string} discountType - 'percentage', 'fixed', 'free_delivery'
 * @param {number} discountValue - Discount value
 * @returns {{valid: boolean, error?: string, warning?: string}}
 */
export function validateCouponDiscount(discountType, discountValue) {
    if (discountType === 'free_delivery') {
        return { valid: true }; // No value needed
    }

    if (discountType === 'percentage') {
        if (discountValue < 0 || discountValue > 100) {
            return {
                valid: false,
                error: `Invalid percentage discount: ${discountValue}%. Must be between 0 and 100.`
            };
        }

        // Warn on very high discounts
        if (discountValue > 50) {
            return {
                valid: true,
                warning: `High discount percentage: ${discountValue}%. This will significantly impact revenue. Please verify.`
            };
        }
    }

    if (discountType === 'fixed') {
        if (discountValue <= 0) {
            return {
                valid: false,
                error: `Fixed discount must be greater than 0. Received: ₹${discountValue}`
            };
        }

        // Warn on very high fixed discounts
        if (discountValue > 500) {
            return {
                valid: true,
                warning: `High fixed discount: ₹${discountValue}. Please verify this is intentional.`
            };
        }
    }

    return { valid: true };
}

export default {
    validatePriceChange,
    extractPortions,
    validateRefundAmount,
    validateRoleChange,
    validateCouponDiscount
};
