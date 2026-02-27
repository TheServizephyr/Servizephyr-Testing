const { FieldValue } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { resolveRiderContext } = require('./accessControl.service');

async function resolveBusinessRef(firestore, businessId) {
  const collectionOrder = ['restaurants', 'shops', 'street_vendors'];
  for (const collectionName of collectionOrder) {
    const doc = await firestore.collection(collectionName).doc(businessId).get();
    if (doc.exists) return doc.ref;
  }
  return null;
}

async function acceptRiderInvite(req, body = {}) {
  const rider = await resolveRiderContext(req, { checkRevoked: true });
  const firestore = rider.firestore;
  const uid = rider.uid;

  const restaurantId = String(body.restaurantId || '').trim();
  const restaurantName = String(body.restaurantName || '').trim();
  const inviteId = String(body.inviteId || '').trim();

  if (!restaurantId || !restaurantName || !inviteId) {
    throw new HttpError(400, 'Missing invitation details.');
  }

  const businessRef = await resolveBusinessRef(firestore, restaurantId);
  if (!businessRef) {
    throw new HttpError(404, 'The specified business does not exist.');
  }

  const driverData = rider.driverData || {};
  const batch = firestore.batch();

  batch.update(rider.driverRef, {
    currentRestaurantId: restaurantId,
    currentRestaurantName: restaurantName,
  });

  const restaurantRiderRef = businessRef.collection('deliveryBoys').doc(uid);
  batch.set(
    restaurantRiderRef,
    {
      id: uid,
      name: driverData.name || 'Unnamed Rider',
      phone: driverData.phone || 'No Phone',
      email: driverData.email || null,
      status: 'offline',
      createdAt: FieldValue.serverTimestamp(),
      profilePictureUrl: driverData.profilePictureUrl || null,
    },
    { merge: true }
  );

  const inviteRef = firestore.collection('drivers').doc(uid).collection('invites').doc(inviteId);
  batch.delete(inviteRef);
  await batch.commit();

  return {
    message: `Successfully joined ${restaurantName}! You can now go online to receive orders.`,
  };
}

module.exports = {
  acceptRiderInvite,
};
