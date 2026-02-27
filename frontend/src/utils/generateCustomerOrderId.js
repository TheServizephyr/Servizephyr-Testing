/**
 * Generate a 10-digit customer-facing order ID
 * Format: YYMMDD (6 digits) + RRRR (4 random digits)
 * Example: 2601167492
 * 
 * This ID is separate from Firestore document IDs and is meant for:
 * - Customer communication
 * - Support tracking
 * - UI display
 */
export function generateCustomerOrderId() {
    const now = new Date();

    // Date part: YYMMDD (6 digits)
    const yy = now.getFullYear().toString().slice(-2);
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const dd = now.getDate().toString().padStart(2, '0');
    const datePart = yy + mm + dd;

    // Random part: 4 digits (1000-9999)
    const randomPart = Math.floor(1000 + Math.random() * 9000).toString();

    // Combine: Total 10 digits
    return datePart + randomPart;
}

/**
 * Validate if a string is a valid customer order ID
 * @param {string} id - The ID to validate
 * @returns {boolean} - True if valid
 */
export function isValidCustomerOrderId(id) {
    // Must be exactly 10 digits
    return /^\d{10}$/.test(id);
}
