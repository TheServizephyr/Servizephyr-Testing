const { FieldValue, getFirestore } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { resolveOwnerContext, PERMISSIONS } = require('./accessControl.service');

async function postOrderMarkPaid(req, body = {}) {
  const tabId = String(body.tabId || '').trim();
  const restaurantId = String(body.restaurantId || '').trim();
  const paymentDetails = body.paymentDetails || null;

  if (!tabId || !restaurantId) {
    throw new HttpError(400, 'TabId and RestaurantId required');
  }

  const ownerContext = await resolveOwnerContext(req, {
    checkRevoked: false,
    requiredPermissions: [PERMISSIONS.PROCESS_PAYMENT, PERMISSIONS.MANAGE_DINE_IN],
  });
  if (!ownerContext || ownerContext.businessId !== restaurantId) {
    throw new HttpError(403, 'Unauthorized. Ownership verification failed.');
  }

  const firestore = await getFirestore();
  const ordersQuery = await firestore
    .collection('orders')
    .where('dineInTabId', '==', tabId)
    .where('restaurantId', '==', restaurantId)
    .where('status', 'not-in', ['rejected', 'picked_up'])
    .get();

  if (ordersQuery.empty) {
    throw new HttpError(404, 'No orders found for this tab');
  }

  const batch = firestore.batch();
  ordersQuery.docs.forEach((doc) => {
    batch.update(doc.ref, {
      paymentStatus: 'paid',
      paymentMethod: 'razorpay',
      paymentDetails,
      paidAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();

  return {
    message: 'Orders marked as paid successfully',
    orderCount: ordersQuery.size,
    tabId,
  };
}

module.exports = {
  postOrderMarkPaid,
};
