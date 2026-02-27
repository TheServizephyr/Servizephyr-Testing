/**
 * DINE-IN USER DETAILS STORAGE
 * 
 * Persistent storage for user's tab details (name, pax count)
 * This is separate from cart storage and persists across sessions
 */

/**
 * Save dine-in user details to localStorage
 * @param {string} restaurantId 
 * @param {string} tableId 
 * @param {object} details - { tab_name, pax_count, tabId }
 */
export const saveDineInDetails = (restaurantId, tableId, details) => {
    const key = `dineInUserDetails_${restaurantId}_${tableId}`;
    const data = {
        ...details,
        savedAt: new Date().toISOString()
    };
    localStorage.setItem(key, JSON.stringify(data));
    console.log('[DineIn Storage] Saved details:', data);
};

/**
 * Get dine-in user details from localStorage
 * @param {string} restaurantId 
 * @param {string} tableId 
 * @returns {object|null} - { tab_name, pax_count, tabId, savedAt } or null
 */
export const getDineInDetails = (restaurantId, tableId) => {
    const key = `dineInUserDetails_${restaurantId}_${tableId}`;
    const dataStr = localStorage.getItem(key);

    if (!dataStr) {
        return null;
    }

    try {
        const data = JSON.parse(dataStr);
        console.log('[DineIn Storage] Loaded details:', data);
        return data;
    } catch (e) {
        console.error('[DineIn Storage] Failed to parse details:', e);
        return null;
    }
};

/**
 * Update existing dine-in details
 * @param {string} restaurantId 
 * @param {string} tableId 
 * @param {object} updates - Partial updates
 */
export const updateDineInDetails = (restaurantId, tableId, updates) => {
    const existing = getDineInDetails(restaurantId, tableId);
    if (existing) {
        saveDineInDetails(restaurantId, tableId, {
            ...existing,
            ...updates,
            updatedAt: new Date().toISOString()
        });
    }
};

/**
 * Clear dine-in details (optional - for logout/reset scenarios)
 * @param {string} restaurantId 
 * @param {string} tableId 
 */
export const clearDineInDetails = (restaurantId, tableId) => {
    const key = `dineInUserDetails_${restaurantId}_${tableId}`;
    localStorage.removeItem(key);
    console.log('[DineIn Storage] Cleared details');
};
