const { GeoPoint, FieldValue } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { resolveRiderContext } = require('./accessControl.service');
const { emitOrderEvent } = require('./orderEvents.service');

const ACTIVE_RIDER_STATUSES = [
  'ready_for_pickup',
  'dispatched',
  'reached_restaurant',
  'picked_up',
  'on_the_way',
  'rider_arrived',
  'delivery_attempted',
  'failed_delivery',
];

async function getRiderDashboard(req) {
  const rider = await resolveRiderContext(req);
  const firestore = rider.firestore;

  let ordersSnap;
  try {
    ordersSnap = await firestore
      .collection('orders')
      .where('deliveryBoyId', '==', rider.uid)
      .where('status', 'in', ACTIVE_RIDER_STATUSES)
      .get();
  } catch {
    const fallback = await firestore.collection('orders').where('deliveryBoyId', '==', rider.uid).limit(200).get();
    const docs = fallback.docs.filter((doc) =>
      ACTIVE_RIDER_STATUSES.includes(String(doc.data()?.status || '').toLowerCase())
    );
    ordersSnap = { docs };
  }

  const activeOrders = (ordersSnap.docs || []).map((doc) => ({
    id: doc.id,
    ...(doc.data() || {}),
  }));

  return {
    payload: {
      driver: rider.driverData,
      activeOrders,
    },
    context: rider,
  };
}

async function updateRiderDashboard(req, body = {}) {
  const rider = await resolveRiderContext(req, { checkRevoked: true });
  const status = String(body.status || '').trim();
  const location = body.location && typeof body.location === 'object' ? body.location : null;

  if (!status && !location) {
    throw new HttpError(400, 'Either status or location is required.');
  }

  const updateData = {};
  if (status) {
    updateData.status = status;
  }
  if (location) {
    const lat = Number(location.latitude);
    const lng = Number(location.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new HttpError(400, 'Invalid location coordinates.');
    }
    updateData.currentLocation = new GeoPoint(lat, lng);
    updateData.lastLocationUpdate = FieldValue.serverTimestamp();
  }

  await rider.driverRef.update(updateData);

  emitOrderEvent({
    eventType: 'rider.profile.updated',
    riderId: rider.uid,
    data: {
      status: status || null,
      hasLocation: Boolean(location),
    },
  });

  return {
    payload: {
      message: 'Profile updated successfully.',
    },
    context: rider,
  };
}

module.exports = {
  getRiderDashboard,
  updateRiderDashboard,
};
