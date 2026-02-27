const { HttpError } = require('../utils/httpError');
const { resolveRiderContext } = require('./accessControl.service');
const { findBusinessById } = require('./business.service');
const { optimizeDeliveryRoute, formatRouteForGoogleMaps } = require('../utils/routeOptimizer');

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function extractBusinessCoordinates(businessData = {}) {
  const lat = toFiniteNumber(
    businessData.location?._latitude
    ?? businessData.location?.latitude
    ?? businessData.location?.lat
    ?? businessData.address?.latitude
    ?? businessData.address?.lat
    ?? businessData.address?._latitude
    ?? businessData.restaurantLocation?._latitude
    ?? businessData.restaurantLocation?.latitude
    ?? businessData.restaurantLocation?.lat
    ?? businessData.coordinates?._latitude
    ?? businessData.coordinates?.latitude
    ?? businessData.coordinates?.lat
  );

  const lng = toFiniteNumber(
    businessData.location?._longitude
    ?? businessData.location?.longitude
    ?? businessData.location?.lng
    ?? businessData.address?.longitude
    ?? businessData.address?.lng
    ?? businessData.address?._longitude
    ?? businessData.restaurantLocation?._longitude
    ?? businessData.restaurantLocation?.longitude
    ?? businessData.restaurantLocation?.lng
    ?? businessData.coordinates?._longitude
    ?? businessData.coordinates?.longitude
    ?? businessData.coordinates?.lng
  );

  const address = typeof businessData.address === 'object'
    ? (businessData.address?.full || '')
    : String(businessData.address || '');

  return {
    lat,
    lng,
    address: address || String(businessData.restaurantName || businessData.name || ''),
  };
}

function extractOrderCoordinates(orderData = {}) {
  const lat = toFiniteNumber(
    orderData.customerLocation?._latitude
    ?? orderData.customerLocation?.latitude
    ?? orderData.customerLocation?.lat
    ?? orderData.deliveryLocation?._latitude
    ?? orderData.deliveryLocation?.latitude
    ?? orderData.address?.coordinates?._latitude
    ?? orderData.address?.coordinates?.latitude
  );

  const lng = toFiniteNumber(
    orderData.customerLocation?._longitude
    ?? orderData.customerLocation?.longitude
    ?? orderData.customerLocation?.lng
    ?? orderData.deliveryLocation?._longitude
    ?? orderData.deliveryLocation?.longitude
    ?? orderData.address?.coordinates?._longitude
    ?? orderData.address?.coordinates?.longitude
  );

  return { lat, lng };
}

function calculateFuelSavings(distanceSavedKm) {
  if (!distanceSavedKm || distanceSavedKm <= 0) {
    return {
      distanceKm: 0,
      fuelLiters: 0,
      moneyRupees: 0,
    };
  }

  const MILEAGE_KM_PER_LITER = 40;
  const PETROL_PRICE_PER_LITER = 100;

  const fuelSavedLiters = distanceSavedKm / MILEAGE_KM_PER_LITER;
  const moneySaved = fuelSavedLiters * PETROL_PRICE_PER_LITER;

  return {
    distanceKm: Number(distanceSavedKm.toFixed(2)),
    fuelLiters: Number(fuelSavedLiters.toFixed(3)),
    moneyRupees: Number(moneySaved.toFixed(2)),
  };
}

async function optimizeRiderRoute(req, body = {}) {
  const rider = await resolveRiderContext(req, { checkRevoked: true });
  const firestore = rider.firestore;

  const orderIds = Array.isArray(body.orderIds)
    ? body.orderIds.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  const restaurantId = String(body.restaurantId || '').trim();

  if (!orderIds.length) {
    throw new HttpError(400, 'Order IDs required');
  }
  if (!restaurantId) {
    throw new HttpError(400, 'Restaurant ID required');
  }

  const business = await findBusinessById({
    firestore,
    businessId: restaurantId,
  });

  const restaurantData = business.data || {};
  const restaurantLocation = extractBusinessCoordinates(restaurantData);
  if (restaurantLocation.lat === null || restaurantLocation.lng === null) {
    throw new HttpError(400, 'Restaurant location not configured. Please add restaurant address in settings.');
  }

  const orderDocs = await Promise.all(
    orderIds.map((orderId) => firestore.collection('orders').doc(orderId).get())
  );

  const orders = orderDocs
    .filter((doc) => doc.exists)
    .map((doc) => {
      const data = doc.data() || {};
      const coords = extractOrderCoordinates(data);
      return {
        orderId: doc.id,
        ...data,
        lat: coords.lat,
        lng: coords.lng,
      };
    })
    .filter((order) => order.lat !== null && order.lng !== null);

  if (!orders.length) {
    throw new HttpError(404, 'No valid orders found');
  }

  const optimizationResult = optimizeDeliveryRoute(restaurantLocation, orders);
  const googleMapsUrl = formatRouteForGoogleMaps(optimizationResult.optimizedRoute, restaurantLocation);

  return {
    success: true,
    optimizedRoute: optimizationResult.optimizedRoute.map((order, index) => ({
      sequence: index + 1,
      orderId: order.orderId,
      customerName: order.customerName,
      customerAddress: order.customerAddress,
      customerLocation: order.customerLocation,
      totalAmount: order.totalAmount,
      paymentMethod: order.paymentMethod,
      deliveryPriority: order.deliveryPriority,
    })),
    metrics: {
      totalDistance: optimizationResult.totalDistance,
      distanceSaved: optimizationResult.metrics.distanceSaved,
      deliveryCount: orders.length,
      computationTime: optimizationResult.computationTime,
      fuelSavings: calculateFuelSavings(optimizationResult.metrics.distanceSaved),
    },
    googleMapsUrl,
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  optimizeRiderRoute,
};
