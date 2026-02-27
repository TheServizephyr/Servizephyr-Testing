const { HttpError } = require('../utils/httpError');

class PricingError extends Error {
  constructor(message, code = 'PRICE_MISMATCH') {
    super(message);
    this.name = 'PricingError';
    this.code = code;
  }
}

async function calculateServerTotal({ firestore, restaurantRef, items }) {
  const safeItems = Array.isArray(items) ? items : [];
  if (!safeItems.length) {
    throw new PricingError('No valid item IDs provided');
  }

  const uniqueItemIds = [
    ...new Set(
      safeItems
        .map((item) => String(item?.id || '').trim())
        .filter(Boolean)
    ),
  ];
  if (!uniqueItemIds.length) {
    throw new PricingError('No valid item IDs provided');
  }

  const menuRef = restaurantRef.collection('menu');
  const itemDocRefs = uniqueItemIds.map((id) => menuRef.doc(id));
  const itemDocs = await firestore.getAll(...itemDocRefs);
  const menuMap = new Map();
  itemDocs.forEach((doc) => {
    if (!doc.exists) return;
    menuMap.set(doc.id, { id: doc.id, ...(doc.data() || {}) });
  });

  const validatedItems = [];
  let serverSubtotal = 0;
  for (const item of safeItems) {
    const unitPrice = validateAndCalculateItemPrice(item, menuMap);
    const quantity = Math.max(1, Number(item.quantity || 1));
    const total = unitPrice * quantity;
    serverSubtotal += total;
    validatedItems.push({
      ...item,
      quantity,
      serverVerifiedPrice: unitPrice,
      serverVerifiedTotal: total,
    });
  }

  return {
    serverSubtotal,
    validatedItems,
    itemCount: validatedItems.length,
  };
}

function validateAndCalculateItemPrice(item, menuMap) {
  const itemId = String(item?.id || '').trim();
  const menuItem = itemId ? menuMap.get(itemId) : null;
  if (!menuItem) {
    throw new PricingError(`Item "${itemId || 'unknown'}" not found in menu`);
  }

  const requestedCategory = String(item?.categoryId || '').trim().toLowerCase();
  const actualCategory = String(menuItem?.categoryId || '').trim().toLowerCase();
  if (requestedCategory && actualCategory && requestedCategory !== actualCategory) {
    throw new PricingError(`Category "${item.categoryId}" does not match menu item category`);
  }

  let basePrice = 0;
  if (item?.portion && Array.isArray(menuItem.portions) && menuItem.portions.length > 0) {
    const portion = menuItem.portions.find((p) => p.name === item.portion.name);
    if (!portion) {
      throw new PricingError(`Portion "${item.portion.name}" not available for "${menuItem.name}"`);
    }
    basePrice = Number(portion.price || 0);
  } else if (!item?.portion && Array.isArray(menuItem.portions) && menuItem.portions.length > 0) {
    if (menuItem.portions.length === 1) {
      basePrice = Number(menuItem.portions[0]?.price || 0);
    } else {
      const clientUnitPrice = Number(item?.price);
      const matchedByPrice = Number.isFinite(clientUnitPrice)
        ? menuItem.portions.find((p) => Number(p?.price) === clientUnitPrice)
        : null;
      if (matchedByPrice) {
        basePrice = Number(matchedByPrice.price || 0);
      } else if (Number(menuItem.price) > 0) {
        basePrice = Number(menuItem.price);
      } else {
        throw new PricingError(`Please select a portion for "${menuItem.name}"`);
      }
    }
  } else {
    basePrice = Number(menuItem.price || 0);
  }

  if (Array.isArray(item.selectedAddOns) && item.selectedAddOns.length > 0) {
    item.selectedAddOns.forEach((selectedAddon) => {
      let addon = null;
      if (Array.isArray(menuItem.addons)) {
        addon = menuItem.addons.find((a) => a.name === selectedAddon.name);
      }
      if (!addon && Array.isArray(menuItem.addOnGroups)) {
        for (const group of menuItem.addOnGroups) {
          if (!Array.isArray(group?.options)) continue;
          addon = group.options.find((opt) => opt.name === selectedAddon.name);
          if (addon) break;
        }
      }
      if (!addon) {
        throw new PricingError(`Addon "${selectedAddon.name}" not available for "${menuItem.name}"`);
      }
      const addonPrice = Number(addon.price || 0);
      const addonQty = Math.max(1, Number(selectedAddon.quantity || 1));
      basePrice += addonPrice * addonQty;
    });
  }

  return basePrice;
}

function validatePriceMatch(clientSubtotal, serverSubtotal, tolerance = 1) {
  const difference = Math.abs(Number(clientSubtotal || 0) - Number(serverSubtotal || 0));
  if (difference > tolerance) {
    throw new PricingError(
      `Price mismatch detected. Please refresh and try again. (Client: ₹${clientSubtotal}, Server: ₹${serverSubtotal}, Diff: ₹${difference.toFixed(2)})`
    );
  }
  return true;
}

function calculateTaxes(subtotal, businessData = {}) {
  const gstEnabled = businessData.gstEnabled || false;
  const gstRate = businessData.gstPercentage !== undefined ? businessData.gstPercentage : (businessData.gstRate || 5);
  if (!gstEnabled) {
    return { cgst: 0, sgst: 0, totalTax: 0 };
  }
  const halfRate = gstRate / 2;
  const cgst = Math.round((subtotal * halfRate) / 100);
  const sgst = Math.round((subtotal * halfRate) / 100);
  return { cgst, sgst, totalTax: cgst + sgst };
}

function mapPricingError(error) {
  if (error instanceof PricingError) {
    return new HttpError(400, error.message, { code: error.code });
  }
  return error;
}

module.exports = {
  PricingError,
  calculateServerTotal,
  validatePriceMatch,
  calculateTaxes,
  mapPricingError,
};
