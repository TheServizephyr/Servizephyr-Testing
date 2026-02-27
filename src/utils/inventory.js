const { FieldValue } = require('../lib/firebaseAdmin');

const INVENTORY_COLLECTION = 'inventory_items';
const INVENTORY_LEDGER_COLLECTION = 'inventory_ledger';
const RESERVED_OPEN_ITEMS_CATEGORY_ID = 'open-items';

const MAX_TOKEN_LENGTH = 40;

function normalizeSearchValue(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function buildSearchTokens(...values) {
  const tokens = new Set();

  values.flat().forEach((value) => {
    const normalized = normalizeSearchValue(value);
    if (!normalized) return;

    tokens.add(normalized.slice(0, MAX_TOKEN_LENGTH));

    normalized
      .split(/[^a-z0-9]+/g)
      .filter(Boolean)
      .forEach((part) => {
        tokens.add(part.slice(0, MAX_TOKEN_LENGTH));
      });
  });

  return Array.from(tokens).slice(0, 50);
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function calculateAvailable(onHand, reserved = 0) {
  const normalizedOnHand = toFiniteNumber(onHand, 0);
  const normalizedReserved = toFiniteNumber(reserved, 0);
  return Math.max(normalizedOnHand - normalizedReserved, 0);
}

function deriveSellPrice(menuItem = {}) {
  if (Array.isArray(menuItem.portions) && menuItem.portions.length > 0) {
    const fullPortion = menuItem.portions.find(
      (portion) => String(portion?.name || '').trim().toLowerCase() === 'full'
    );
    return toFiniteNumber(fullPortion?.price ?? menuItem.portions[0]?.price, 0);
  }
  return toFiniteNumber(menuItem.price, 0);
}

function createFallbackSku(name, itemId) {
  const normalizedName = normalizeSearchValue(name).replace(/[^a-z0-9]+/g, '');
  const prefix = (normalizedName.slice(0, 6) || 'item').toUpperCase();
  const suffix = String(itemId || '').slice(-4).toUpperCase();
  return `${prefix}-${suffix || '0000'}`;
}

function createInventoryPayloadFromMenuItem(menuItemDoc, existingInventory = null) {
  const itemId = menuItemDoc.id;
  const menuItem = menuItemDoc.data() || {};
  const current = existingInventory || {};

  const stockOnHand = toFiniteNumber(
    current.stockOnHand,
    toFiniteNumber(menuItem.stockOnHand, toFiniteNumber(menuItem.stockQuantity, 0))
  );
  const reserved = toFiniteNumber(current.reserved, 0);
  const available = calculateAvailable(stockOnHand, reserved);
  const sellPrice = toFiniteNumber(current.sellPrice, deriveSellPrice(menuItem));
  const sku = String(current.sku || menuItem.sku || createFallbackSku(menuItem.name, itemId)).trim();
  const barcode = String(current.barcode || menuItem.barcode || '').trim();
  const now = FieldValue.serverTimestamp();

  const payload = {
    itemId,
    sourceMenuItemId: itemId,
    name: String(menuItem.name || 'Unnamed Item').trim(),
    categoryId: String(menuItem.categoryId || 'general').trim(),
    sku,
    barcode,
    extraBarcodes: Array.isArray(current.extraBarcodes)
      ? current.extraBarcodes
      : (Array.isArray(menuItem.extraBarcodes) ? menuItem.extraBarcodes : []),
    sellPrice,
    menuPrice: deriveSellPrice(menuItem),
    unit: String(current.unit || menuItem.unit || 'unit').trim(),
    packSize: String(current.packSize || menuItem.packSize || '').trim(),
    isActive: menuItem.isAvailable !== false,
    isDeleted: menuItem.isDeleted === true,
    trackInventory: current.trackInventory !== false,
    stockOnHand,
    reserved,
    available,
    reorderLevel: toFiniteNumber(current.reorderLevel, 0),
    reorderQty: toFiniteNumber(current.reorderQty, 0),
    safetyStock: toFiniteNumber(current.safetyStock, 0),
    updatedAt: now,
    lastSyncedFromMenuAt: now,
    searchTokens: buildSearchTokens(
      menuItem.name,
      current.name,
      sku,
      barcode,
      menuItem.categoryId
    ),
  };

  if (!existingInventory) {
    payload.createdAt = now;
  }

  return payload;
}

function normalizeAdjustmentReason(reason) {
  const normalized = normalizeSearchValue(reason);
  if (!normalized) return 'manual_adjustment';

  const allowed = new Set([
    'manual_adjustment',
    'purchase',
    'sale',
    'return_in',
    'return_out',
    'damage',
    'expiry',
    'count_correction',
  ]);

  return allowed.has(normalized) ? normalized : 'manual_adjustment';
}

module.exports = {
  INVENTORY_COLLECTION,
  INVENTORY_LEDGER_COLLECTION,
  RESERVED_OPEN_ITEMS_CATEGORY_ID,
  normalizeSearchValue,
  buildSearchTokens,
  toFiniteNumber,
  calculateAvailable,
  deriveSellPrice,
  createFallbackSku,
  createInventoryPayloadFromMenuItem,
  normalizeAdjustmentReason,
};
