const MAX_NOTES_LENGTH = 1000;

export function isQuotaExceededError(error) {
    if (!error) return false;
    return (
        error.name === 'QuotaExceededError' ||
        error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
        error.code === 22 ||
        error.code === 1014
    );
}

function buildMenuAvailabilityMap(menu) {
    const map = {};
    if (!menu || typeof menu !== 'object') return map;

    Object.values(menu).forEach((items) => {
        if (!Array.isArray(items)) return;
        items.forEach((item) => {
            if (!item?.id) return;
            map[item.id] = item.isAvailable !== false;
        });
    });

    return map;
}

export function sanitizeCartForStorage(rawData) {
    const data = { ...(rawData || {}) };

    if (typeof data.notes === 'string' && data.notes.length > MAX_NOTES_LENGTH) {
        data.notes = data.notes.slice(0, MAX_NOTES_LENGTH);
    }

    if (data.menu && !data.menuAvailability) {
        data.menuAvailability = buildMenuAvailabilityMap(data.menu);
    }

    // Full menu is too heavy for localStorage and causes quota crashes.
    delete data.menu;

    return data;
}

function buildMinimalFallbackPayload(data) {
    return {
        cart: Array.isArray(data.cart) ? data.cart : [],
        notes: typeof data.notes === 'string' ? data.notes : '',
        deliveryType: data.deliveryType || 'delivery',
        restaurantId: data.restaurantId || '',
        restaurantName: data.restaurantName || '',
        phone: data.phone || '',
        token: data.token || '',
        tableId: data.tableId || null,
        dineInTabId: data.dineInTabId || null,
        pax_count: data.pax_count || null,
        tab_name: data.tab_name || null,
        expiryTimestamp: data.expiryTimestamp || Date.now() + (24 * 60 * 60 * 1000),
    };
}

export function safeReadCart(restaurantId) {
    if (typeof window === 'undefined' || !restaurantId) return {};

    try {
        const raw = localStorage.getItem(`cart_${restaurantId}`);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return sanitizeCartForStorage(parsed);
    } catch {
        return {};
    }
}

export function safeWriteCart(restaurantId, rawData) {
    if (typeof window === 'undefined' || !restaurantId) return false;

    const key = `cart_${restaurantId}`;
    const sanitized = sanitizeCartForStorage(rawData);

    try {
        localStorage.setItem(key, JSON.stringify(sanitized));
        return true;
    } catch (error) {
        if (!isQuotaExceededError(error)) return false;
    }

    try {
        const minimal = buildMinimalFallbackPayload(sanitized);
        localStorage.setItem(key, JSON.stringify(minimal));
        return true;
    } catch {
        return false;
    }
}
