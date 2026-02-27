const { getCache, setCache } = require('../lib/cache');
const { FieldValue } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { resolveOwnerContext, PERMISSIONS } = require('./accessControl.service');

const DINE_IN_CACHE_TTL_SEC = 3;

async function resolveDineInOwner(req, options = {}) {
  const owner = await resolveOwnerContext(req, options);
  if (owner.collectionName !== 'restaurants') {
    throw new HttpError(403, 'Dine-in is available only for restaurant outlets.');
  }
  return owner;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function toIso(value) {
  const d = toDate(value);
  return d ? d.toISOString() : null;
}

function normalizeStatusPriority(status) {
  const priorities = {
    pending: 0,
    confirmed: 1,
    preparing: 2,
    ready_for_pickup: 3,
    delivered: 4,
  };
  return priorities[String(status || '').toLowerCase()] ?? 99;
}

function orderByCreatedAsc(a, b) {
  const at = toDate(a?.orderDate || a?.createdAt)?.getTime() || 0;
  const bt = toDate(b?.orderDate || b?.createdAt)?.getTime() || 0;
  return at - bt;
}

function computeGroupKey(orderData = {}) {
  const tableId = String(orderData.tableId || '').trim();
  const dineInToken = String(orderData.dineInToken || '').trim();
  const tabId = String(orderData.dineInTabId || orderData.tabId || '').trim();
  const tabName = String(orderData.tab_name || orderData.customerName || 'Guest').trim();
  if (dineInToken) return `${tableId}_token_${dineInToken}`;
  if (tabId) return tabId;
  return `${tableId}_${tabName}`;
}

function mapOrderBatch(order) {
  return {
    id: order.id,
    items: Array.isArray(order.items) ? order.items : [],
    status: order.status || 'pending',
    totalAmount: Number(order.totalAmount || order.grandTotal || 0),
    orderDate: order.orderDate || order.createdAt || null,
    paymentStatus: order.paymentStatus || null,
    paymentMethod: order.paymentMethod || null,
    canCancel: ['pending', 'confirmed'].includes(String(order.status || '').toLowerCase()),
  };
}

function mapServiceRequest(doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    ...data,
    createdAt: toIso(data.createdAt) || new Date().toISOString(),
  };
}

function mapClosedTab(doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    ...data,
    closedAt: toIso(data.closedAt) || null,
  };
}

async function queryOrdersForDineIn({ firestore, businessId }) {
  const ordersRef = firestore.collection('orders');
  try {
    const snap = await ordersRef
      .where('restaurantId', '==', businessId)
      .where('deliveryType', '==', 'dine-in')
      .where('status', 'not-in', ['picked_up', 'rejected', 'cancelled'])
      .get();
    return snap.docs;
  } catch {
    const fallback = await ordersRef
      .where('restaurantId', '==', businessId)
      .where('deliveryType', '==', 'dine-in')
      .limit(500)
      .get();
    return fallback.docs.filter((doc) => {
      const status = String(doc.data()?.status || '').toLowerCase();
      return !['picked_up', 'rejected', 'cancelled'].includes(status);
    });
  }
}

async function queryCarOrders({ firestore, businessId }) {
  try {
    const snap = await firestore
      .collection('orders')
      .where('restaurantId', '==', businessId)
      .where('deliveryType', '==', 'car-order')
      .where('status', 'not-in', ['picked_up', 'rejected', 'cancelled'])
      .get();
    return snap.docs;
  } catch {
    const fallback = await firestore
      .collection('orders')
      .where('restaurantId', '==', businessId)
      .where('deliveryType', '==', 'car-order')
      .limit(300)
      .get();
    return fallback.docs.filter((doc) => {
      const status = String(doc.data()?.status || '').toLowerCase();
      return !['picked_up', 'rejected', 'cancelled'].includes(status);
    });
  }
}

function isPaidOrder(order = {}) {
  const details = Array.isArray(order.paymentDetails) ? order.paymentDetails : [order.paymentDetails].filter(Boolean);
  const hasOnlineDetails = details.some((entry) => ['razorpay', 'phonepe', 'online', 'upi_manual'].includes(String(entry?.method || '').toLowerCase()));
  if (hasOnlineDetails) return true;
  return String(order.paymentStatus || '').toLowerCase() === 'paid';
}

function getGroupPaymentStatus(orders = []) {
  if (orders.some((order) => String(order.paymentStatus || '').toLowerCase() === 'paid' || isPaidOrder(order))) {
    return 'paid';
  }
  if (orders.some((order) => ['pay_at_counter', 'counter'].includes(String(order.paymentStatus || order.paymentMethod || '').toLowerCase()))) {
    return 'pay_at_counter';
  }
  return 'pending';
}

async function getOwnerDineInTables(req) {
  const owner = await resolveDineInOwner(req, {
    requiredPermissions: [PERMISSIONS.VIEW_DINE_IN_ORDERS, PERMISSIONS.MANAGE_DINE_IN],
  });

  const firestore = owner.firestore;
  const businessRef = owner.businessSnap.ref;
  const businessId = owner.businessId;
  const cacheKey = `owner_dinein:${businessId}`;
  const cacheHit = await getCache(cacheKey);
  if (cacheHit.hit && cacheHit.value) {
    return {
      payload: cacheHit.value,
      cacheStatus: cacheHit.source === 'memory' ? 'L1-HIT' : 'HIT',
      context: owner,
    };
  }

  const tablesSnap = await businessRef.collection('tables').orderBy('createdAt', 'asc').get();
  const tableMap = new Map();
  tablesSnap.forEach((doc) => {
    const data = doc.data() || {};
    if (data.isDeleted === true) return;
    tableMap.set(doc.id, {
      id: doc.id,
      ...data,
      tabs: {},
      pendingOrders: [],
    });
  });

  const dineInDocs = await queryOrdersForDineIn({ firestore, businessId });
  const orderGroups = new Map();

  dineInDocs.forEach((doc) => {
    const data = doc.data() || {};
    if (data.cleaned === true) return;
    const tableId = String(data.tableId || '').trim();
    if (!tableId || !tableMap.has(tableId)) return;

    const groupKey = computeGroupKey(data);
    if (!orderGroups.has(groupKey)) {
      orderGroups.set(groupKey, {
        id: groupKey,
        tableId,
        tab_name: String(data.tab_name || data.customerName || 'Guest'),
        pax_count: Number(data.pax_count || 1),
        orders: {},
        dineInToken: data.dineInToken || null,
        dineInTabId: data.dineInTabId || data.tabId || null,
        ordered_by: data.ordered_by || null,
        ordered_by_name: data.ordered_by_name || null,
      });
    }

    const group = orderGroups.get(groupKey);
    group.orders[doc.id] = { id: doc.id, ...data };
    if (data.tab_name) group.tab_name = data.tab_name;
    if (data.pax_count) group.pax_count = Number(data.pax_count || 1);
    if (data.dineInToken && !group.dineInToken) group.dineInToken = data.dineInToken;
  });

  orderGroups.forEach((group) => {
    const table = tableMap.get(group.tableId);
    if (!table) return;

    const sortedOrders = Object.values(group.orders || {}).sort(orderByCreatedAsc);
    const hasPending = sortedOrders.some((order) => String(order.status || '').toLowerCase() === 'pending');
    const totalAmount = sortedOrders.reduce(
      (sum, order) => sum + Number(order.totalAmount || order.grandTotal || 0),
      0
    );
    const mainStatus = sortedOrders
      .map((order) => String(order.status || '').toLowerCase())
      .sort((a, b) => normalizeStatusPriority(a) - normalizeStatusPriority(b))[0] || 'delivered';

    const groupPayload = {
      ...group,
      totalAmount,
      hasPending,
      hasConfirmed: sortedOrders.some((order) => String(order.status || '').toLowerCase() !== 'pending'),
      status: hasPending ? 'pending' : 'active',
      mainStatus,
      items: sortedOrders.flatMap((order) => (Array.isArray(order.items) ? order.items : [])),
      orderBatches: sortedOrders.map(mapOrderBatch),
      paymentStatus: getGroupPaymentStatus(sortedOrders),
      isPaid: getGroupPaymentStatus(sortedOrders) === 'paid',
    };

    if (hasPending) {
      table.pendingOrders.push(groupPayload);
    } else {
      table.tabs[group.id] = groupPayload;
    }
  });

  tableMap.forEach((table) => {
    const paxFromTabs = Object.values(table.tabs).reduce((sum, tab) => sum + Number(tab.pax_count || 0), 0);
    const pendingPartyMap = new Map();
    table.pendingOrders.forEach((order) => {
      const key = String(order.tab_name || order.customerName || order.id);
      if (!pendingPartyMap.has(key)) {
        pendingPartyMap.set(key, Number(order.pax_count || 1));
      }
    });
    const paxFromPending = Array.from(pendingPartyMap.values()).reduce((sum, value) => sum + value, 0);
    const currentPax = paxFromTabs + paxFromPending;
    table.current_pax = Math.min(currentPax, Number(table.max_capacity || 99));
    if (table.state === 'needs_cleaning') return;
    table.state = currentPax > 0 ? 'occupied' : 'available';
  });

  const serviceRequestsSnap = await businessRef
    .collection('serviceRequests')
    .where('status', '==', 'pending')
    .orderBy('createdAt', 'desc')
    .get()
    .catch(async () => businessRef.collection('serviceRequests').where('status', '==', 'pending').get());
  const serviceRequests = serviceRequestsSnap.docs.map(mapServiceRequest);

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const closedTabsSnap = await businessRef
    .collection('dineInTabs')
    .where('status', '==', 'closed')
    .where('closedAt', '>=', thirtyDaysAgo)
    .orderBy('closedAt', 'desc')
    .get()
    .catch(async () => businessRef.collection('dineInTabs').where('status', '==', 'closed').limit(100).get());
  const closedTabs = closedTabsSnap.docs.map(mapClosedTab);

  const carOrdersDocs = await queryCarOrders({ firestore, businessId });
  const carOrders = carOrdersDocs
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
    .filter((order) => order.cleaned !== true);

  const payload = {
    tables: Array.from(tableMap.values()),
    serviceRequests,
    closedTabs,
    carOrders,
  };

  await setCache(cacheKey, payload, DINE_IN_CACHE_TTL_SEC);
  return {
    payload,
    cacheStatus: 'MISS',
    context: owner,
  };
}

function toPositiveInt(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : fallback;
}

async function queryTabOrdersForClear({ firestore, businessId, tabId }) {
  const safeTabId = String(tabId || '').trim();
  if (!safeTabId) return [];

  try {
    const snap = await firestore
      .collection('orders')
      .where('restaurantId', '==', businessId)
      .where('deliveryType', '==', 'dine-in')
      .where('dineInTabId', '==', safeTabId)
      .where('status', 'not-in', ['picked_up', 'rejected'])
      .get();
    return snap.docs;
  } catch {
    const fallback = await firestore
      .collection('orders')
      .where('restaurantId', '==', businessId)
      .where('deliveryType', '==', 'dine-in')
      .where('dineInTabId', '==', safeTabId)
      .get();
    return fallback.docs.filter((doc) => {
      const status = String(doc.data()?.status || '').toLowerCase();
      return !['picked_up', 'rejected'].includes(status);
    });
  }
}

async function postOwnerDineInTables(req) {
  const owner = await resolveDineInOwner(req, {
    checkRevoked: true,
    requiredPermissions: [PERMISSIONS.MANAGE_DINE_IN],
  });

  const firestore = owner.firestore;
  const businessRef = owner.businessSnap.ref;
  const businessId = owner.businessId;
  const body = req.body || {};
  const action = String(body.action || '').trim().toLowerCase();

  if (action === 'create_tab') {
    const tableId = String(body.tableId || '').trim();
    const tabName = String(body.tab_name || '').trim();
    const paxCount = toPositiveInt(body.pax_count, 0);

    if (!tableId || !tabName || paxCount <= 0) {
      throw new HttpError(400, 'Table ID, pax count, and tab name are required.');
    }

    const tableRef = businessRef.collection('tables').doc(tableId);
    const tabId = `tab_${Date.now()}`;

    await firestore.runTransaction(async (tx) => {
      const tableSnap = await tx.get(tableRef);
      if (!tableSnap.exists) {
        throw new HttpError(404, 'Table not found.');
      }

      const tableData = tableSnap.data() || {};
      const maxCapacity = Number(tableData.max_capacity || 0);
      const currentPax = Number(tableData.current_pax || 0);
      const availableSeats = Math.max(0, maxCapacity - currentPax);
      if (paxCount > availableSeats) {
        throw new HttpError(400, `Capacity exceeded. Only ${availableSeats} seats available.`);
      }

      const tabRef = businessRef.collection('dineInTabs').doc(tabId);
      tx.set(tabRef, {
        id: tabId,
        tableId,
        restaurantId: businessId,
        status: 'inactive',
        tab_name: tabName,
        pax_count: paxCount,
        createdAt: FieldValue.serverTimestamp(),
        totalBill: 0,
        orders: {},
      });

      tx.update(tableRef, {
        current_pax: FieldValue.increment(paxCount),
        state: 'occupied',
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return {
      payload: { message: 'Tab created successfully!', tabId },
      statusCode: 201,
      context: owner,
    };
  }

  const tableId = String(body.tableId || '').trim();
  const maxCapacity = toPositiveInt(body.max_capacity, 0);
  if (!tableId || maxCapacity <= 0) {
    throw new HttpError(400, 'Table ID and valid capacity are required.');
  }

  await businessRef.collection('tables').doc(tableId).set(
    {
      id: tableId,
      max_capacity: maxCapacity,
      createdAt: FieldValue.serverTimestamp(),
      state: 'available',
      current_pax: 0,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return {
    payload: { message: 'Table saved successfully.' },
    statusCode: 201,
    context: owner,
  };
}

async function patchOwnerDineInTables(req) {
  const owner = await resolveDineInOwner(req, {
    checkRevoked: true,
    requiredPermissions: [PERMISSIONS.MANAGE_DINE_IN],
  });

  const firestore = owner.firestore;
  const businessRef = owner.businessSnap.ref;
  const businessId = owner.businessId;
  const body = req.body || {};
  const tableId = String(body.tableId || '').trim();
  const action = String(body.action || '').trim().toLowerCase();
  const tabId = String(body.tabId || '').trim();
  const paymentMethod = String(body.paymentMethod || '').trim() || 'cod';
  const newTableIdRaw = body.newTableId;
  const newCapacityRaw = body.newCapacity;
  const tableRef = tableId ? businessRef.collection('tables').doc(tableId) : null;

  if (newTableIdRaw !== undefined || newCapacityRaw !== undefined) {
    if (!tableId) throw new HttpError(400, 'Table ID is required.');
    const tableSnap = await tableRef.get();
    if (!tableSnap.exists) throw new HttpError(404, 'Table not found.');

    const currentData = tableSnap.data() || {};
    const newTableId = String(newTableIdRaw || '').trim();
    const newCapacity = toPositiveInt(newCapacityRaw, Number(currentData.max_capacity || 0));

    if (newTableId && newTableId !== tableId) {
      const newTableRef = businessRef.collection('tables').doc(newTableId);
      const newTableSnap = await newTableRef.get();
      if (newTableSnap.exists) {
        throw new HttpError(400, 'A table with this ID already exists.');
      }

      await newTableRef.set({
        ...currentData,
        id: newTableId,
        max_capacity: newCapacity,
        updatedAt: FieldValue.serverTimestamp(),
      });
      await tableRef.delete();
    } else {
      await tableRef.update({
        max_capacity: newCapacity,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return {
      payload: { message: 'Table updated successfully.' },
      context: owner,
    };
  }

  if (action === 'clear_tab') {
    if (!tabId) throw new HttpError(400, 'Tab ID is required for clear_tab action.');

    const tabOrders = await queryTabOrdersForClear({ firestore, businessId, tabId });
    if (!tabOrders.length) {
      throw new HttpError(404, 'No active orders found for this tab.');
    }

    const batch = firestore.batch();
    const tableIds = new Set();
    tabOrders.forEach((orderDoc) => {
      const orderData = orderDoc.data() || {};
      if (orderData.tableId) tableIds.add(String(orderData.tableId).trim());
      batch.update(orderDoc.ref, {
        status: 'picked_up',
        statusHistory: FieldValue.arrayUnion({
          status: 'picked_up',
          timestamp: new Date(),
          updatedBy: owner.actorUid,
          updatedByRole: owner.callerRole,
        }),
        tabClosedAt: FieldValue.serverTimestamp(),
        updatedAt: new Date(),
      });
    });
    await batch.commit();

    for (const tableIdForTab of tableIds) {
      if (!tableIdForTab) continue;
      const activeTabs = await businessRef
        .collection('dineInTabs')
        .where('tableId', '==', tableIdForTab)
        .where('status', '==', 'active')
        .get()
        .catch(async () => businessRef.collection('dineInTabs').where('tableId', '==', tableIdForTab).get());

      if (activeTabs.empty) continue;
      const closeBatch = firestore.batch();
      let closeOps = 0;
      activeTabs.docs.forEach((doc) => {
        const status = String(doc.data()?.status || '').toLowerCase();
        if (status !== 'active') return;
        closeBatch.update(doc.ref, {
          status: 'closed',
          closedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        closeOps += 1;
      });
      if (closeOps > 0) {
        await closeBatch.commit();
      }
    }

    return {
      payload: { message: 'Tab cleared successfully.' },
      context: owner,
    };
  }

  if (action === 'mark_paid') {
    if (!tableId || !tabId) throw new HttpError(400, 'Table ID and tab ID are required.');

    await firestore.runTransaction(async (tx) => {
      const tabRef = businessRef.collection('dineInTabs').doc(tabId);
      const tabSnap = await tx.get(tabRef);
      const tableSnap = await tx.get(tableRef);
      if (!tabSnap.exists) throw new HttpError(404, 'Tab not found.');

      const tabData = tabSnap.data() || {};
      const tabOrders = tabData.orders && typeof tabData.orders === 'object' ? tabData.orders : {};

      Object.keys(tabOrders).forEach((orderId) => {
        const orderRef = firestore.collection('orders').doc(orderId);
        tx.update(orderRef, {
          status: 'delivered',
          paymentStatus: 'paid',
          paymentMethod,
          paymentDetails: {
            ...(tabOrders[orderId]?.paymentDetails || {}),
            method: paymentMethod,
          },
          updatedAt: new Date(),
        });
      });

      tx.update(tabRef, {
        status: 'closed',
        closedAt: FieldValue.serverTimestamp(),
        paymentMethod,
        updatedAt: FieldValue.serverTimestamp(),
      });

      if (tableSnap.exists) {
        const tabPax = Number(tabData.pax_count || 0);
        tx.update(tableRef, {
          state: 'needs_cleaning',
          lastClosedAt: FieldValue.serverTimestamp(),
          current_pax: FieldValue.increment(-tabPax),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    });

    return {
      payload: { message: `Table ${tableId} marked as needing cleaning.` },
      context: owner,
    };
  }

  if (action === 'mark_cleaned') {
    if (!tableId) throw new HttpError(400, 'Table ID is required.');
    const tableSnap = await tableRef.get();
    if (!tableSnap.exists) throw new HttpError(404, 'Table not found.');

    const tabsSnap = await businessRef.collection('dineInTabs').where('tableId', '==', tableId).get();
    const deliveredOrders = await firestore
      .collection('orders')
      .where('restaurantId', '==', businessId)
      .where('deliveryType', '==', 'dine-in')
      .where('tableId', '==', tableId)
      .where('status', '==', 'delivered')
      .get()
      .catch(async () => {
        const fallback = await firestore
          .collection('orders')
          .where('restaurantId', '==', businessId)
          .where('deliveryType', '==', 'dine-in')
          .where('tableId', '==', tableId)
          .get();
        return {
          docs: fallback.docs.filter((doc) => String(doc.data()?.status || '').toLowerCase() === 'delivered'),
        };
      });

    let tabsClosed = 0;
    let ordersMarkedClean = 0;
    let opCount = 0;
    let batch = firestore.batch();

    const commitIfNeeded = async (force = false) => {
      if (opCount === 0) return;
      if (!force && opCount < 450) return;
      await batch.commit();
      batch = firestore.batch();
      opCount = 0;
    };

    tabsSnap.docs.forEach((tabDoc) => {
      const status = String(tabDoc.data()?.status || '').toLowerCase();
      if (status === 'closed' || status === 'completed') return;
      batch.update(tabDoc.ref, {
        status: 'closed',
        closedAt: FieldValue.serverTimestamp(),
        cleanedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tabsClosed += 1;
      opCount += 1;
    });

    for (const orderDoc of deliveredOrders.docs || []) {
      const orderData = orderDoc.data() || {};
      if (orderData.cleaned === true) continue;
      batch.update(orderDoc.ref, {
        cleaned: true,
        cleanedAt: FieldValue.serverTimestamp(),
        updatedAt: new Date(),
      });
      ordersMarkedClean += 1;
      opCount += 1;
      await commitIfNeeded(false);
    }

    batch.update(tableRef, {
      state: 'available',
      current_pax: 0,
      cleanedAt: FieldValue.serverTimestamp(),
      lastClosedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    opCount += 1;
    await commitIfNeeded(true);

    return {
      payload: {
        message: `Table ${tableId} cleaned successfully.`,
        tabsClosed,
        ordersMarkedClean,
      },
      context: owner,
    };
  }

  throw new HttpError(400, 'No valid action or edit data provided.');
}

async function deleteOwnerDineInTable(req) {
  const owner = await resolveDineInOwner(req, {
    checkRevoked: true,
    requiredPermissions: [PERMISSIONS.MANAGE_DINE_IN],
  });

  const firestore = owner.firestore;
  const businessRef = owner.businessSnap.ref;
  const tableId = String(req.body?.tableId || '').trim();
  if (!tableId) throw new HttpError(400, 'Table ID is required.');

  const activeTabsSnap = await businessRef
    .collection('dineInTabs')
    .where('tableId', '==', tableId)
    .where('status', '==', 'active')
    .get()
    .catch(async () => businessRef.collection('dineInTabs').where('tableId', '==', tableId).get());

  const activeTabs = (activeTabsSnap.docs || []).filter(
    (doc) => String(doc.data()?.status || '').toLowerCase() === 'active'
  );
  if (activeTabs.length > 0) {
    const occupiedSeats = activeTabs.reduce((sum, doc) => sum + Number(doc.data()?.pax_count || 0), 0);
    throw new HttpError(
      400,
      `Cannot delete table ${tableId}. There are ${occupiedSeats} customers currently seated (${activeTabs.length} active session). Please clear all sessions first.`
    );
  }

  const allTabsSnap = await businessRef.collection('dineInTabs').where('tableId', '==', tableId).get();
  const tableRef = businessRef.collection('tables').doc(tableId);
  const tableSnap = await tableRef.get();
  if (!tableSnap.exists) {
    throw new HttpError(404, 'Table not found.');
  }

  const batch = firestore.batch();
  allTabsSnap.docs.forEach((doc) => {
    if (String(doc.data()?.status || '').toLowerCase() === 'closed') return;
    batch.update(doc.ref, {
      status: 'closed',
      closedAt: FieldValue.serverTimestamp(),
      note: 'Table deleted',
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  batch.update(tableRef, {
    isDeleted: true,
    deletedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  return {
    payload: {
      message: 'Table deleted successfully.',
      deletedTabs: 0,
      deletedOrders: 0,
    },
    context: owner,
  };
}

module.exports = {
  getOwnerDineInTables,
  postOwnerDineInTables,
  patchOwnerDineInTables,
  deleteOwnerDineInTable,
};
