/**
 * ORDER PRICING SERVICE
 * 
 * SECURITY CRITICAL: Backend price validation
 * 
 * This service recalculates order totals from Firestore menu data
 * to prevent client-side price manipulation attacks.
 * 
 * Attack Prevention:
 * - Client sends: { item: 'burger', price: 1 } (manipulated from ₹200)
 * - Server recalculates from menu: ₹200 (correct price)
 * - Validation fails → Order rejected
 * 
 * Phase 5 Step 2.1
 */

import { getFirestore } from '@/lib/firebase-admin';

/**
 * Custom error for pricing mismatches
 */
export class PricingError extends Error {
    constructor(message, code = 'PRICE_MISMATCH') {
        super(message);
        this.name = 'PricingError';
        this.code = code;
    }
}

/**
 * Get business collection name from type
 */
function getBusinessCollection(businessType) {
    const map = {
        'restaurant': 'restaurants',
        'shop': 'shops',
        'street-vendor': 'street_vendors',
        'street_vendor': 'street_vendors',
    };
    return map[businessType] || 'restaurants';
}

/**
 * Calculate server-side total from Firestore menu data
 * 
 * @param {Object} params
 * @param {string} params.restaurantId - Business ID
 * @param {Array} params.items - Cart items from client
 * @param {string} params.businessType - Business type
 * @returns {Promise<Object>} Server-calculated pricing
 */
export async function calculateServerTotal({ restaurantId, items, businessType = 'restaurant' }) {
    console.log(`[OrderPricing] Calculating server total for ${restaurantId}`);

    const firestore = await getFirestore();
    const collectionName = getBusinessCollection(businessType);
    const menuRef = firestore.collection(collectionName).doc(restaurantId).collection('menu');

    let serverSubtotal = 0;
    const validatedItems = [];

    const uniqueItemIds = [
        ...new Set(
            (items || [])
                .map((item) => String(item?.id || '').trim())
                .filter(Boolean)
        )
    ];

    if (uniqueItemIds.length === 0) {
        throw new PricingError('No valid item IDs provided');
    }

    // Performance fix: fetch only ordered item documents instead of entire menu collection.
    const itemDocRefs = uniqueItemIds.map((itemId) => menuRef.doc(itemId));
    const itemDocs = await firestore.getAll(...itemDocRefs);
    const menuItemMap = new Map();

    itemDocs.forEach((docSnap) => {
        if (!docSnap.exists) return;
        menuItemMap.set(docSnap.id, {
            ...docSnap.data(),
            id: docSnap.id
        });
    });

    for (const item of items) {
        try {
            const itemPrice = await validateAndCalculateItemPrice(item, menuItemMap);
            const itemQuantity = item.quantity || 1;
            const itemTotal = itemPrice * itemQuantity;

            serverSubtotal += itemTotal;

            validatedItems.push({
                ...item,
                serverVerifiedPrice: itemPrice,
                serverVerifiedTotal: itemTotal,
                quantity: itemQuantity
            });

            console.log(`[OrderPricing] Item ${item.id}: ₹${itemPrice} x ${itemQuantity} = ₹${itemTotal} (Client expected price: ₹${item.price || item.totalPrice / itemQuantity || 'unknown'})`);

        } catch (error) {
            console.error(`[OrderPricing] Validation failed for item ${item.id}:`, error.message);
            throw new PricingError(
                `Item "${item.name || item.id}" validation failed: ${error.message}`
            );
        }
    }

    console.log(`[OrderPricing] Server subtotal: ₹${serverSubtotal}`);

    return {
        serverSubtotal,
        validatedItems,
        itemCount: items.length
    };
}

/**
 * Validate single item and calculate its price
 * 
 * @param {Object} item - Cart item
 * @param {Map} menuItemMap - Menu item map keyed by itemId
 * @returns {Promise<number>} Validated item price
 */
async function validateAndCalculateItemPrice(item, menuItemMap) {
    const requestedItemId = String(item?.id || '').trim();
    const menuItem = requestedItemId ? menuItemMap.get(requestedItemId) : null;

    if (!menuItem) {
        throw new PricingError(`Item "${item.id}" not found in menu`);
    }

    const requestedCategory = String(item?.categoryId || '').trim().toLowerCase();
    const actualCategory = String(menuItem?.categoryId || '').trim().toLowerCase();
    if (requestedCategory && actualCategory && requestedCategory !== actualCategory) {
        throw new PricingError(`Category "${item.categoryId}" does not match menu item category`);
    }

    let basePrice = 0;

    // Validate portion price (if applicable)
    if (item.portion && menuItem.portions && menuItem.portions.length > 0) {
        const portion = menuItem.portions.find(p => p.name === item.portion.name);

        if (!portion) {
            throw new PricingError(
                `Portion "${item.portion.name}" not available for "${menuItem.name}"`
            );
        }

        basePrice = portion.price || 0;
        console.log(`[OrderPricing] Portion "${portion.name}": ₹${basePrice}`);

    } else if (!item.portion && menuItem.portions && menuItem.portions.length > 0) {
        // Portion not explicitly provided.
        // 1) Single-portion menu item: auto-select that one.
        if (menuItem.portions.length === 1) {
            const singlePortion = menuItem.portions[0];
            basePrice = singlePortion?.price || 0;
            console.log(`[OrderPricing] Auto-selected single portion "${singlePortion?.name}": ₹${basePrice}`);
        } else {
            // 2) Multi-portion item: try safe fallback by exact client price match.
            const clientUnitPrice = Number(item?.price);
            const matchedByPrice = Number.isFinite(clientUnitPrice)
                ? menuItem.portions.find((p) => Number(p?.price) === clientUnitPrice)
                : null;

            if (matchedByPrice) {
                basePrice = matchedByPrice.price || 0;
                console.log(`[OrderPricing] Auto-matched portion by price "${matchedByPrice?.name}": ₹${basePrice}`);
            } else if (Number(menuItem.price) > 0) {
                // 3) If menu has explicit base price, use it.
                basePrice = menuItem.price || 0;
                console.log(`[OrderPricing] Fallback base price (multi-portion item): ₹${basePrice}`);
            } else {
                throw new PricingError(`Please select a portion for "${menuItem.name}"`);
            }
        }
    } else {
        // Use base item price
        basePrice = menuItem.price || 0;
        console.log(`[OrderPricing] Base price: ₹${basePrice}`);
    }

    // Validate and add addon prices
    if (item.selectedAddOns && Array.isArray(item.selectedAddOns)) {
        for (const selectedAddon of item.selectedAddOns) {
            // ✅ FIX: Support both flat addons array AND addOnGroups structure
            let addon = null;

            // Try flat addons array (legacy)
            if (menuItem.addons && Array.isArray(menuItem.addons)) {
                addon = menuItem.addons.find(a => a.name === selectedAddon.name);
            }

            // Try addOnGroups structure (new format)
            if (!addon && menuItem.addOnGroups && Array.isArray(menuItem.addOnGroups)) {
                for (const group of menuItem.addOnGroups) {
                    if (group.options && Array.isArray(group.options)) {
                        addon = group.options.find(opt => opt.name === selectedAddon.name);
                        if (addon) break; // Found it!
                    }
                }
            }

            if (!addon) {
                throw new PricingError(
                    `Addon "${selectedAddon.name}" not available for "${menuItem.name}"`
                );
            }

            const addonPrice = addon.price || 0;
            const addonQty = selectedAddon.quantity || 1;
            basePrice += addonPrice * addonQty;

            console.log(`[OrderPricing] Addon "${addon.name}": ₹${addonPrice} x ${addonQty}`);
        }
    }

    return basePrice;
}

/**
 * Validate client subtotal against server calculation
 * 
 * @param {number} clientSubtotal - Subtotal from client
 * @param {number} serverSubtotal - Server-calculated subtotal
 * @param {number} tolerance - Allowed difference (for rounding)
 * @returns {boolean} True if valid
 */
export function validatePriceMatch(clientSubtotal, serverSubtotal, tolerance = 1) {
    const difference = Math.abs(clientSubtotal - serverSubtotal);

    console.log(`[OrderPricing] Price validation:`);
    console.log(`  Client: ₹${clientSubtotal}`);
    console.log(`  Server: ₹${serverSubtotal}`);
    console.log(`  Difference: ₹${difference}`);
    console.log(`  Tolerance: ₹${tolerance}`);

    if (difference > tolerance) {
        console.error(`[OrderPricing] Price mismatch detail:`);
        console.error(`  Client Subtotal: ₹${clientSubtotal}`);
        console.error(`  Server Subtotal: ₹${serverSubtotal}`);
        console.error(`  Difference: ₹${difference}`);

        throw new PricingError(
            `Price mismatch detected. Menu prices may have changed. Please refresh and try again. (Client: ₹${clientSubtotal}, Server: ₹${serverSubtotal}, Diff: ₹${difference.toFixed(2)})`
        );
    }

    return true;
}

/**
 * Calculate taxes based on business settings
 * 
 * @param {number} subtotal - Subtotal amount
 * @param {Object} businessData - Business document data
 * @returns {Object} Tax calculation
 */
export function calculateTaxes(subtotal, businessData) {
    const gstEnabled = businessData.gstEnabled || false;
    const gstRate = businessData.gstPercentage !== undefined ? businessData.gstPercentage : (businessData.gstRate || 5);

    if (!gstEnabled) {
        return {
            cgst: 0,
            sgst: 0,
            totalTax: 0
        };
    }

    const halfRate = gstRate / 2;
    const cgst = Math.round((subtotal * halfRate) / 100);
    const sgst = Math.round((subtotal * halfRate) / 100);

    return {
        cgst,
        sgst,
        totalTax: cgst + sgst
    };
}
