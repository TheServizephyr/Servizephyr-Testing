const { getFirestore } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { verifyAndGetUid } = require('./authIdentity.service');

async function patchOrderUpdate(req, body = {}) {
  const firestore = await getFirestore();
  const uid = await verifyAndGetUid(req, { checkRevoked: false });

  const orderId = String(body.orderId || '').trim();
  const dineInTabId = String(body.dineInTabId || '').trim();
  const paymentStatus = body.paymentStatus;
  const paymentMethod = body.paymentMethod;

  if (!orderId && !dineInTabId) {
    throw new HttpError(400, 'Either orderId or dineInTabId is required.');
  }

  let ordersToUpdate = [];
  let queryTabId = dineInTabId;

  if (!queryTabId && orderId && orderId.startsWith('tab_')) {
    queryTabId = orderId;
  }

  if (queryTabId) {
    const ordersSnap = await firestore
      .collection('orders')
      .where('dineInTabId', '==', queryTabId)
      .where('status', '!=', 'rejected')
      .get();
    ordersToUpdate = ordersSnap.docs;
  } else if (orderId) {
    const orderDoc = await firestore.collection('orders').doc(orderId).get();
    if (orderDoc.exists) {
      const orderData = orderDoc.data() || {};
      if (uid !== orderData.userId && uid !== orderData.customerId && uid !== orderData.restaurantId) {
        throw new HttpError(403, 'Unauthorized. You do not own this order.');
      }
      ordersToUpdate = [orderDoc];
    }
  }

  if (!ordersToUpdate.length) {
    throw new HttpError(404, 'No orders found to update.');
  }

  const updateData = {};
  if (paymentStatus !== undefined) updateData.paymentStatus = paymentStatus;
  if (paymentMethod !== undefined) updateData.paymentMethod = paymentMethod;
  if (!Object.keys(updateData).length) {
    throw new HttpError(400, 'No valid update fields provided.');
  }

  const batch = firestore.batch();
  ordersToUpdate.forEach((doc) => batch.update(doc.ref, updateData));
  await batch.commit();

  return {
    success: true,
    message: `Payment status updated for ${ordersToUpdate.length} order(s)`,
    updatedOrders: ordersToUpdate.length,
  };
}

module.exports = {
  patchOrderUpdate,
};
