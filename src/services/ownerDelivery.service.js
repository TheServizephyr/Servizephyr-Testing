const { getAuth, FieldValue } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { resolveOwnerContext, PERMISSIONS } = require('./accessControl.service');

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') {
    const converted = value.toDate();
    return converted instanceof Date && !Number.isNaN(converted.getTime()) ? converted : null;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    (Math.sin(dLat / 2) * Math.sin(dLat / 2))
    + (Math.cos(lat1 * (Math.PI / 180))
      * Math.cos(lat2 * (Math.PI / 180))
      * Math.sin(dLon / 2)
      * Math.sin(dLon / 2));
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function mapDriverStatus(rawStatus, isStale) {
  if (isStale) return 'No Signal';
  switch (String(rawStatus || '').trim().toLowerCase()) {
    case 'online':
      return 'Available';
    case 'on-delivery':
      return 'On Delivery';
    case 'offline':
    default:
      return 'Inactive';
  }
}

function calculateOrderWeight(status) {
  switch (String(status || '').trim().toLowerCase()) {
    case 'dispatched':
      return 1;
    case 'reached_restaurant':
      return 1.5;
    case 'picked_up':
      return 2;
    case 'on_the_way':
      return 2.5;
    case 'delivery_attempted':
      return 3;
    default:
      return 1;
  }
}

function calculateRiderScore(rider) {
  const loadScore = toNumber(rider.weightedLoad, 0) * 3;
  const distanceScore = toNumber(rider.distanceToRestaurant, 0) * 0.5;
  const availabilityPenalty = rider.status !== 'Available' ? 100 : 0;
  const stalePenalty = rider.status === 'No Signal' ? 50 : 0;
  const hardBlockPenalty = rider.isHardBlocked ? 1000 : 0;
  return loadScore + distanceScore + availabilityPenalty + stalePenalty + hardBlockPenalty;
}

async function getOwnerDelivery(req) {
  const owner = await resolveOwnerContext(req, {
    requiredPermissions: [PERMISSIONS.VIEW_ORDERS],
  });

  const isLiveOrdersContext = String(req.query.context || '') === 'live_orders';
  const boysRef = owner.businessSnap.ref.collection('deliveryBoys');
  const ordersRef = owner.firestore.collection('orders').where('restaurantId', '==', owner.businessId);

  const [boysSnap, readyOrdersSnap] = await Promise.all([
    boysRef.get(),
    isLiveOrdersContext
      ? Promise.resolve(null)
      : ordersRef.where('status', '==', 'preparing').get(),
  ]);

  let boys = await Promise.all(
    (boysSnap.docs || []).map(async (doc) => {
      const subCollectionData = { id: doc.id, ...(doc.data() || {}) };
      const driverDoc = await owner.firestore.collection('drivers').doc(subCollectionData.id).get();

      let finalBoyData = { ...subCollectionData };
      if (driverDoc.exists) {
        const mainDriverData = driverDoc.data() || {};
        finalBoyData = { ...mainDriverData, ...subCollectionData };

        if (!isLiveOrdersContext) {
          const activeOrdersSnap = await owner.firestore
            .collection('orders')
            .where('deliveryBoyId', '==', subCollectionData.id)
            .where('status', 'in', [
              'dispatched',
              'reached_restaurant',
              'picked_up',
              'on_the_way',
              'delivery_attempted',
            ])
            .get();

          finalBoyData.activeOrders = activeOrdersSnap.size;

          let weightedLoad = 0;
          let hasHeavyStageOrder = false;
          (activeOrdersSnap.docs || []).forEach((activeDoc) => {
            const orderStatus = activeDoc.data()?.status;
            weightedLoad += calculateOrderWeight(orderStatus);
            if (orderStatus === 'on_the_way' || orderStatus === 'delivery_attempted') {
              hasHeavyStageOrder = true;
            }
          });

          finalBoyData.weightedLoad = weightedLoad;
          finalBoyData.isHardBlocked = hasHeavyStageOrder && activeOrdersSnap.size >= 2;
        } else {
          finalBoyData.activeOrders = toNumber(finalBoyData.activeOrders, 0);
          finalBoyData.weightedLoad = toNumber(finalBoyData.weightedLoad, 0);
          finalBoyData.isHardBlocked = false;
        }

        const lastUpdate = toDate(mainDriverData.lastLocationUpdate);
        const isStale = lastUpdate
          ? ((Date.now() - lastUpdate.getTime()) / (1000 * 60)) > 2
          : false;
        finalBoyData.status = mapDriverStatus(mainDriverData.status, isStale);
      }

      return finalBoyData;
    })
  );

  if (!isLiveOrdersContext) {
    const businessData = owner.businessData || {};
    const restaurantLat =
      businessData?.address?.latitude
      || businessData?.restaurantLocation?.lat
      || businessData?.restaurantLocation?._latitude;
    const restaurantLng =
      businessData?.address?.longitude
      || businessData?.restaurantLocation?.lng
      || businessData?.restaurantLocation?._longitude;

    if (restaurantLat && restaurantLng) {
      boys = boys.map((boy) => {
        const riderLat = boy?.currentLocation?._latitude || boy?.currentLocation?.latitude;
        const riderLng = boy?.currentLocation?._longitude || boy?.currentLocation?.longitude;
        if (riderLat && riderLng) {
          return {
            ...boy,
            distanceToRestaurant: getDistanceKm(restaurantLat, restaurantLng, riderLat, riderLng),
          };
        }
        return boy;
      });
    }
  }

  boys.sort((a, b) => calculateRiderScore(a) - calculateRiderScore(b));

  const readyOrders = isLiveOrdersContext
    ? []
    : (readyOrdersSnap.docs || []).map((doc) => ({
      id: doc.id,
      customer: doc.data()?.customerName,
      items: Array.isArray(doc.data()?.items) ? doc.data().items.length : 0,
    }));

  let performance = {
    totalDeliveries: 0,
    avgDeliveryTime: boys.length > 0
      ? Math.round(
        boys.reduce((sum, boy) => sum + toNumber(boy.avgDeliveryTime, 0), 0) / boys.length
      )
      : 0,
    topPerformer: boys[0] || {},
  };

  if (!isLiveOrdersContext) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const deliveredOrdersSnap = await ordersRef
      .where('status', '==', 'delivered')
      .where('orderDate', '>=', today)
      .get();

    const deliveriesByBoy = {};
    (deliveredOrdersSnap.docs || []).forEach((doc) => {
      const orderData = doc.data() || {};
      const riderId = String(orderData.deliveryBoyId || '').trim();
      if (!riderId) return;
      deliveriesByBoy[riderId] = (deliveriesByBoy[riderId] || 0) + 1;
    });

    boys = boys.map((boy) => ({
      ...boy,
      deliveriesToday: deliveriesByBoy[boy.id] || 0,
    }));

    performance = {
      totalDeliveries: boys.reduce((sum, boy) => sum + toNumber(boy.deliveriesToday, 0), 0),
      avgDeliveryTime: boys.length > 0
        ? Math.round(
          boys.reduce((sum, boy) => sum + toNumber(boy.avgDeliveryTime, 0), 0) / boys.length
        )
        : 0,
      topPerformer: boys.length > 0
        ? boys.reduce((top, boy) => (toNumber(boy.deliveriesToday, 0) > toNumber(top.deliveriesToday, 0)
          ? boy
          : top), boys[0])
        : {},
    };
  }

  const weeklyPerformance = Array.from({ length: 7 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - i));
    return {
      day: date.toLocaleDateString('en-IN', { weekday: 'short' }),
      deliveries: 0,
    };
  });

  return {
    boys,
    performance,
    readyOrders,
    weeklyPerformance,
  };
}

async function postOwnerDeliveryBoy(req, body = {}) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
    requiredPermissions: [PERMISSIONS.ASSIGN_RIDER],
  });

  const boy = body.boy;
  if (!boy || !boy.name || !boy.phone) {
    throw new HttpError(400, 'Missing required delivery boy data.');
  }

  const newBoyRef = owner.businessSnap.ref.collection('deliveryBoys').doc();
  const newBoyData = {
    ...boy,
    id: newBoyRef.id,
    status: 'Inactive',
    location: null,
    deliveriesToday: 0,
    totalDeliveries: 0,
    avgDeliveryTime: 0,
    avgRating: 0,
    createdAt: FieldValue.serverTimestamp(),
  };

  await newBoyRef.set(newBoyData);
  return {
    message: 'Delivery Boy added successfully!',
    id: newBoyRef.id,
  };
}

async function patchOwnerDeliveryBoy(req, body = {}) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
    requiredPermissions: [PERMISSIONS.ASSIGN_RIDER],
  });

  const boy = body.boy;
  if (!boy || !boy.id) {
    throw new HttpError(400, 'Boy ID is required for updating.');
  }

  const boyRef = owner.businessSnap.ref.collection('deliveryBoys').doc(String(boy.id));
  const { id, ...updateData } = boy;
  await boyRef.update(updateData);
  return { message: 'Delivery Boy updated successfully!' };
}

async function deleteOwnerDeliveryBoy(req) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
    requiredPermissions: [PERMISSIONS.ASSIGN_RIDER],
  });

  const boyId = String(req.query.id || '').trim();
  if (!boyId) {
    throw new HttpError(400, 'Boy ID is required for deletion.');
  }

  const boyRef = owner.businessSnap.ref.collection('deliveryBoys').doc(boyId);
  await boyRef.delete();
  return { message: 'Delivery Boy removed successfully!' };
}

async function postOwnerDeliveryInvite(req, body = {}) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
    requiredPermissions: [PERMISSIONS.ASSIGN_RIDER],
  });

  const riderEmail = String(body.riderEmail || '').trim().toLowerCase();
  if (!riderEmail) {
    throw new HttpError(400, 'Rider email is required.');
  }

  const auth = await getAuth();
  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(riderEmail);
  } catch (error) {
    if (error?.code === 'auth/user-not-found') {
      throw new HttpError(
        404,
        'No user found with this email address. Please ask them to register on the Rider Portal first.'
      );
    }
    throw error;
  }

  const riderUid = userRecord.uid;
  const driverDocRef = owner.firestore.collection('drivers').doc(riderUid);
  const driverDoc = await driverDocRef.get();
  if (!driverDoc.exists) {
    throw new HttpError(400, 'This user is not registered as a rider.');
  }

  const existingRiderRef = owner.businessSnap.ref.collection('deliveryBoys').doc(riderUid);
  const existingRiderSnap = await existingRiderRef.get();
  if (existingRiderSnap.exists) {
    throw new HttpError(409, 'This rider is already part of your team.');
  }

  const inviteRef = owner.firestore
    .collection('drivers')
    .doc(riderUid)
    .collection('invites')
    .doc(owner.businessId);
  const existingInviteSnap = await inviteRef.get();
  if (existingInviteSnap.exists) {
    throw new HttpError(409, 'An invitation has already been sent to this rider.');
  }

  await inviteRef.set({
    restaurantId: owner.businessId,
    restaurantName: owner.businessData?.name || null,
    invitedAt: FieldValue.serverTimestamp(),
    status: 'pending',
  });

  return {
    message: `Invitation sent successfully to ${riderEmail}!`,
  };
}

module.exports = {
  getOwnerDelivery,
  postOwnerDeliveryBoy,
  patchOwnerDeliveryBoy,
  deleteOwnerDeliveryBoy,
  postOwnerDeliveryInvite,
};
