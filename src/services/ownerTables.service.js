const { FieldValue } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { resolveOwnerContext, PERMISSIONS } = require('./accessControl.service');

const ACTIVE_DINE_IN_ORDER_STATUSES = [
  'pending',
  'accepted',
  'confirmed',
  'preparing',
  'ready',
  'ready_for_pickup',
  'pay_at_counter',
];

function normalizeText(value) {
  return String(value || '').trim();
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function resolveOwnerRestaurant(req, options = {}) {
  const owner = await resolveOwnerContext(req, options);
  if (owner.collectionName !== 'restaurants') {
    throw new HttpError(403, 'Dine-in tables are available only for restaurant outlets.');
  }
  return owner;
}

function enforceRestaurantScope(owner, providedRestaurantId) {
  const safeProvidedId = normalizeText(providedRestaurantId);
  if (safeProvidedId && safeProvidedId !== String(owner.businessId || '')) {
    throw new HttpError(403, 'Access denied for requested restaurant.');
  }
}

async function resolveTableDocCaseInsensitive(businessRef, tableId) {
  const safeTableId = normalizeText(tableId).toLowerCase();
  if (!safeTableId) return null;

  const tablesSnap = await businessRef.collection('tables').get();
  let matchedDoc = null;
  (tablesSnap.docs || []).forEach((doc) => {
    if (matchedDoc) return;
    const data = doc.data() || {};
    if (data.isDeleted === true) return;
    if (String(doc.id || '').toLowerCase() === safeTableId) {
      matchedDoc = doc;
    }
  });
  return matchedDoc;
}

function buildPartyKey(orderData = {}, actualTableId, fallbackId) {
  return orderData.dineInTabId
    || orderData.tabId
    || orderData.dineInToken
    || `${actualTableId}:${String(orderData.tab_name || orderData.customerName || fallbackId).toLowerCase()}`;
}

async function getOwnerTables(req) {
  const owner = await resolveOwnerRestaurant(req, {
    requiredPermissions: [PERMISSIONS.VIEW_DINE_IN_ORDERS, PERMISSIONS.MANAGE_DINE_IN],
  });
  const firestore = owner.firestore;
  enforceRestaurantScope(owner, req.query.restaurantId);
  const tableId = normalizeText(req.query.tableId);

  if (!tableId) {
    throw new HttpError(400, 'Table ID is required.');
  }
  const businessRef = owner.businessSnap.ref;

  const matchedTableDoc = await resolveTableDocCaseInsensitive(businessRef, tableId);
  if (!matchedTableDoc) {
    throw new HttpError(404, 'Table configuration not found.');
  }

  const actualTableId = matchedTableDoc.id;
  const tableData = matchedTableDoc.data() || {};
  const maxCapacity = toNumber(tableData.max_capacity, 0);
  const dbCurrentPax = Math.max(0, toNumber(tableData.current_pax, 0));

  const tabsSnap = await businessRef.collection('dineInTabs')
    .where('tableId', '==', actualTableId)
    .get();
  const joinableTabsRaw = (tabsSnap.docs || [])
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
    .filter((tab) => {
      const status = String(tab?.status || 'inactive').toLowerCase();
      return status !== 'closed' && status !== 'completed';
    });

  const activeOrdersQuery = await firestore.collection('orders')
    .where('restaurantId', '==', businessRef.id)
    .where('deliveryType', '==', 'dine-in')
    .where('tableId', '==', actualTableId)
    .where('status', 'in', ACTIVE_DINE_IN_ORDER_STATUSES)
    .get();

  const activePartyPaxMap = new Map();
  const activeTabIdsFromOrders = new Set();
  (activeOrdersQuery.docs || []).forEach((doc) => {
    const orderData = doc.data() || {};
    if (orderData.cleaned === true) return;

    const partyKey = buildPartyKey(orderData, actualTableId, doc.id);
    if (!activePartyPaxMap.has(partyKey)) {
      activePartyPaxMap.set(partyKey, toNumber(orderData.pax_count, 1) || 1);
    }
    if (orderData.dineInTabId) activeTabIdsFromOrders.add(String(orderData.dineInTabId));
    if (orderData.tabId) activeTabIdsFromOrders.add(String(orderData.tabId));
  });

  const liveCurrentPax = Array.from(activePartyPaxMap.values())
    .reduce((sum, pax) => sum + toNumber(pax, 0), 0);
  const tableState = String(tableData.state || '').toLowerCase();
  const shouldTrustDbOnly = tableState === 'needs_cleaning';
  const currentPax = shouldTrustDbOnly
    ? Math.min(maxCapacity || dbCurrentPax, dbCurrentPax)
    : Math.min(maxCapacity || liveCurrentPax, dbCurrentPax > 0 ? dbCurrentPax : liveCurrentPax);

  let validActiveTabs = [];
  if (activeTabIdsFromOrders.size > 0) {
    validActiveTabs = joinableTabsRaw.filter((tab) => activeTabIdsFromOrders.has(String(tab.id)));
    if (validActiveTabs.length === 0 && currentPax > 0) {
      validActiveTabs = joinableTabsRaw;
    }
  } else if (currentPax > 0) {
    validActiveTabs = joinableTabsRaw;
  }

  const uncleanedOrdersQuery = await firestore.collection('orders')
    .where('restaurantId', '==', businessRef.id)
    .where('deliveryType', '==', 'dine-in')
    .where('tableId', '==', actualTableId)
    .where('status', '==', 'delivered')
    .get();

  const uncleanedOrders = (uncleanedOrdersQuery.docs || []).filter((doc) => {
    const orderData = doc.data() || {};
    return orderData.cleaned !== true;
  });
  const uncleanedOrdersCount = uncleanedOrders.length;
  const hasUncleanedOrders = uncleanedOrdersCount > 0 || tableState === 'needs_cleaning';
  const availableSeats = Math.max(0, maxCapacity - currentPax);

  return {
    tableId: actualTableId,
    max_capacity: maxCapacity,
    current_pax: currentPax,
    activeTabs: validActiveTabs,
    state: tableState === 'needs_cleaning'
      ? 'needs_cleaning'
      : (currentPax >= maxCapacity ? 'full' : (currentPax > 0 ? 'occupied' : 'available')),
    hasUncleanedOrders,
    uncleanedOrdersCount,
    availableSeats,
  };
}

async function postOwnerTables(req, body = {}) {
  const owner = await resolveOwnerRestaurant(req, {
    checkRevoked: true,
    requiredPermissions: [PERMISSIONS.MANAGE_DINE_IN],
  });
  const firestore = owner.firestore;
  const action = normalizeText(body.action);
  const tableId = normalizeText(body.tableId);
  enforceRestaurantScope(owner, body.restaurantId);
  const paxCount = toNumber(body.pax_count, 0);
  const tabName = normalizeText(body.tab_name);

  if (action !== 'create_tab') {
    throw new HttpError(400, 'Invalid action.');
  }
  if (!tableId || !paxCount || !tabName) {
    throw new HttpError(400, 'Table ID, pax count, and tab name are required.');
  }
  const businessRef = owner.businessSnap.ref;

  const matchedTableDoc = await resolveTableDocCaseInsensitive(businessRef, tableId);
  if (!matchedTableDoc) {
    throw new HttpError(404, 'Table not found.');
  }

  const actualTableId = matchedTableDoc.id;
  const tableRef = businessRef.collection('tables').doc(actualTableId);
  const newTabId = `tab_${Date.now()}`;

  try {
    await firestore.runTransaction(async (transaction) => {
      const tableDoc = await transaction.get(tableRef);
      if (!tableDoc.exists) throw new HttpError(404, 'Table not found.');

      const tableData = tableDoc.data() || {};
      const maxCapacity = Math.max(0, toNumber(tableData.max_capacity, 0));
      const dbCurrentPax = Math.max(0, toNumber(tableData.current_pax, 0));
      const requestedPax = toNumber(paxCount, 0);

      if (!Number.isFinite(requestedPax) || requestedPax < 1) {
        throw new HttpError(400, 'Invalid party size.');
      }

      const activeOrdersQuery = firestore.collection('orders')
        .where('restaurantId', '==', businessRef.id)
        .where('deliveryType', '==', 'dine-in')
        .where('tableId', '==', actualTableId)
        .where('status', 'in', ACTIVE_DINE_IN_ORDER_STATUSES);
      const activeOrdersSnap = await transaction.get(activeOrdersQuery);

      const activePartyPaxMap = new Map();
      (activeOrdersSnap.docs || []).forEach((doc) => {
        const orderData = doc.data() || {};
        const partyKey = buildPartyKey(orderData, actualTableId, doc.id);
        if (!activePartyPaxMap.has(partyKey)) {
          activePartyPaxMap.set(partyKey, toNumber(orderData.pax_count, 1) || 1);
        }
      });
      const currentActivePax = Array.from(activePartyPaxMap.values())
        .reduce((sum, pax) => sum + toNumber(pax, 0), 0);

      const effectiveOccupiedPax = Math.min(
        maxCapacity || (dbCurrentPax > 0 ? dbCurrentPax : currentActivePax),
        (dbCurrentPax > 0 ? dbCurrentPax : currentActivePax)
      );
      const availableCapacity = Math.max(0, maxCapacity - effectiveOccupiedPax);

      if (requestedPax > availableCapacity) {
        throw new HttpError(400, `Capacity exceeded. Only ${availableCapacity} seats available.`);
      }

      const newTabRef = businessRef.collection('dineInTabs').doc(newTabId);
      transaction.set(newTabRef, {
        id: newTabId,
        tableId: actualTableId,
        restaurantId: businessRef.id,
        status: 'inactive',
        tab_name: tabName,
        pax_count: requestedPax,
        createdAt: FieldValue.serverTimestamp(),
        totalBill: 0,
        orders: {},
      });

      const nextPax = Math.min(
        maxCapacity || (effectiveOccupiedPax + requestedPax),
        effectiveOccupiedPax + requestedPax
      );
      transaction.update(tableRef, {
        current_pax: nextPax,
        state: nextPax >= maxCapacity ? 'full' : 'occupied',
      });
    });
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(400, error?.message || 'Failed to create tab.');
  }

  return {
    message: 'Tab created successfully!',
    tabId: newTabId,
  };
}

async function patchOwnerTables(req, body = {}) {
  const owner = await resolveOwnerRestaurant(req, {
    checkRevoked: true,
    requiredPermissions: [PERMISSIONS.MANAGE_DINE_IN],
  });
  const firestore = owner.firestore;
  enforceRestaurantScope(owner, body.restaurantId);
  const tableId = normalizeText(body.tableId);
  const tabId = normalizeText(body.tabId);
  const action = normalizeText(body.action);
  const trackingToken = normalizeText(body.trackingToken);

  if (!['customer_done', 'customer_exit'].includes(action)) {
    throw new HttpError(400, 'Invalid action.');
  }
  if (!tableId) {
    throw new HttpError(400, 'Table ID is required.');
  }
  const businessRef = owner.businessSnap.ref;

  const matchedTableDoc = await resolveTableDocCaseInsensitive(businessRef, tableId);
  if (!matchedTableDoc) {
    throw new HttpError(404, 'Table not found.');
  }
  const actualTableId = matchedTableDoc.id;
  const tableRef = businessRef.collection('tables').doc(actualTableId);

  if (action === 'customer_done' && !tabId) {
    await tableRef.update({
      state: 'needs_cleaning',
      customerMarkedDoneAt: FieldValue.serverTimestamp(),
    });
    return { message: 'Table marked for cleaning. Thank you!' };
  }

  if (!tabId) {
    throw new HttpError(400, 'Tab ID is required to exit table.');
  }

  if (trackingToken) {
    const tokenOrdersSnap = await firestore.collection('orders')
      .where('trackingToken', '==', trackingToken)
      .limit(20)
      .get();

    const hasMatchingTokenOrder = (tokenOrdersSnap.docs || []).some((doc) => {
      const data = doc.data() || {};
      const orderTabId = String(data.dineInTabId || data.tabId || '');
      const orderTableId = String(data.tableId || data.table || '').toLowerCase();
      return data.restaurantId === businessRef.id
        && String(data.deliveryType || '').toLowerCase() === 'dine-in'
        && orderTabId === String(tabId)
        && orderTableId === String(actualTableId).toLowerCase();
    });

    if (!hasMatchingTokenOrder) {
      throw new HttpError(403, 'Invalid session token for this table tab.');
    }
  }

  const result = await firestore.runTransaction(async (transaction) => {
    const tableDoc = await transaction.get(tableRef);
    if (!tableDoc.exists) {
      throw new HttpError(404, 'Table not found.');
    }

    const tabRef = businessRef.collection('dineInTabs').doc(String(tabId));
    const tabSnap = await transaction.get(tabRef);

    const tabOrdersByPrimaryIdSnap = await transaction.get(
      firestore.collection('orders')
        .where('restaurantId', '==', businessRef.id)
        .where('deliveryType', '==', 'dine-in')
        .where('tableId', '==', actualTableId)
        .where('dineInTabId', '==', String(tabId))
    );

    let tabOrderDocs = tabOrdersByPrimaryIdSnap.docs || [];
    if (tabOrderDocs.length === 0) {
      const tabOrdersByLegacyIdSnap = await transaction.get(
        firestore.collection('orders')
          .where('restaurantId', '==', businessRef.id)
          .where('deliveryType', '==', 'dine-in')
          .where('tableId', '==', actualTableId)
          .where('tabId', '==', String(tabId))
      );
      tabOrderDocs = tabOrdersByLegacyIdSnap.docs || [];
    }

    if (!tabSnap.exists && tabOrderDocs.length === 0) {
      throw new HttpError(404, 'Tab session not found.');
    }

    const finalStatuses = new Set(['delivered', 'cancelled', 'rejected', 'picked_up', 'paid']);
    const activeOrders = tabOrderDocs.filter((doc) => {
      const status = String(doc.data()?.status || '').toLowerCase();
      return status && !finalStatuses.has(status);
    });
    const hasRunningOrders = activeOrders.length > 0;

    let paxToRelease = 0;
    if (tabSnap.exists) {
      const tabData = tabSnap.data() || {};
      paxToRelease = Math.max(0, toNumber(tabData.pax_count, 0));
      transaction.set(tabRef, {
        status: 'closed',
        closedAt: FieldValue.serverTimestamp(),
        closedBy: 'customer',
        exitReason: action,
      }, { merge: true });
    }

    if (paxToRelease <= 0) {
      paxToRelease = Math.max(0, toNumber(tabOrderDocs[0]?.data()?.pax_count, 0));
    }

    tabOrderDocs.forEach((doc) => {
      const orderUpdate = {
        tableExitRequestedAt: FieldValue.serverTimestamp(),
        tableExitRequestedBy: 'customer',
      };
      if (!hasRunningOrders) {
        orderUpdate.cleaned = true;
        orderUpdate.cleanedAt = FieldValue.serverTimestamp();
      }
      transaction.set(doc.ref, orderUpdate, { merge: true });
    });

    const openTabsSnap = await transaction.get(
      businessRef.collection('dineInTabs')
        .where('tableId', '==', actualTableId)
        .where('status', 'in', ['active', 'inactive'])
    );

    let recalculatedPax = (openTabsSnap.docs || []).reduce((sum, doc) => (
      sum + Math.max(0, toNumber(doc.data()?.pax_count, 0))
    ), 0);
    if ((openTabsSnap.docs || []).some((doc) => doc.id === String(tabId))) {
      recalculatedPax = Math.max(0, recalculatedPax - paxToRelease);
    }

    const dbCurrentPax = Math.max(0, toNumber(tableDoc.data()?.current_pax, 0));
    const nextPax = openTabsSnap.empty
      ? Math.max(0, dbCurrentPax - paxToRelease)
      : Math.max(0, recalculatedPax);

    transaction.set(tableRef, {
      current_pax: nextPax,
      state: nextPax > 0 ? 'occupied' : 'needs_cleaning',
      customerMarkedDoneAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { nextPax, paxToRelease, hasRunningOrders };
  });

  return {
    message: result.hasRunningOrders
      ? 'Table session released. Active orders remain visible for staff.'
      : 'Table session closed successfully.',
    releasedSeats: result.paxToRelease,
    currentPax: result.nextPax,
    activeOrdersPreserved: result.hasRunningOrders,
  };
}

module.exports = {
  getOwnerTables,
  postOwnerTables,
  patchOwnerTables,
};
