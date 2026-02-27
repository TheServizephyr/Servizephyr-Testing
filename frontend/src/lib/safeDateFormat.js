/**
 * Safe date formatting utility to handle invalid/malformed dates from Firestore
 * Prevents "Invalid time value" RangeError crashes
 */

/**
 * Safely converts Firestore timestamp or date string to JavaScript Date
 * @param {*} dateValue - Can be Firestore Timestamp, Date, string, or invalid value
 * @returns {Date|null} - Valid Date object or null if invalid
 */
export function safeToDate(dateValue) {
    try {
        // Handle null/undefined
        if (!dateValue) {
            return null;
        }

        // Handle Firestore Timestamp (.toDate() method)
        if (dateValue && typeof dateValue.toDate === 'function') {
            const date = dateValue.toDate();
            return isValidDate(date) ? date : null;
        }

        // Handle already a Date object
        if (dateValue instanceof Date) {
            return isValidDate(dateValue) ? dateValue : null;
        }

        // Handle object with seconds/nanoseconds (e.g., serialized Firestore Timestamp)
        if (dateValue && typeof dateValue === 'object') {
            if (typeof dateValue.seconds === 'number') {
                const date = new Date(dateValue.seconds * 1000);
                return isValidDate(date) ? date : null;
            }
            if (typeof dateValue._seconds === 'number') {
                const date = new Date(dateValue._seconds * 1000);
                return isValidDate(date) ? date : null;
            }
        }

        // Handle string or number (timestamp)
        const date = new Date(dateValue);
        return isValidDate(date) ? date : null;

    } catch (error) {
        console.warn('[safeToDate] Invalid date value:', dateValue, error);
        return null;
    }
}

/**
 * Check if a Date object is valid
 * @param {Date} date 
 * @returns {boolean}
 */
function isValidDate(date) {
    return date instanceof Date && !isNaN(date.getTime());
}

/**
 * Safely format a date for display
 * @param {*} dateValue - Any date value
 * @param {string} fallback - Fallback text if date is invalid (default: "N/A")
 * @returns {string} - Formatted date string or fallback
 */
export function formatSafeDate(dateValue, fallback = 'N/A') {
    const date = safeToDate(dateValue);

    if (!date) {
        return fallback;
    }

    try {
        return date.toLocaleString('en-IN', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    } catch (error) {
        console.warn('[formatSafeDate] Formatting error:', error);
        return fallback;
    }
}

/**
 * Safely format a date for display (shorter version - just date)
 * @param {*} dateValue - Any date value
 * @param {string} fallback - Fallback text if date is invalid (default: "N/A")
 * @returns {string} - Formatted date string or fallback
 */
export function formatSafeDateShort(dateValue, fallback = 'N/A') {
    const date = safeToDate(dateValue);

    if (!date) {
        return fallback;
    }

    try {
        return date.toLocaleString('en-IN', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    } catch (error) {
        console.warn('[formatSafeDateShort] Formatting error:', error);
        return fallback;
    }
}

/**
 * Safely format a relative time (e.g., "5 minutes ago")
 * @param {*} dateValue - Any date value
 * @param {string} fallback - Fallback text if date is invalid (default: "N/A")
 * @returns {string} - Relative time string or fallback
 */
export function formatSafeRelativeTime(dateValue, fallback = 'N/A') {
    const date = safeToDate(dateValue);

    if (!date) {
        return fallback;
    }

    try {
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
        if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;

        // Fallback to formatted date for older dates
        return formatSafeDateShort(date, fallback);
    } catch (error) {
        console.warn('[formatSafeRelativeTime] Formatting error:', error);
        return fallback;
    }
}

/**
 * Safely get time component from date
 * @param {*} dateValue - Any date value
 * @param {string} fallback - Fallback text if date is invalid (default: "--:--")
 * @returns {string} - Time string (HH:MM AM/PM) or fallback
 */
export function formatSafeTime(dateValue, fallback = '--:--') {
    const date = safeToDate(dateValue);

    if (!date) {
        return fallback;
    }

    try {
        return date.toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    } catch (error) {
        console.warn('[formatSafeTime] Formatting error:', error);
        return fallback;
    }
}
