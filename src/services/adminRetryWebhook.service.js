const { FieldValue } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { resolveAdminContext } = require('./adminAccess.service');

function parseItems(itemsRaw) {
  if (!itemsRaw) return [];
  if (Array.isArray(itemsRaw)) return itemsRaw;
  if (typeof itemsRaw !== 'string') return [];
  try {
    const parsed = JSON.parse(itemsRaw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function retryAdminWebhook(req) {
  const { firestore, uid } = await resolveAdminContext(req, { checkRevoked: true });
  const body = req.body || {};
  const webhookId = String(body.webhookId || '').trim();

  if (!webhookId) {
    throw new HttpError(400, 'Missing webhookId');
  }

  const webhookRef = firestore.collection('failed_webhooks').doc(webhookId);

  let webhookData;
  try {
    webhookData = await firestore.runTransaction(async (transaction) => {
      const snap = await transaction.get(webhookRef);
      if (!snap.exists) throw new Error('NOT_FOUND');

      const data = snap.data() || {};
      if (data.status === 'resolved') throw new Error('ALREADY_RESOLVED');
      if (data.status === 'processing') throw new Error('ALREADY_PROCESSING');

      const retryCount = toNumber(data.retryCount, 0);
      if (retryCount >= 5) {
        transaction.update(webhookRef, {
          status: 'dead_letter',
          lastTriedAt: FieldValue.serverTimestamp(),
        });
        throw new Error('MAX_RETRIES');
      }

      transaction.update(webhookRef, {
        status: 'processing',
        lastTriedAt: FieldValue.serverTimestamp(),
      });

      return data;
    });
  } catch (txError) {
    if (txError.message === 'NOT_FOUND') {
      return {
        status: 404,
        payload: { error: 'Webhook not found' },
      };
    }
    if (txError.message === 'ALREADY_RESOLVED') {
      return {
        status: 200,
        payload: {
          message: 'Webhook already resolved',
          status: 'resolved',
        },
      };
    }
    if (txError.message === 'ALREADY_PROCESSING') {
      return {
        status: 409,
        payload: {
          error: 'Webhook is currently being processed by another request',
          status: 'processing',
        },
      };
    }
    if (txError.message === 'MAX_RETRIES') {
      return {
        status: 400,
        payload: {
          error: 'Max retries exceeded. Marked as dead letter.',
          status: 'dead_letter',
        },
      };
    }
    throw txError;
  }

  try {
    const payload = webhookData.payload;
    if (!payload || payload.event !== 'payment.captured') {
      throw new Error('Invalid payload or event type');
    }

    const paymentEntity = payload?.payload?.payment?.entity || {};
    const paymentId = paymentEntity.id;
    const notes = paymentEntity.notes || {};

    if (!paymentId) {
      throw new Error('Missing payment id in payload');
    }

    const paymentRef = firestore.collection('processed_payments').doc(paymentId);
    await firestore.runTransaction(async (transaction) => {
      const paymentSnap = await transaction.get(paymentRef);
      if (paymentSnap.exists) {
        return;
      }

      if (notes && notes.type === 'addon') {
        const orderId = String(notes.orderId || '').trim();
        if (!orderId) throw new Error('Order not found for add-on');

        const itemsToAdd = parseItems(notes.items);
        const orderRef = firestore.collection('orders').doc(orderId);
        const orderSnap = await transaction.get(orderRef);
        if (!orderSnap.exists) {
          throw new Error('Order not found for add-on');
        }

        const orderData = orderSnap.data() || {};
        const allowedStatuses = new Set(['pending', 'awaiting_payment']);
        if (!allowedStatuses.has(String(orderData.status || '').toLowerCase())) {
          throw new Error(`Order status ${orderData.status} not allowed for add-on`);
        }

        const newItems = [...(Array.isArray(orderData.items) ? orderData.items : []), ...itemsToAdd];
        const newSubtotal = toNumber(orderData.subtotal, 0) + toNumber(notes.subtotal, 0);
        const newCgst = toNumber(orderData.cgst, 0) + toNumber(notes.cgst, 0);
        const newSgst = toNumber(orderData.sgst, 0) + toNumber(notes.sgst, 0);
        const newGrandTotal = toNumber(orderData.totalAmount, 0) + toNumber(notes.grandTotal, 0);

        const paymentDetail = {
          method: 'razorpay',
          amount: toNumber(paymentEntity.amount, 0) / 100,
          razorpay_payment_id: paymentId,
          razorpay_order_id: paymentEntity.order_id || null,
          timestamp: new Date(),
          status: 'paid',
          notes: 'Add-on payment (manual retry)',
        };

        transaction.update(orderRef, {
          items: newItems,
          subtotal: newSubtotal,
          cgst: newCgst,
          sgst: newSgst,
          totalAmount: newGrandTotal,
          paymentDetails: FieldValue.arrayUnion(paymentDetail),
          statusHistory: FieldValue.arrayUnion({
            status: 'updated',
            timestamp: new Date(),
            notes: `Added ${itemsToAdd.length} item(s) via admin retry`,
          }),
        });

        transaction.set(paymentRef, {
          processedAt: FieldValue.serverTimestamp(),
          orderId,
          type: 'addon',
          amount: toNumber(paymentEntity.amount, 0) / 100,
          razorpayOrderId: paymentEntity.order_id || null,
          retriedBy: 'admin',
        });
        return;
      }

      transaction.set(paymentRef, {
        processedAt: FieldValue.serverTimestamp(),
        orderId: notes.orderId || null,
        type: notes.type || 'unknown',
        amount: toNumber(paymentEntity.amount, 0) / 100,
        razorpayOrderId: paymentEntity.order_id || null,
        retriedBy: 'admin',
      });
    });

    await webhookRef.update({
      status: 'resolved',
      retryCount: FieldValue.increment(1),
      lastTriedAt: FieldValue.serverTimestamp(),
      resolvedAt: FieldValue.serverTimestamp(),
      resolvedBy: uid,
    });

    return {
      status: 200,
      payload: {
        message: 'Webhook retried and resolved successfully',
        orderId: notes?.orderId || null,
      },
    };
  } catch (retryError) {
    await webhookRef.update({
      status: 'pending',
      error: retryError.message,
      errorStack: retryError.stack || null,
      retryCount: FieldValue.increment(1),
      lastTriedAt: FieldValue.serverTimestamp(),
    });

    return {
      status: 500,
      payload: {
        error: 'Retry failed',
        details: retryError.message,
        retryCount: toNumber(webhookData.retryCount, 0) + 1,
      },
    };
  }
}

module.exports = {
  retryAdminWebhook,
};
