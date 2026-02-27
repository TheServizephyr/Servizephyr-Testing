const { randomUUID } = require('crypto');
const { getFirestore, FieldValue } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');

const ACTIVE_TAB_STATUSES = new Set(['active']);
const OCCUPIED_TAB_STATUSES = new Set(['active', 'locked_for_payment', 'payment_initiated']);
const ORDER_STATUS_ALLOWLIST = ['pending', 'accepted', 'preparing', 'ready', 'delivered'];

function normalizeToken(value) {
  return String(value || '').trim();
}

function createTabId() {
  return `tab_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function createTabToken() {
  return randomUUID().replace(/-/g, '');
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveString(value) {
  return String(value || '').trim();
}

async function getBusinessDocById(firestore, businessId) {
  const safeId = resolveString(businessId);
  if (!safeId) return null;

  for (const collectionName of ['restaurants', 'shops', 'street_vendors']) {
    const doc = await firestore.collection(collectionName).doc(safeId).get();
    if (doc.exists) {
      return {
        id: doc.id,
        collectionName,
        data: doc.data() || {},
      };
    }
  }
  return null;
}

async function fetchTabById(firestore, tabId) {
  const safeTabId = resolveString(tabId);
  if (!safeTabId) return null;
  const tabRef = firestore.collection('dine_in_tabs').doc(safeTabId);
  const tabSnap = await tabRef.get();
  if (!tabSnap.exists) return null;
  return {
    id: tabSnap.id,
    ref: tabRef,
    data: tabSnap.data() || {},
  };
}

async function validateTabToken({ firestore, tabId, token }) {
  const safeToken = normalizeToken(token);
  if (!safeToken) {
    throw new HttpError(400, 'Missing required token.');
  }
  const tab = await fetchTabById(firestore, tabId);
  if (!tab) {
    throw new HttpError(404, 'Tab not found.');
  }

  const storedToken = normalizeToken(tab.data.token);
  if (!storedToken || storedToken !== safeToken) {
    throw new HttpError(401, 'Invalid token.');
  }
  return tab;
}

async function getDineInTableStatus(req) {
  const firestore = await getFirestore();
  const restaurantId = resolveString(req.query.restaurantId);
  const tableId = resolveString(req.query.tableId);
  if (!restaurantId || !tableId) {
    throw new HttpError(400, 'restaurantId and tableId are required.');
  }

  const tabsSnapshot = await firestore
    .collection('dine_in_tabs')
    .where('tableId', '==', tableId)
    .where('restaurantId', '==', restaurantId)
    .where('status', '==', 'active')
    .limit(1)
    .get();

  if (tabsSnapshot.empty) {
    return {
      hasActiveTab: false,
      tableId,
      restaurantId,
    };
  }

  const tabDoc = tabsSnapshot.docs[0];
  const tabData = tabDoc.data() || {};
  const ordersSnapshot = await firestore
    .collection('dine_in_tabs')
    .doc(tabDoc.id)
    .collection('orders')
    .get()
    .catch(async () => ({ size: 0 }));

  return {
    hasActiveTab: true,
    tabData: {
      id: tabDoc.id,
      tableId: tabData.tableId,
      capacity: toNumber(tabData.capacity, 0),
      occupiedSeats: toNumber(tabData.occupiedSeats, 0),
      availableSeats: toNumber(tabData.availableSeats, 0),
      orderCount: toNumber(ordersSnapshot.size, 0),
      totalAmount: toNumber(tabData.totalAmount, 0),
      pendingAmount: toNumber(tabData.pendingAmount, 0),
      token: tabData.token || null,
      createdAt: tabData.createdAt || null,
      status: tabData.status || 'active',
    },
  };
}

async function createDineInTab(body = {}) {
  const restaurantId = resolveString(body.restaurantId);
  const tableId = resolveString(body.tableId);
  const capacity = toNumber(body.capacity, 0);
  const groupSize = Math.max(1, toNumber(body.groupSize, 1));
  const customerName = resolveString(body.customerName);

  if (!restaurantId || !tableId || capacity <= 0) {
    throw new HttpError(400, 'restaurantId, tableId and capacity are required.');
  }
  if (groupSize > capacity) {
    throw new HttpError(400, 'Group size exceeds table capacity.');
  }

  const firestore = await getFirestore();
  const result = await firestore.runTransaction(async (transaction) => {
    const tabsRef = firestore.collection('dine_in_tabs');
    const tableTabsQuery = tabsRef
      .where('tableId', '==', tableId)
      .where('restaurantId', '==', restaurantId);
    const tableTabsSnap = await transaction.get(tableTabsQuery);

    let currentOccupied = 0;
    let existingActiveTab = null;
    tableTabsSnap.docs.forEach((doc) => {
      const data = doc.data() || {};
      const status = resolveString(data.status).toLowerCase();
      if (OCCUPIED_TAB_STATUSES.has(status)) {
        currentOccupied += Math.max(0, toNumber(data.occupiedSeats, 0));
      }
      if (ACTIVE_TAB_STATUSES.has(status) && !existingActiveTab) {
        existingActiveTab = {
          id: doc.id,
          ref: doc.ref,
          data,
        };
      }
    });

    if (currentOccupied + groupSize > capacity) {
      throw new HttpError(
        400,
        `Table capacity exceeded. Occupied: ${currentOccupied}/${capacity}, requested: ${groupSize}`
      );
    }

    if (existingActiveTab) {
      const nextOccupied = toNumber(existingActiveTab.data.occupiedSeats, 0) + groupSize;
      const nextAvailable = Math.max(0, capacity - nextOccupied);
      transaction.update(existingActiveTab.ref, {
        occupiedSeats: nextOccupied,
        availableSeats: nextAvailable,
        lastModifiedAt: FieldValue.serverTimestamp(),
      });

      return {
        success: true,
        exists: true,
        joined: true,
        tabId: existingActiveTab.id,
        token: existingActiveTab.data.token || null,
        occupiedSeats: nextOccupied,
        availableSeats: nextAvailable,
        capacity,
      };
    }

    const tabId = createTabId();
    const token = createTabToken();
    const tabRef = tabsRef.doc(tabId);
    transaction.set(tabRef, {
      restaurantId,
      tableId,
      capacity,
      occupiedSeats: groupSize,
      availableSeats: capacity - groupSize,
      status: 'active',
      token,
      totalAmount: 0,
      paidAmount: 0,
      pendingAmount: 0,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: customerName || 'Guest',
      lastRecalculatedAt: FieldValue.serverTimestamp(),
      lastModifiedAt: FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      exists: false,
      joined: false,
      tabId,
      token,
      occupiedSeats: groupSize,
      availableSeats: capacity - groupSize,
      capacity,
    };
  });

  return result;
}

async function joinDineInTable(body = {}) {
  const tabId = resolveString(body.tabId);
  const token = resolveString(body.token);
  const customerName = resolveString(body.customerName) || 'Guest';
  if (!tabId || !token) {
    throw new HttpError(400, 'tabId and token are required.');
  }

  const firestore = await getFirestore();
  await validateTabToken({ firestore, tabId, token });

  await firestore.runTransaction(async (transaction) => {
    const tabRef = firestore.collection('dine_in_tabs').doc(tabId);
    const tabSnap = await transaction.get(tabRef);
    if (!tabSnap.exists) {
      throw new HttpError(404, 'Tab not found.');
    }
    const tabData = tabSnap.data() || {};

    const occupiedSeats = toNumber(tabData.occupiedSeats, 0);
    const capacity = toNumber(tabData.capacity, 0);
    if (occupiedSeats >= capacity) {
      throw new HttpError(400, 'Table is full.');
    }

    transaction.update(tabRef, {
      occupiedSeats: FieldValue.increment(1),
      availableSeats: FieldValue.increment(-1),
      lastModifiedAt: FieldValue.serverTimestamp(),
    });

    const customerRef = tabRef.collection('customers').doc();
    transaction.set(customerRef, {
      name: customerName,
      joinedAt: FieldValue.serverTimestamp(),
    });
  });

  return { success: true };
}

async function getDineInTabStatus(req) {
  const firestore = await getFirestore();
  const tabId = resolveString(req.params.tabId);
  const restaurantId = resolveString(req.query.restaurantId);
  if (!tabId || !restaurantId) {
    throw new HttpError(400, 'tabId and restaurantId are required.');
  }

  let ordersSnapshot;
  try {
    ordersSnapshot = await firestore
      .collection('orders')
      .where('restaurantId', '==', restaurantId)
      .where('dineInTabId', '==', tabId)
      .where('status', 'in', ORDER_STATUS_ALLOWLIST)
      .orderBy('orderDate', 'asc')
      .get();
  } catch {
    const fallback = await firestore
      .collection('orders')
      .where('restaurantId', '==', restaurantId)
      .where('dineInTabId', '==', tabId)
      .get();
    const sortedDocs = fallback.docs
      .filter((doc) => ORDER_STATUS_ALLOWLIST.includes(resolveString(doc.data()?.status).toLowerCase()))
      .sort((a, b) => {
        const at = toNumber(a.data()?.orderDate?.toMillis?.(), 0);
        const bt = toNumber(b.data()?.orderDate?.toMillis?.(), 0);
        return at - bt;
      });
    ordersSnapshot = { docs: sortedDocs, empty: sortedDocs.length === 0 };
  }

  if (ordersSnapshot.empty) {
    throw new HttpError(404, 'No orders found for this tab.');
  }

  const orders = [];
  let allItems = [];
  let totalSubtotal = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalAmount = 0;
  let dineInToken = null;
  let tableId = null;
  let tabName = null;
  let paxCount = null;
  let latestStatus = 'pending';

  (ordersSnapshot.docs || []).forEach((doc) => {
    const orderData = doc.data() || {};
    orders.push({ id: doc.id, ...orderData });
    if (Array.isArray(orderData.items)) {
      allItems = allItems.concat(orderData.items);
    }
    totalSubtotal += toNumber(orderData.subtotal, 0);
    totalCgst += toNumber(orderData.cgst, 0);
    totalSgst += toNumber(orderData.sgst, 0);
    totalAmount += toNumber(orderData.totalAmount, 0);
    if (!dineInToken) dineInToken = orderData.dineInToken || null;
    if (!tableId) tableId = orderData.tableId || null;
    if (!tabName) tabName = orderData.tab_name || null;
    if (!paxCount) paxCount = toNumber(orderData.pax_count, 0) || null;
    latestStatus = orderData.status || latestStatus;
  });

  const business = await getBusinessDocById(firestore, restaurantId);
  if (!business) {
    throw new HttpError(404, 'Restaurant not found.');
  }

  return {
    tab: {
      id: tabId,
      dineInToken,
      tableId,
      tabName,
      paxCount,
      status: latestStatus,
      totalOrders: orders.length,
    },
    aggregated: {
      items: allItems,
      subtotal: Number(totalSubtotal.toFixed(2)),
      cgst: Number(totalCgst.toFixed(2)),
      sgst: Number(totalSgst.toFixed(2)),
      grandTotal: Number(totalAmount.toFixed(2)),
    },
    orders: orders.map((order) => ({
      id: order.id,
      status: order.status,
      items: order.items,
      totalAmount: order.totalAmount,
      orderDate: order.orderDate,
    })),
    restaurant: {
      id: business.id,
      name: business.data.name || '',
      address: business.data.address || null,
    },
  };
}

async function initiateDineInPayment(body = {}) {
  const tabId = resolveString(body.tabId);
  const token = resolveString(body.token);
  const paymentMethod = resolveString(body.paymentMethod);
  if (!tabId || !token) {
    throw new HttpError(400, 'tabId and token are required.');
  }

  const firestore = await getFirestore();
  await validateTabToken({ firestore, tabId, token });

  await firestore.runTransaction(async (transaction) => {
    const tabRef = firestore.collection('dine_in_tabs').doc(tabId);
    const tabSnap = await transaction.get(tabRef);
    if (!tabSnap.exists) {
      throw new HttpError(404, 'Tab not found.');
    }

    const tabData = tabSnap.data() || {};
    if (resolveString(tabData.status).toLowerCase() === 'locked_for_payment') {
      throw new HttpError(409, 'Another payment is already in progress.');
    }

    transaction.update(tabRef, {
      status: 'locked_for_payment',
      paymentInitiatedAt: FieldValue.serverTimestamp(),
      paymentMethod: paymentMethod || null,
      lastModifiedAt: FieldValue.serverTimestamp(),
    });
  });

  const tab = await fetchTabById(firestore, tabId);
  const pendingAmount = toNumber(tab?.data?.pendingAmount, 0);
  if (pendingAmount <= 0) {
    await tab.ref.update({
      status: 'active',
      paymentInitiatedAt: null,
      paymentMethod: null,
      lastModifiedAt: FieldValue.serverTimestamp(),
    });
    throw new HttpError(400, 'No pending amount.');
  }

  return {
    success: true,
    amount: pendingAmount,
    tabId,
    paymentLocked: true,
  };
}

async function unlockDineInPayment(body = {}) {
  const tabId = resolveString(body.tabId);
  const token = resolveString(body.token);
  const reason = resolveString(body.reason) || 'Payment cancelled';
  if (!tabId || !token) {
    throw new HttpError(400, 'tabId and token are required.');
  }

  const firestore = await getFirestore();
  const tab = await validateTabToken({ firestore, tabId, token });

  await tab.ref.update({
    status: 'active',
    paymentFailedReason: reason,
    paymentFailedAt: FieldValue.serverTimestamp(),
    paymentInitiatedAt: null,
    paymentMethod: null,
    lastModifiedAt: FieldValue.serverTimestamp(),
  });

  return {
    success: true,
    unlocked: true,
  };
}

module.exports = {
  getDineInTableStatus,
  createDineInTab,
  joinDineInTable,
  getDineInTabStatus,
  initiateDineInPayment,
  unlockDineInPayment,
};
