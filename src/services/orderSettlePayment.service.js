const Razorpay = require('razorpay');
const { getFirestore, FieldValue } = require('../lib/firebaseAdmin');
const { config } = require('../config/env');
const { HttpError } = require('../utils/httpError');
const { verifyAndGetUid } = require('./authIdentity.service');
const { findBusinessById } = require('./business.service');
const { getPhonePeAccessToken } = require('./phonepe.service');

const INACTIVE_ORDER_STATUSES = ['rejected', 'picked_up', 'cancelled'];

function toPositiveAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpError(400, 'Grand total must be a valid positive amount.');
  }
  return Number(amount.toFixed(2));
}

function createRazorpayClient() {
  const keyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new HttpError(500, 'Payment gateway not configured');
  }
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

async function getSettlementOrders({ firestore, restaurantId, tabId }) {
  const uniqueDocs = new Map();

  const [byPrimaryTab, byLegacyTab] = await Promise.all([
    firestore
      .collection('orders')
      .where('restaurantId', '==', restaurantId)
      .where('dineInTabId', '==', tabId)
      .where('status', 'not-in', INACTIVE_ORDER_STATUSES)
      .get()
      .catch(async () => {
        const fallback = await firestore
          .collection('orders')
          .where('restaurantId', '==', restaurantId)
          .where('dineInTabId', '==', tabId)
          .get();
        return {
          docs: fallback.docs.filter(
            (doc) => !INACTIVE_ORDER_STATUSES.includes(String(doc.data()?.status || '').toLowerCase())
          ),
        };
      }),
    firestore
      .collection('orders')
      .where('restaurantId', '==', restaurantId)
      .where('tabId', '==', tabId)
      .where('status', 'not-in', INACTIVE_ORDER_STATUSES)
      .get()
      .catch(async () => {
        const fallback = await firestore
          .collection('orders')
          .where('restaurantId', '==', restaurantId)
          .where('tabId', '==', tabId)
          .get();
        return {
          docs: fallback.docs.filter(
            (doc) => !INACTIVE_ORDER_STATUSES.includes(String(doc.data()?.status || '').toLowerCase())
          ),
        };
      }),
  ]);

  (byPrimaryTab.docs || []).forEach((doc) => uniqueDocs.set(doc.id, doc));
  (byLegacyTab.docs || []).forEach((doc) => uniqueDocs.set(doc.id, doc));

  let dineInToken = '';
  if (uniqueDocs.size > 0) {
    dineInToken = String(uniqueDocs.values().next().value?.data()?.dineInToken || '').trim();
  }
  if (dineInToken) {
    const tokenQuery = await firestore
      .collection('orders')
      .where('restaurantId', '==', restaurantId)
      .where('dineInToken', '==', dineInToken)
      .where('status', 'not-in', INACTIVE_ORDER_STATUSES)
      .get()
      .catch(async () => {
        const fallback = await firestore
          .collection('orders')
          .where('restaurantId', '==', restaurantId)
          .where('dineInToken', '==', dineInToken)
          .get();
        return {
          docs: fallback.docs.filter(
            (doc) => !INACTIVE_ORDER_STATUSES.includes(String(doc.data()?.status || '').toLowerCase())
          ),
        };
      });
    (tokenQuery.docs || []).forEach((doc) => uniqueDocs.set(doc.id, doc));
  }

  return Array.from(uniqueDocs.values());
}

async function createPhonePeSettlement({ tabId, grandTotal, businessName }) {
  const phonePeBaseUrl = String(process.env.PHONEPE_BASE_URL || '').trim();
  if (!phonePeBaseUrl) {
    throw new HttpError(500, 'Payment gateway not configured');
  }

  const accessToken = await getPhonePeAccessToken();
  const amountInPaise = Math.round(grandTotal * 100);
  const settlementId = `phpe_${tabId.replace(/^tab_/, '')}_${Date.now().toString().slice(-5)}`;
  const baseUrl = config.publicBaseUrl || config.legacy.baseUrl || 'https://www.servizephyr.com';
  const redirectUrl = `${baseUrl}/track/dine-in/${encodeURIComponent(tabId)}?payment_status=success`;

  const paymentPayload = {
    merchantOrderId: settlementId,
    amount: amountInPaise,
    expireAfter: 1200,
    paymentFlow: {
      type: 'PG_CHECKOUT',
      message: `Bill Settlement - ${businessName || 'ServiZephyr'}`,
      merchantUrls: {
        redirectUrl,
      },
    },
  };

  const response = await fetch(`${phonePeBaseUrl}/checkout/v2/pay`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `O-Bearer ${accessToken}`,
    },
    body: JSON.stringify(paymentPayload),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.redirectUrl) {
    throw new HttpError(502, payload?.message || 'PhonePe did not return a redirect URL');
  }

  return {
    message: 'PhonePe initiated',
    url: payload.redirectUrl,
    phonepe_order_id: payload.orderId || settlementId,
    tabId,
    method: 'phonepe',
  };
}

async function postOrderSettlePayment(req, body = {}) {
  const tabId = String(body.tabId || '').trim();
  const restaurantId = String(body.restaurantId || '').trim();
  const method = String(body.paymentMethod || '').trim().toLowerCase();
  const grandTotal = toPositiveAmount(body.grandTotal);

  if (!tabId || !restaurantId) {
    throw new HttpError(400, 'TabId and RestaurantId required');
  }
  if (!method) {
    throw new HttpError(400, 'paymentMethod is required');
  }

  // Keep behavior aligned with legacy route: authenticated caller required.
  await verifyAndGetUid(req, { checkRevoked: false });

  const firestore = await getFirestore();
  const business = await findBusinessById({
    firestore,
    businessId: restaurantId,
  });

  if (method === 'razorpay' || method === 'online') {
    const razorpay = createRazorpayClient();
    const razorpayOrder = await razorpay.orders.create({
      amount: Math.round(grandTotal * 100),
      currency: 'INR',
      receipt: `rcpt_${tabId.replace(/^tab_/, '').slice(-12)}_${Date.now().toString().slice(-5)}`,
      notes: {
        type: 'dine-in-settlement',
        tabId,
        restaurantId,
      },
    });

    return {
      message: 'Razorpay order created for settlement',
      razorpay_order_id: razorpayOrder.id,
      tabId,
      amount: grandTotal,
    };
  }

  if (method === 'cod' || method === 'counter') {
    const orderDocs = await getSettlementOrders({
      firestore,
      restaurantId,
      tabId,
    });

    if (orderDocs.length > 0) {
      const batch = firestore.batch();
      orderDocs.forEach((doc) => {
        batch.update(doc.ref, {
          paymentStatus: 'pay_at_counter',
          paymentMethod: 'counter',
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();
    }

    return {
      message: 'Payment marked as pay at counter',
      tabId,
      updatedOrders: orderDocs.length,
    };
  }

  if (method === 'phonepe') {
    return createPhonePeSettlement({
      tabId,
      grandTotal,
      businessName: String(business?.data?.name || ''),
    });
  }

  if (method === 'split_bill') {
    return {
      message: 'Split bill session validated',
      tabId,
      firestore_order_id: tabId,
      method: 'split_bill',
      amount: grandTotal,
    };
  }

  throw new HttpError(400, `Unsupported payment method: ${method}`);
}

module.exports = {
  postOrderSettlePayment,
};
