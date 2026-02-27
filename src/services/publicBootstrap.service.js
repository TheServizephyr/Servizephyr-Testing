const { config } = require('../config/env');
const { getFirestore } = require('../lib/firebaseAdmin');
const { getCache, setCache } = require('../lib/cache');
const { findBusinessById, normalizeBusinessType } = require('./business.service');
const { getEffectiveBusinessOpenStatus } = require('../utils/businessSchedule');
const { HttpError } = require('../utils/httpError');
const { toDateSafe } = require('../utils/guest');

const RESERVED_OPEN_ITEMS_CATEGORY_ID = 'open-items';

const RESTAURANT_CATEGORY_CONFIG = {
  starters: { title: 'Starters' },
  'main-course': { title: 'Main Course' },
  beverages: { title: 'Beverages' },
  desserts: { title: 'Desserts' },
  soup: { title: 'Soup' },
  snacks: { title: 'Snacks' },
  chaat: { title: 'Chaat' },
  sweets: { title: 'Sweets' },
  general: { title: 'General' },
};

const STORE_CATEGORY_CONFIG = {
  electronics: { title: 'Electronics' },
  groceries: { title: 'Groceries' },
  clothing: { title: 'Clothing' },
  books: { title: 'Books' },
  'home-appliances': { title: 'Home Appliances' },
  'beauty-personal-care': { title: 'Beauty & Personal Care' },
  'sports-outdoors': { title: 'Sports & Outdoors' },
  general: { title: 'General' },
};
const inflightBootstrapBuilds = new Map();

function normalizeMenuSource(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  return raw.replace(/[^a-z0-9_-]/g, '').slice(0, 32);
}

function normalizeCouponType(couponType) {
  const normalized = String(couponType || '').trim().toLowerCase();
  if (normalized === 'fixed') return 'flat';
  return normalized;
}

function mapMenuByCategories(menuSnap, categoryConfig) {
  const menuData = {};
  Object.keys(categoryConfig).forEach((key) => {
    menuData[key] = [];
  });

  menuSnap.forEach((doc) => {
    const item = doc.data() || {};
    const categoryKey = String(item.categoryId || 'general');
    if (categoryKey.toLowerCase() === RESERVED_OPEN_ITEMS_CATEGORY_ID) return;
    const targetKey = menuData[categoryKey] ? categoryKey : 'general';
    if (!menuData[targetKey]) menuData[targetKey] = [];
    menuData[targetKey].push({ id: doc.id, ...item });
  });

  Object.keys(menuData).forEach((key) => {
    menuData[key].sort((a, b) => Number(a.order || 999) - Number(b.order || 999));
  });

  return menuData;
}

async function buildFreshBootstrapPayload({ business, businessData, safeRestaurantId, source }) {
  const [menuSnap, couponsSnap, deliveryConfigSnap, customCatSnap] = await Promise.all([
    business.ref.collection('menu').get(),
    business.ref.collection('coupons').where('status', '==', 'active').get(),
    business.ref.collection('delivery_settings').doc('config').get(),
    business.ref.collection('custom_categories').orderBy('order', 'asc').get(),
  ]);

  const deliveryConfig = deliveryConfigSnap.exists ? (deliveryConfigSnap.data() || {}) : {};
  const fallback = (key, defaultValue) => {
    const value = deliveryConfig[key];
    if (value !== undefined && value !== null) return value;
    if (businessData[key] !== undefined && businessData[key] !== null) return businessData[key];
    return defaultValue;
  };

  const customCategories = customCatSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
  const businessType = normalizeBusinessType(businessData.businessType, business.collectionName);
  const baseCategories = businessType === 'store' ? STORE_CATEGORY_CONFIG : RESTAURANT_CATEGORY_CONFIG;
  const categories = { ...baseCategories };
  customCategories.forEach((cat) => {
    if (!cat?.id) return;
    if (!categories[cat.id]) categories[cat.id] = { title: cat.title || 'Category' };
  });

  const coupons = couponsSnap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
    .filter((coupon) => {
      const now = new Date();
      const startDate = toDateSafe(coupon.startDate);
      const expiryDate = toDateSafe(coupon.expiryDate);
      const isPublic = !coupon.customerId;
      const started = !startDate || startDate <= now;
      const unexpired = !expiryDate || expiryDate >= now;
      return isPublic && started && unexpired;
    })
    .map((coupon) => ({
      ...coupon,
      type: normalizeCouponType(coupon.type),
      value: Number(coupon.value || 0),
      minOrder: Number(coupon.minOrder || 0),
      maxDiscount: Number(coupon.maxDiscount || 0),
    }));

  return {
    restaurantId: safeRestaurantId,
    sourceCollection: business.collectionName,
    menuVersion: Number(businessData.menuVersion || 1),
    telemetryEndpoint: source ? `api.public.menu.${source}` : 'api.public.menu',

    latitude:
      businessData.coordinates?.lat ??
      businessData.address?.latitude ??
      businessData.businessAddress?.latitude ??
      null,
    longitude:
      businessData.coordinates?.lng ??
      businessData.address?.longitude ??
      businessData.businessAddress?.longitude ??
      null,

    restaurantName: businessData.name || '',
    approvalStatus: businessData.approvalStatus || 'approved',
    logoUrl: businessData.logoUrl || '',
    bannerUrls: Array.isArray(businessData.bannerUrls) ? businessData.bannerUrls : [],
    businessAddress: businessData.address || businessData.businessAddress || null,
    businessType,
    dineInModel: businessData.dineInModel || 'post-paid',
    isOpen: getEffectiveBusinessOpenStatus(businessData),

    menu: mapMenuByCategories(menuSnap, categories),
    customCategories,
    coupons,
    loyaltyPoints: 0,

    // Delivery settings
    deliveryEnabled: fallback('deliveryEnabled', true),
    pickupEnabled: fallback('pickupEnabled', true),
    dineInEnabled: fallback('dineInEnabled', true),
    minOrderValue: fallback('minOrderValue', 0),
    deliveryFeeType: fallback('deliveryFeeType', 'fixed'),
    deliveryCharge: fallback('deliveryFeeType', 'fixed') === 'fixed' ? fallback('deliveryFixedFee', 30) : 0,
    deliveryFixedFee: fallback('deliveryFixedFee', 30),
    deliveryPerKmFee: fallback('deliveryPerKmFee', 0),
    deliveryBaseDistance: fallback('deliveryBaseDistance', 0),
    deliveryRadius: fallback('deliveryRadius', 5),
    deliveryFreeThreshold: fallback('deliveryFreeThreshold', 500),
    roadDistanceFactor: fallback('roadDistanceFactor', 1.0),
    freeDeliveryRadius: fallback('freeDeliveryRadius', 0),
    freeDeliveryMinOrder: fallback('freeDeliveryMinOrder', 0),
    deliveryTiers: fallback('deliveryTiers', []),
    deliveryOrderSlabRules: fallback('deliveryOrderSlabRules', []),
    deliveryOrderSlabAboveFee: fallback('deliveryOrderSlabAboveFee', 0),
    deliveryOrderSlabBaseDistance: fallback('deliveryOrderSlabBaseDistance', 1),
    deliveryOrderSlabPerKmFee: fallback('deliveryOrderSlabPerKmFee', 15),

    // Payment / charge toggles that old flow fetched via /api/owner/settings
    deliveryCodEnabled: fallback('deliveryCodEnabled', true),
    deliveryOnlinePaymentEnabled: fallback('deliveryOnlinePaymentEnabled', true),
    pickupPodEnabled: fallback('pickupPodEnabled', true),
    pickupOnlinePaymentEnabled: fallback('pickupOnlinePaymentEnabled', true),
    dineInPayAtCounterEnabled: fallback('dineInPayAtCounterEnabled', true),
    dineInOnlinePaymentEnabled: fallback('dineInOnlinePaymentEnabled', true),

    gstEnabled: Boolean(businessData.gstEnabled),
    gstRate: Number(businessData.gstPercentage || businessData.gstRate || 5),
    gstMinAmount: Number(businessData.gstMinAmount || 0),
    convenienceFeeEnabled: Boolean(businessData.convenienceFeeEnabled),
    convenienceFeeRate: Number(businessData.convenienceFeeRate || 2.5),
    convenienceFeePaidBy: String(businessData.convenienceFeePaidBy || 'customer'),
    convenienceFeeLabel: String(businessData.convenienceFeeLabel || 'Payment Processing Fee'),
    packagingChargeEnabled: Boolean(businessData.packagingChargeEnabled),
    packagingChargeAmount: Number(businessData.packagingChargeAmount || 0),
  };
}

async function buildBootstrapPayload({ restaurantId, source = '', skipCache = false }) {
  const safeRestaurantId = String(restaurantId || '').trim();
  if (!safeRestaurantId) throw new HttpError(400, 'Restaurant ID is required');

  const firestore = await getFirestore();
  const business = await findBusinessById({ firestore, businessId: safeRestaurantId });
  const businessData = business.data || {};
  const menuVersion = Number(businessData.menuVersion || 1);
  const cacheKey = `public_bootstrap:${safeRestaurantId}:v${menuVersion}`;

  if (!skipCache) {
    const cached = await getCache(cacheKey);
    if (cached.hit && cached.value) {
      const payload = {
        ...cached.value,
        isOpen: getEffectiveBusinessOpenStatus(businessData),
      };
      return { payload, cacheStatus: cached.source === 'memory' ? 'L1-HIT' : 'HIT' };
    }
  }
  if (!skipCache) {
    const inflight = inflightBootstrapBuilds.get(cacheKey);
    if (inflight) {
      const sharedPayload = await inflight;
      return {
        payload: {
          ...sharedPayload,
          isOpen: getEffectiveBusinessOpenStatus(businessData),
        },
        cacheStatus: 'MISS-COALESCED',
      };
    }
  }

  const buildPromise = buildFreshBootstrapPayload({
    business,
    businessData,
    safeRestaurantId,
    source,
  });

  if (!skipCache) {
    inflightBootstrapBuilds.set(cacheKey, buildPromise);
  }

  try {
    const payload = await buildPromise;
    await setCache(cacheKey, payload, config.cache.publicBootstrapTtlSec);
    return { payload, cacheStatus: 'MISS' };
  } finally {
    if (!skipCache) {
      inflightBootstrapBuilds.delete(cacheKey);
    }
  }
}

module.exports = {
  normalizeMenuSource,
  buildBootstrapPayload,
};
