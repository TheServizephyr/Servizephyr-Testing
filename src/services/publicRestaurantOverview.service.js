const { getFirestore } = require('../lib/firebaseAdmin');
const { findBusinessById } = require('./business.service');
const { HttpError } = require('../utils/httpError');

const ORDER_SAMPLE_LIMIT = 180;

const LOST_ORDER_STATUSES = new Set([
  'cancelled',
  'rejected',
  'failed',
  'returned',
  'return_to_restaurant',
]);

const FULFILLED_ORDER_STATUSES = new Set([
  'delivered',
  'completed',
  'served',
  'picked_up',
  'picked-up',
]);

const TOP_DISH_EXCLUSION_REGEX = /\broti\b/i;

function toFiniteNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatCategoryName(rawCategory = '') {
  return String(rawCategory || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getDishQuantity(item = {}) {
  const raw = item.quantity ?? item.qty ?? 1;
  const qty = Number(raw);
  return Number.isFinite(qty) && qty > 0 ? qty : 1;
}

function getItemPrice(item = {}) {
  const directPrice = toFiniteNumber(item.price);
  if (directPrice !== null) return directPrice;

  const portions = Array.isArray(item.portions) ? item.portions : [];
  const prices = portions
    .map((portion) => toFiniteNumber(portion?.price))
    .filter((price) => price !== null);

  if (prices.length === 0) return null;
  return Math.min(...prices);
}

function getAddressText(businessData = {}) {
  const address = businessData.address || businessData.businessAddress || {};
  const parts = [
    address.street,
    address.area,
    address.city,
    address.state,
    address.postalCode,
  ].filter(Boolean);

  return parts.join(', ') || businessData.addressText || 'Address not available';
}

function getCoordinates(businessData = {}) {
  const lat = toFiniteNumber(
    businessData.coordinates?.lat
      ?? businessData.address?.latitude
      ?? businessData.businessAddress?.latitude
  );
  const lng = toFiniteNumber(
    businessData.coordinates?.lng
      ?? businessData.address?.longitude
      ?? businessData.businessAddress?.longitude
  );

  return { lat, lng };
}

async function getPublicRestaurantOverview(restaurantIdInput) {
  const restaurantId = String(restaurantIdInput || '').trim();
  if (!restaurantId) {
    throw new HttpError(400, 'Business ID is required.');
  }

  const firestore = await getFirestore();
  const business = await findBusinessById({
    firestore,
    businessId: restaurantId,
  });

  const businessData = business.data || {};
  const approvalStatus = String(businessData.approvalStatus || 'approved').toLowerCase();
  if (approvalStatus !== 'approved') {
    throw new HttpError(404, 'Business not available.');
  }

  const [menuSnap, ordersSnap] = await Promise.all([
    business.ref.collection('menu').get(),
    firestore.collection('orders').where('restaurantId', '==', business.id).limit(ORDER_SAMPLE_LIMIT).get(),
  ]);

  const menuItems = menuSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const visibleMenuItems = menuItems.filter((item) => item?.isAvailable !== false);

  const categoryCounter = new Map();
  const menuPrices = [];
  let vegCount = 0;
  let nonVegCount = 0;

  visibleMenuItems.forEach((item) => {
    const categoryName = formatCategoryName(item?.categoryId || item?.category || 'General');
    categoryCounter.set(categoryName, (categoryCounter.get(categoryName) || 0) + 1);

    const price = getItemPrice(item);
    if (price !== null) menuPrices.push(price);

    if (item?.isVeg === true) vegCount += 1;
    if (item?.isVeg === false) nonVegCount += 1;
  });

  const orderSamples = ordersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  let fulfilledOrders = 0;
  let lostOrders = 0;
  let prepTimeTotalMinutes = 0;
  let prepTimeSamples = 0;
  let latestOrderAt = null;

  const dishCounter = new Map();

  orderSamples.forEach((order) => {
    const status = String(order?.status || '').toLowerCase();
    if (FULFILLED_ORDER_STATUSES.has(status)) fulfilledOrders += 1;
    if (LOST_ORDER_STATUSES.has(status)) lostOrders += 1;

    const orderDate = toDate(order?.orderDate);
    const readyAt = toDate(order?.readyAt);
    if (orderDate && (!latestOrderAt || orderDate > latestOrderAt)) {
      latestOrderAt = orderDate;
    }

    if (orderDate && readyAt) {
      const diffMinutes = (readyAt.getTime() - orderDate.getTime()) / (1000 * 60);
      if (Number.isFinite(diffMinutes) && diffMinutes > 0 && diffMinutes <= 240) {
        prepTimeTotalMinutes += diffMinutes;
        prepTimeSamples += 1;
      }
    }

    const orderItems = Array.isArray(order?.items) ? order.items : [];
    orderItems.forEach((item) => {
      const name = String(item?.name || '').trim();
      if (!name || TOP_DISH_EXCLUSION_REGEX.test(name)) return;

      const qty = getDishQuantity(item);
      const key = name.toLowerCase();
      const existing = dishCounter.get(key) || { name, orders: 0 };
      existing.orders += qty;
      dishCounter.set(key, existing);
    });
  });

  const topDishes = Array.from(dishCounter.values())
    .sort((a, b) => b.orders - a.orders)
    .slice(0, 3);

  if (topDishes.length < 3) {
    const fallback = visibleMenuItems
      .filter((item) => !TOP_DISH_EXCLUSION_REGEX.test(String(item?.name || '')))
      .map((item) => ({ name: String(item.name || 'Dish'), orders: 0 }))
      .slice(0, 3 - topDishes.length);
    topDishes.push(...fallback);
  }

  const topCategories = Array.from(categoryCounter.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);

  const consideredOrders = Math.max(1, orderSamples.length - lostOrders);
  const fulfilledRate = orderSamples.length > 0
    ? Math.round((fulfilledOrders / consideredOrders) * 100)
    : 92;

  const explicitRating = toFiniteNumber(
    businessData.rating ?? businessData.avgRating ?? businessData.averageRating
  );

  const ratingValue = explicitRating !== null
    ? clamp(explicitRating, 1, 5)
    : clamp(3.9 + (fulfilledRate / 100) * 1.0, 3.9, 4.9);

  const ratingCount = toFiniteNumber(
    businessData.ratingCount ?? businessData.totalRatings,
    Math.max(12, orderSamples.length)
  );

  const avgPrepMins = prepTimeSamples > 0
    ? Math.round(prepTimeTotalMinutes / prepTimeSamples)
    : null;

  const avgItemPrice = menuPrices.length > 0
    ? Math.round(menuPrices.reduce((sum, price) => sum + price, 0) / menuPrices.length)
    : null;

  const minPrice = menuPrices.length > 0 ? Math.min(...menuPrices) : null;
  const maxPrice = menuPrices.length > 0 ? Math.max(...menuPrices) : null;

  const address = businessData.address || businessData.businessAddress || {};
  const rawBusinessType = businessData.businessType || business.type || 'restaurant';
  const normalizedBusinessType = rawBusinessType === 'shop' ? 'store' : rawBusinessType;

  return {
    restaurant: {
      id: business.id,
      name: businessData.name || 'Restaurant',
      logoUrl: businessData.logoUrl || '',
      bannerUrl: Array.isArray(businessData.bannerUrls) ? businessData.bannerUrls[0] : '',
      address: getAddressText(businessData),
      city: address.city || '',
      isOpen: businessData.isOpen !== false,
      businessType: normalizedBusinessType,
      services: {
        delivery: businessData.deliveryEnabled !== false,
        pickup: businessData.pickupEnabled !== false,
        dineIn: businessData.dineInEnabled !== false,
      },
      coordinates: getCoordinates(businessData),
      rating: {
        value: Number(ratingValue.toFixed(1)),
        count: Math.max(0, Math.round(ratingCount || 0)),
      },
    },
    insights: {
      topDishes,
      topCategories,
      metrics: {
        ordersSampled: orderSamples.length,
        fulfilledRate: clamp(fulfilledRate, 0, 100),
        avgPrepMins,
        avgItemPrice,
        menuItems: visibleMenuItems.length,
        vegItems: vegCount,
        nonVegItems: nonVegCount,
        priceRange: {
          min: minPrice,
          max: maxPrice,
        },
        latestOrderAt: latestOrderAt ? latestOrderAt.toISOString() : null,
      },
      notes: {
        topDishRule: 'Top dishes are computed from recent orders and excludes roti items.',
      },
    },
  };
}

module.exports = {
  getPublicRestaurantOverview,
};
