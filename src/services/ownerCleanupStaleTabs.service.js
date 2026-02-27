const { HttpError } = require('../utils/httpError');
const { resolveOwnerContext, PERMISSIONS } = require('./accessControl.service');

async function postOwnerCleanupStaleTabs(req, body = {}) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: false,
    requiredPermissions: [PERMISSIONS.MANAGE_DINE_IN],
  });

  const restaurantId = String(body.restaurantId || owner.businessId || '').trim();
  const dryRun = body.dryRun !== false;

  if (!restaurantId) {
    throw new HttpError(400, 'Restaurant ID required');
  }
  if (restaurantId !== owner.businessId) {
    throw new HttpError(403, 'Unauthorized for requested restaurant');
  }

  const firestore = owner.firestore;
  const businessRef = owner.businessSnap.ref;
  const results = {
    tabsFound: 0,
    staleTabsDeleted: 0,
    tablesUpdated: 0,
    details: [],
  };

  const tabsSnap = await businessRef.collection('dineInTabs').get();
  results.tabsFound = tabsSnap.size;

  const staleTabs = [];
  const validTabs = {};

  for (const tabDoc of tabsSnap.docs) {
    const tabData = tabDoc.data() || {};
    const tableId = tabData.tableId;
    const dineInTabId = String(tabData.id || tabDoc.id);

    const ordersSnap = await firestore
      .collection('orders')
      .where('dineInTabId', '==', dineInTabId)
      .where('createdAt', '>', new Date(Date.now() - 24 * 60 * 60 * 1000))
      .limit(1)
      .get();

    const hasRecentOrders = !ordersSnap.empty;
    const status = String(tabData.status || '').toLowerCase();

    if (!hasRecentOrders && (status === 'inactive' || status === 'active')) {
      staleTabs.push({
        id: tabDoc.id,
        tableId,
        tab_name: tabData.tab_name,
        pax_count: tabData.pax_count,
        status: tabData.status,
        createdAt: tabData.createdAt?.toDate ? tabData.createdAt.toDate() : null,
      });
    } else if (tableId) {
      if (!validTabs[tableId]) validTabs[tableId] = [];
      validTabs[tableId].push(tabData);
    }
  }

  results.details = staleTabs;

  if (!dryRun) {
    const batch = firestore.batch();

    staleTabs.forEach((tab) => {
      const tabRef = businessRef.collection('dineInTabs').doc(tab.id);
      batch.delete(tabRef);
    });

    const tablesSnap = await businessRef.collection('tables').get();
    tablesSnap.docs.forEach((tableDoc) => {
      const tableId = tableDoc.id;
      const maxCapacity = Number(tableDoc.data()?.max_capacity || 0);
      const validTabsForTable = validTabs[tableId] || [];
      const currentPax = validTabsForTable.reduce((sum, tab) => sum + Number(tab.pax_count || 0), 0);

      let state = 'available';
      if (currentPax > 0) state = 'occupied';
      if (maxCapacity > 0 && currentPax >= maxCapacity) state = 'full';

      batch.set(
        businessRef.collection('tables').doc(tableId),
        {
          current_pax: currentPax,
          state,
        },
        { merge: true }
      );
      results.tablesUpdated += 1;
    });

    await batch.commit();
    results.staleTabsDeleted = staleTabs.length;
  }

  return {
    message: dryRun ? 'Dry run completed (no changes made)' : 'Cleanup completed',
    dryRun,
    results,
  };
}

module.exports = {
  postOwnerCleanupStaleTabs,
};
