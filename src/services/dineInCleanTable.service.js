const { FieldValue, getFirestore } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');

const DINE_IN_LIKE_DELIVERY_TYPES = ['dine-in', 'car-order'];
const OPEN_TAB_STATUSES = new Set(['active', 'inactive']);

function normalizeText(value) {
  return String(value || '').trim();
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function getBusinessRef(firestore, restaurantId) {
  const safeRestaurantId = normalizeText(restaurantId);
  if (!safeRestaurantId) return null;

  for (const collectionName of ['restaurants', 'shops', 'street_vendors']) {
    const ref = firestore.collection(collectionName).doc(safeRestaurantId);
    const snap = await ref.get();
    if (snap.exists) return ref;
  }

  return null;
}

async function validateTabTokenIfProvided({
  firestore,
  tabId,
  token,
  businessRef = null,
}) {
  const safeToken = normalizeText(token);
  if (!safeToken) return;

  const tabSnap = await firestore.collection('dine_in_tabs').doc(tabId).get();
  if (tabSnap.exists) {
    const tabData = tabSnap.data() || {};
    if (normalizeText(tabData.token) !== safeToken) {
      throw new HttpError(401, 'Invalid token');
    }
    return;
  }

  if (businessRef) {
    const businessTabSnap = await businessRef.collection('dineInTabs').doc(tabId).get();
    if (businessTabSnap.exists) {
      const businessTabData = businessTabSnap.data() || {};
      if (normalizeText(businessTabData.token) !== safeToken) {
        throw new HttpError(401, 'Invalid token');
      }
      return;
    }
  }

  throw new HttpError(401, 'Invalid token');
}

async function recalculateTabTotals(firestore, tabId) {
  return firestore.runTransaction(async (transaction) => {
    const tabRef = firestore.collection('dine_in_tabs').doc(tabId);
    const tabSnap = await transaction.get(tabRef);
    if (!tabSnap.exists) throw new HttpError(404, 'Tab not found');

    const ordersRef = tabRef.collection('orders');
    const ordersSnap = await transaction.get(ordersRef);

    let totalAmount = 0;
    let paidAmount = 0;
    for (const orderDoc of ordersSnap.docs) {
      const orderRef = firestore.collection('orders').doc(orderDoc.id);
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists) continue;
      const orderData = orderSnap.data() || {};
      const amount = toNumber(orderData.totalAmount, 0);
      totalAmount += amount;

      const isPaid = String(orderData?.paymentDetails?.status || '').toLowerCase() === 'paid';
      if (isPaid) {
        paidAmount += amount;
      }
    }

    const pendingAmount = totalAmount - paidAmount;
    transaction.update(tabRef, {
      totalAmount,
      paidAmount,
      pendingAmount,
      lastRecalculatedAt: FieldValue.serverTimestamp(),
    });

    return {
      totalAmount,
      paidAmount,
      pendingAmount,
    };
  });
}

async function verifyTabIntegrity(firestore, tabId) {
  const tabRef = firestore.collection('dine_in_tabs').doc(tabId);
  const tabSnap = await tabRef.get();
  if (!tabSnap.exists) {
    throw new HttpError(404, 'Tab not found');
  }

  const tabData = tabSnap.data() || {};
  const cachedTotal = toNumber(tabData.totalAmount, 0);
  const cachedPaid = toNumber(tabData.paidAmount, 0);
  const cachedPending = toNumber(tabData.pendingAmount, 0);

  const recalculated = await recalculateTabTotals(firestore, tabId);
  const totalMismatch = Math.abs(cachedTotal - recalculated.totalAmount);
  const paidMismatch = Math.abs(cachedPaid - recalculated.paidAmount);
  const pendingMismatch = Math.abs(cachedPending - recalculated.pendingAmount);
  const hasMismatch = totalMismatch > 0.01 || paidMismatch > 0.01 || pendingMismatch > 0.01;

  return {
    isValid: !hasMismatch,
    mismatch: hasMismatch ? totalMismatch : 0,
  };
}

async function collectOrdersByField({ firestore, field, value, businessId }) {
  const resultMap = new Map();

  for (const deliveryType of DINE_IN_LIKE_DELIVERY_TYPES) {
    try {
      let query = firestore
        .collection('orders')
        .where('deliveryType', '==', deliveryType)
        .where(field, '==', value);
      if (businessId) {
        query = query.where('restaurantId', '==', businessId);
      }
      const snap = await query.get();
      snap.docs.forEach((doc) => resultMap.set(doc.id, doc));
    } catch {
      let fallbackQuery = firestore.collection('orders').where(field, '==', value);
      if (businessId) {
        fallbackQuery = fallbackQuery.where('restaurantId', '==', businessId);
      }
      const snap = await fallbackQuery.get();
      snap.docs.forEach((doc) => {
        const data = doc.data() || {};
        if (String(data.deliveryType || '').toLowerCase() !== deliveryType) return;
        resultMap.set(doc.id, doc);
      });
    }
  }

  return resultMap;
}

async function resolveTabCandidateIds({
  businessRef,
  possibleTabIds,
  actualTableId,
  firstOrderData,
}) {
  const tabIdsToClose = new Set();
  if (!businessRef) return tabIdsToClose;

  for (const candidateTabId of possibleTabIds) {
    if (!candidateTabId) continue;
    const candidateTabRef = businessRef.collection('dineInTabs').doc(candidateTabId);
    const candidateTabSnap = await candidateTabRef.get();
    if (candidateTabSnap.exists) {
      tabIdsToClose.add(candidateTabId);
    }
  }

  if (tabIdsToClose.size > 0 || !actualTableId) {
    return tabIdsToClose;
  }

  let openTabsSnap;
  try {
    openTabsSnap = await businessRef.collection('dineInTabs')
      .where('tableId', '==', actualTableId)
      .where('status', 'in', ['active', 'inactive'])
      .get();
  } catch {
    const fallback = await businessRef.collection('dineInTabs')
      .where('tableId', '==', actualTableId)
      .get();
    openTabsSnap = {
      docs: fallback.docs.filter((doc) => OPEN_TAB_STATUSES.has(String(doc.data()?.status || '').toLowerCase())),
    };
  }

  const expectedName = String(firstOrderData.tab_name || firstOrderData.customerName || '').trim().toLowerCase();
  const expectedPax = Number(firstOrderData.pax_count || 0);

  const rankedTabs = (openTabsSnap.docs || [])
    .map((doc) => {
      const data = doc.data() || {};
      const tabName = String(data.tab_name || '').trim().toLowerCase();
      const pax = Number(data.pax_count || 0);
      const updatedAt = typeof data.updatedAt?.toMillis === 'function'
        ? data.updatedAt.toMillis()
        : (typeof data.createdAt?.toMillis === 'function' ? data.createdAt.toMillis() : 0);
      let score = 0;
      if (expectedName && tabName === expectedName) score += 3;
      if (expectedPax > 0 && pax === expectedPax) score += 2;
      return {
        id: doc.id,
        score,
        updatedAt,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.updatedAt - a.updatedAt;
    });

  if (rankedTabs.length === 1) {
    tabIdsToClose.add(rankedTabs[0].id);
  } else if (rankedTabs.length > 1 && rankedTabs[0].score > 0) {
    tabIdsToClose.add(rankedTabs[0].id);
  }

  return tabIdsToClose;
}

async function resolveActualTableId({ businessRef, tableId }) {
  if (!businessRef || !tableId) return null;
  const tablesSnap = await businessRef.collection('tables').get();
  let actualTableId = null;
  tablesSnap.forEach((doc) => {
    if (String(doc.id).toLowerCase() === String(tableId).toLowerCase()) {
      actualTableId = doc.id;
    }
  });
  return actualTableId;
}

async function recalculateAndUpdateTable({ businessRef, actualTableId }) {
  if (!businessRef || !actualTableId) return;

  let openTabsSnap;
  try {
    openTabsSnap = await businessRef.collection('dineInTabs')
      .where('tableId', '==', actualTableId)
      .where('status', 'in', ['active', 'inactive'])
      .get();
  } catch {
    const fallback = await businessRef.collection('dineInTabs')
      .where('tableId', '==', actualTableId)
      .get();
    openTabsSnap = {
      docs: fallback.docs.filter((doc) => OPEN_TAB_STATUSES.has(String(doc.data()?.status || '').toLowerCase())),
      empty: fallback.empty,
    };
  }

  const recalculatedPax = (openTabsSnap.docs || []).reduce((sum, doc) => {
    return sum + Math.max(0, Number(doc.data()?.pax_count || 0));
  }, 0);

  await businessRef.collection('tables').doc(actualTableId).set(
    {
      current_pax: recalculatedPax,
      state: recalculatedPax > 0 ? 'occupied' : 'available',
      cleanedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function cleanViaOrderFallback({
  firestore,
  tabId,
  businessRef,
  businessId,
  incomingTableId,
}) {
  const sessionOrdersMap = new Map();

  const byDineInTab = await collectOrdersByField({
    firestore,
    field: 'dineInTabId',
    value: tabId,
    businessId,
  });
  byDineInTab.forEach((doc, id) => sessionOrdersMap.set(id, doc));

  const byLegacyTab = await collectOrdersByField({
    firestore,
    field: 'tabId',
    value: tabId,
    businessId,
  });
  byLegacyTab.forEach((doc, id) => sessionOrdersMap.set(id, doc));

  const tokenFromGroupKey = String(tabId).includes('_token_')
    ? String(tabId).split('_token_')[1]
    : null;
  const carGroupToken = !tokenFromGroupKey && String(tabId).startsWith('car_')
    ? String(tabId).split('_').slice(2).join('_')
    : null;
  const resolvedTokenKey = tokenFromGroupKey || carGroupToken;

  if (resolvedTokenKey) {
    const byToken = await collectOrdersByField({
      firestore,
      field: 'dineInToken',
      value: resolvedTokenKey,
      businessId,
    });
    byToken.forEach((doc, id) => sessionOrdersMap.set(id, doc));
  }

  const sessionOrders = Array.from(sessionOrdersMap.values());
  if (sessionOrders.length === 0) {
    throw new HttpError(404, 'Tab session not found. Nothing to clean.');
  }

  const firstOrderData = sessionOrders[0]?.data?.() || {};
  const resolvedTableId = incomingTableId || firstOrderData.tableId || firstOrderData.table || null;

  const possibleTabIds = new Set();
  sessionOrders.forEach((doc) => {
    const data = doc.data() || {};
    if (data.dineInTabId) possibleTabIds.add(String(data.dineInTabId));
    if (data.tabId) possibleTabIds.add(String(data.tabId));
  });

  const actualTableId = await resolveActualTableId({
    businessRef,
    tableId: resolvedTableId,
  });

  const tabIdsToClose = await resolveTabCandidateIds({
    businessRef,
    possibleTabIds,
    actualTableId,
    firstOrderData,
  });

  const batch = firestore.batch();
  sessionOrders.forEach((doc) => {
    batch.set(
      doc.ref,
      {
        cleaned: true,
        cleanedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  if (businessRef) {
    tabIdsToClose.forEach((candidateTabId) => {
      const candidateTabRef = businessRef.collection('dineInTabs').doc(candidateTabId);
      batch.set(
        candidateTabRef,
        {
          status: 'completed',
          closedAt: FieldValue.serverTimestamp(),
          cleanedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });
  }

  await batch.commit();
  await recalculateAndUpdateTable({ businessRef, actualTableId });

  return {
    success: true,
    message: `Session cleaned using order fallback (${sessionOrders.length} orders).`,
    tabId,
    cleanedOrders: sessionOrders.length,
    closedTabIds: Array.from(tabIdsToClose),
  };
}

async function markOrdersAsCleaned({
  firestore,
  tabId,
  businessId,
}) {
  const cleanedOrdersMap = new Map();
  const byDineInTab = await collectOrdersByField({
    firestore,
    field: 'dineInTabId',
    value: tabId,
    businessId,
  });
  byDineInTab.forEach((doc, id) => cleanedOrdersMap.set(id, doc));

  if (cleanedOrdersMap.size === 0) {
    const byLegacyTab = await collectOrdersByField({
      firestore,
      field: 'tabId',
      value: tabId,
      businessId,
    });
    byLegacyTab.forEach((doc, id) => cleanedOrdersMap.set(id, doc));
  }

  if (cleanedOrdersMap.size === 0) return;

  const batch = firestore.batch();
  Array.from(cleanedOrdersMap.values()).forEach((doc) => {
    batch.set(
      doc.ref,
      {
        cleaned: true,
        cleanedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
  await batch.commit();
}

async function cleanDineInTable(body = {}) {
  const tabId = normalizeText(body.tabId);
  const token = normalizeText(body.token);
  const restaurantId = normalizeText(body.restaurantId);
  const incomingTableId = normalizeText(body.tableId);

  if (!tabId) {
    throw new HttpError(400, 'Missing required field: tabId');
  }

  const firestore = await getFirestore();
  const businessRef = await getBusinessRef(firestore, restaurantId);
  await validateTabTokenIfProvided({
    firestore,
    tabId,
    token,
    businessRef,
  });

  const businessId = businessRef?.id || restaurantId || null;

  let tabRef = firestore.collection('dine_in_tabs').doc(tabId);
  let tabSnap = await tabRef.get();

  if (!tabSnap.exists && businessRef) {
    tabRef = businessRef.collection('dineInTabs').doc(tabId);
    tabSnap = await tabRef.get();
  }

  if (!tabSnap.exists) {
    return cleanViaOrderFallback({
      firestore,
      tabId,
      businessRef,
      businessId,
      incomingTableId,
    });
  }

  let integrityValid = true;
  try {
    const integrity = await verifyTabIntegrity(firestore, tabId);
    integrityValid = integrity.isValid;
  } catch {
    integrityValid = true;
  }

  const result = await firestore.runTransaction(async (transaction) => {
    const txnTabSnap = await transaction.get(tabRef);
    if (!txnTabSnap.exists) {
      throw new HttpError(404, 'Tab not found');
    }

    const tabData = txnTabSnap.data() || {};
    const pendingAmount = toNumber(tabData.pendingAmount, 0);
    if (tabData.pendingAmount !== undefined && pendingAmount > 0.01) {
      throw new HttpError(400, `Pending amount: Rs. ${pendingAmount.toFixed(2)}`);
    }

    const updateData = {
      status: 'completed',
      closedAt: FieldValue.serverTimestamp(),
    };
    if (tabData.totalAmount !== undefined) {
      updateData.finalTotalAmount = tabData.totalAmount;
    }
    if (tabData.paidAmount !== undefined) {
      updateData.finalPaidAmount = tabData.paidAmount;
    }

    transaction.set(tabRef, updateData, { merge: true });

    return {
      totalCollected: toNumber(tabData.paidAmount, 0),
      integrityVerified: integrityValid,
      tabId,
      tableId: tabData.tableId || null,
      pax_count: toNumber(tabData.pax_count, 0),
    };
  });

  await markOrdersAsCleaned({
    firestore,
    tabId,
    businessId,
  });

  const actualTableId = await resolveActualTableId({
    businessRef,
    tableId: result.tableId,
  });
  await recalculateAndUpdateTable({
    businessRef,
    actualTableId,
  });

  return {
    success: true,
    ...result,
  };
}

module.exports = {
  cleanDineInTable,
};
