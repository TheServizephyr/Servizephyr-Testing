const { FieldValue, getFirestore } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { verifyAndGetUid } = require('./authIdentity.service');
const { resolveOwnerContext, PERMISSIONS } = require('./accessControl.service');

async function getBusinessRef(firestore, restaurantId) {
  const collections = ['restaurants', 'shops', 'street_vendors'];
  for (const collectionName of collections) {
    const ref = firestore.collection(collectionName).doc(restaurantId);
    const snap = await ref.get();
    if (snap.exists) return ref;
  }
  return null;
}

async function postOrderCancel(req, body = {}) {
  const firestore = await getFirestore();

  const orderId = String(body.orderId || '').trim();
  const cancelledBy = String(body.cancelledBy || '').trim().toLowerCase();
  const reason = String(body.reason || 'No reason provided').trim();
  const dineInTabId = String(body.dineInTabId || '').trim();
  const restaurantId = String(body.restaurantId || '').trim();

  if (!orderId) {
    throw new HttpError(400, 'Order ID is required.');
  }
  if (!cancelledBy || !['owner', 'customer'].includes(cancelledBy)) {
    throw new HttpError(400, 'Invalid cancelledBy value. Must be "owner" or "customer".');
  }

  const uid = await verifyAndGetUid(req, { checkRevoked: false });
  const orderRef = firestore.collection('orders').doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    throw new HttpError(404, 'Order not found.');
  }

  const orderData = orderSnap.data() || {};
  const effectiveRestaurantId = restaurantId || String(orderData.restaurantId || '').trim();
  const effectiveDineInTabId = dineInTabId || String(orderData.dineInTabId || '').trim();

  if (cancelledBy === 'customer') {
    if (uid !== orderData.userId && uid !== orderData.customerId) {
      throw new HttpError(403, 'Unauthorized. You do not own this order.');
    }
  } else {
    const ownerContext = await resolveOwnerContext(req, {
      checkRevoked: false,
      requiredPermissions: [PERMISSIONS.UPDATE_ORDER_STATUS],
    });
    if (!ownerContext || ownerContext.businessId !== effectiveRestaurantId) {
      throw new HttpError(403, 'Unauthorized. You are not the owner of this business.');
    }
  }

  if (!effectiveRestaurantId) {
    throw new HttpError(400, 'Restaurant ID is required.');
  }

  if (String(orderData.status || '').toLowerCase() === 'cancelled') {
    throw new HttpError(400, 'Order is already cancelled.');
  }

  if (cancelledBy === 'customer') {
    const status = String(orderData.status || '').toLowerCase();
    const allowedStatuses = new Set(['pending', 'confirmed']);
    if (!allowedStatuses.has(status)) {
      throw new HttpError(
        403,
        `Cannot cancel order. Order is already in "${status || 'unknown'}" status. You can only cancel pending or confirmed orders.`
      );
    }
  }

  const batch = firestore.batch();
  batch.update(orderRef, {
    status: 'cancelled',
    paymentStatus: 'cancelled',
    cancelledAt: FieldValue.serverTimestamp(),
    cancelledBy,
    cancellationReason: reason,
  });

  if (effectiveDineInTabId && Number(orderData.totalAmount || 0) > 0) {
    const businessRef = await getBusinessRef(firestore, effectiveRestaurantId);
    if (businessRef) {
      const tabRef = businessRef.collection('dineInTabs').doc(effectiveDineInTabId);
      const tabSnap = await tabRef.get();
      if (tabSnap.exists) {
        batch.update(tabRef, {
          totalBill: FieldValue.increment(-Number(orderData.totalAmount || 0)),
        });
      }
    }
  }

  await batch.commit();

  if (effectiveRestaurantId && effectiveDineInTabId && orderData.deliveryType === 'dine-in') {
    try {
      const businessRef = await getBusinessRef(firestore, effectiveRestaurantId);
      if (businessRef) {
        const remainingOrdersSnap = await firestore
          .collection('orders')
          .where('restaurantId', '==', effectiveRestaurantId)
          .where('deliveryType', '==', 'dine-in')
          .where('dineInTabId', '==', effectiveDineInTabId)
          .where('status', 'not-in', ['rejected', 'cancelled', 'picked_up'])
          .limit(1)
          .get();

        if (remainingOrdersSnap.empty) {
          const tabRef = businessRef.collection('dineInTabs').doc(effectiveDineInTabId);
          await tabRef.set(
            {
              status: 'closed',
              closedAt: FieldValue.serverTimestamp(),
              cleanedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );

          if (orderData.tableId) {
            const activeTabsSnap = await businessRef
              .collection('dineInTabs')
              .where('tableId', '==', orderData.tableId)
              .where('status', '==', 'active')
              .get();

            const recalculatedPax = activeTabsSnap.docs.reduce(
              (sum, doc) => sum + Number(doc.data()?.pax_count || 0),
              0
            );

            await businessRef.collection('tables').doc(orderData.tableId).set(
              {
                current_pax: recalculatedPax,
                state: recalculatedPax > 0 ? 'occupied' : 'available',
                updatedAt: FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
          }
        }
      }
    } catch {
      // Non-fatal, cancellation already committed.
    }
  }

  return {
    message: 'Order cancelled successfully.',
    orderId,
    refundAmount: orderData.totalAmount,
    cancelledBy,
  };
}

module.exports = {
  postOrderCancel,
};
