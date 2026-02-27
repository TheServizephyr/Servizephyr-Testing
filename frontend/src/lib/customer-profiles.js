import { FieldValue } from '@/lib/firebase-admin';

function toNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function normalizePhone(phone) {
    if (!phone) return '';
    const digits = String(phone).replace(/\D/g, '');
    if (!digits) return '';
    return digits.length > 10 ? digits.slice(-10) : digits;
}

function buildAddressObject(addressInput) {
    if (!addressInput) return null;

    if (typeof addressInput === 'string') {
        const trimmed = addressInput.trim();
        return trimmed ? { full: trimmed } : null;
    }

    if (typeof addressInput !== 'object') return null;

    const full =
        addressInput.full ||
        addressInput.address ||
        [addressInput.houseNumber, addressInput.street, addressInput.city, addressInput.state, addressInput.postalCode]
            .filter(Boolean)
            .join(', ');

    const lat = toNumber(addressInput.latitude ?? addressInput.lat, null);
    const lng = toNumber(addressInput.longitude ?? addressInput.lng, null);

    if (!full && lat === null && lng === null) return null;

    return {
        full: full || '',
        ...(lat !== null ? { latitude: lat } : {}),
        ...(lng !== null ? { longitude: lng } : {}),
        ...(addressInput.label ? { label: addressInput.label } : {}),
    };
}

function mergeAddresses(existing, incoming) {
    const safeExisting = Array.isArray(existing) ? existing : [];
    if (!incoming) return safeExisting.slice(0, 10);

    const key = String(incoming.full || '').trim().toLowerCase();
    if (!key) return safeExisting.slice(0, 10);

    const deduped = safeExisting.filter((addr) => String(addr?.full || '').trim().toLowerCase() !== key);
    return [incoming, ...deduped].slice(0, 10);
}

function updateDishStats(existingStats, items, nowIso) {
    const stats = (existingStats && typeof existingStats === 'object') ? { ...existingStats } : {};
    const safeItems = Array.isArray(items) ? items : [];

    for (const item of safeItems) {
        const dishName = String(item?.name || '').trim();
        if (!dishName) continue;

        const quantity = Math.max(1, toNumber(item?.quantity ?? item?.qty, 1));
        const itemPrice = toNumber(item?.price, 0);
        const itemTotal = toNumber(item?.totalPrice, itemPrice * quantity);
        const spend = itemTotal > 0 ? itemTotal : itemPrice * quantity;

        const prev = stats[dishName] || { count: 0, spend: 0, lastOrderedAt: null };
        stats[dishName] = {
            count: toNumber(prev.count, 0) + quantity,
            spend: Number((toNumber(prev.spend, 0) + spend).toFixed(2)),
            lastOrderedAt: nowIso,
        };
    }

    const entries = Object.entries(stats);
    if (entries.length > 120) {
        entries.sort((a, b) => {
            const c1 = toNumber(a[1]?.count, 0);
            const c2 = toNumber(b[1]?.count, 0);
            if (c2 !== c1) return c2 - c1;
            return toNumber(b[1]?.spend, 0) - toNumber(a[1]?.spend, 0);
        });
        const trimmed = entries.slice(0, 120);
        return Object.fromEntries(trimmed);
    }

    return stats;
}

function computeBestDishes(dishStats) {
    const entries = Object.entries(dishStats || {});
    entries.sort((a, b) => {
        const aCount = toNumber(a[1]?.count, 0);
        const bCount = toNumber(b[1]?.count, 0);
        if (bCount !== aCount) return bCount - aCount;
        return toNumber(b[1]?.spend, 0) - toNumber(a[1]?.spend, 0);
    });

    return entries.slice(0, 5).map(([name, data]) => ({
        name,
        count: toNumber(data?.count, 0),
        spend: Number(toNumber(data?.spend, 0).toFixed(2)),
        lastOrderedAt: data?.lastOrderedAt || null,
    }));
}

/**
 * Upserts customer profile inside:
 * `{businessCollection}/{businessId}/customers/{customerDocId}`
 *
 * Keeps one profile per customer and increments aggregate stats per order.
 */
export async function upsertBusinessCustomerProfile({
    firestore,
    businessCollection,
    businessId,
    customerDocId,
    customerName,
    customerEmail = '',
    customerPhone = '',
    customerAddress = null,
    customerStatus = 'verified',
    orderId = null,
    orderSubtotal = 0,
    orderTotal = 0,
    items = [],
    customerType = null,
}) {
    if (!firestore || !businessCollection || !businessId || !customerDocId) return;

    const customerRef = firestore
        .collection(businessCollection)
        .doc(String(businessId))
        .collection('customers')
        .doc(String(customerDocId));

    const nowIso = new Date().toISOString();
    const safePhone = normalizePhone(customerPhone);
    const normalizedAddress = buildAddressObject(customerAddress);
    const subtotalToAdd = Math.max(0, toNumber(orderSubtotal, 0));
    const totalToAdd = Math.max(0, toNumber(orderTotal, 0));

    await firestore.runTransaction(async (tx) => {
        const snap = await tx.get(customerRef);
        const current = snap.exists ? (snap.data() || {}) : {};

        const updatedDishStats = updateDishStats(current.dishStats, items, nowIso);
        const bestDishes = computeBestDishes(updatedDishStats);
        const addresses = mergeAddresses(current.addresses, normalizedAddress);

        const currentTotalOrders = toNumber(current.totalOrders, 0);
        const currentTotalSpend = toNumber(current.totalSpend, 0);
        const currentTotalBillValue = toNumber(current.totalBillValue, currentTotalSpend);

        const recentOrderIds = Array.isArray(current.recentOrderIds) ? [...current.recentOrderIds] : [];
        if (orderId) {
            const oid = String(orderId);
            if (!recentOrderIds.includes(oid)) {
                recentOrderIds.unshift(oid);
            }
        }

        const payload = {
            customerId: String(customerDocId),
            name: customerName || current.name || 'Guest Customer',
            ...(customerEmail ? { email: String(customerEmail).trim().toLowerCase() } : {}),
            ...(safePhone ? { phone: safePhone } : {}),
            status: customerStatus || current.status || 'verified',
            customerType: customerType || current.customerType || (String(customerDocId).startsWith('g_') ? 'guest' : 'uid'),
            totalOrders: currentTotalOrders + 1,
            totalSpend: Number((currentTotalSpend + subtotalToAdd).toFixed(2)),
            totalBillValue: Number((currentTotalBillValue + totalToAdd).toFixed(2)),
            lastOrderDate: FieldValue.serverTimestamp(),
            lastActivityAt: FieldValue.serverTimestamp(),
            ...(orderId ? { lastOrderId: String(orderId) } : {}),
            dishStats: updatedDishStats,
            bestDishes,
            addresses,
            recentOrderIds: recentOrderIds.slice(0, 20),
            updatedAt: FieldValue.serverTimestamp(),
        };

        if (!snap.exists) {
            payload.createdAt = FieldValue.serverTimestamp();
            payload.joinedAt = FieldValue.serverTimestamp();
            payload.firstOrderDate = FieldValue.serverTimestamp();
        }

        tx.set(customerRef, payload, { merge: true });
    });
}
