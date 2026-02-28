const { getFirestore, FieldValue } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { findBusinessById } = require('./business.service');
const { resolveOwnerContext, PERMISSIONS } = require('./accessControl.service');

function toIso(value) {
  if (value?.toDate && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date().toISOString();
}

async function getOwnerServiceRequests(req) {
  const { logger } = require('../lib/logger');

  logger.info('[ServiceRequests] Resolving owner context...');
  const owner = await resolveOwnerContext(req, {
    requiredPermissions: [PERMISSIONS.VIEW_DINE_IN_ORDERS, PERMISSIONS.MANAGE_DINE_IN],
  });
  logger.info({ businessId: owner.businessId }, '[ServiceRequests] Owner context resolved.');

  let snap;
  try {
    logger.info('[ServiceRequests] Fetching pending service requests...');
    // In Firebase Admin SDK, a simple equality filter usually doesn't need a composite index 
    // when combined with client-side sorting, OR the composite index creation is failing.
    // To prevent 15-second timeouts, we only fetch pending ones, then limit to a reasonable number.
    snap = await owner.businessSnap.ref
      .collection('serviceRequests')
      .where('status', '==', 'pending')
      .get();

    logger.info({ count: snap.docs.length }, '[ServiceRequests] Fetch complete.');
  } catch (err) {
    logger.error({ err }, '[ServiceRequests] Fetch failed.');
    throw new HttpError(500, 'Database query failed for service requests.');
  }

  // Sort chronologically in memory (newest first). 
  // Since we only queried 'pending' requests, the payload is small enough that this won't timeout.
  const docs = snap.docs.sort((a, b) => {
    const at = a.data()?.createdAt?.toMillis?.() || 0;
    const bt = b.data()?.createdAt?.toMillis?.() || 0;
    return bt - at;
  });

  const requests = docs.map((doc) => ({
    ...(doc.data() || {}),
    createdAt: toIso(doc.data()?.createdAt),
  }));

  logger.info({ requestsCount: requests.length }, '[ServiceRequests] Data processed. Returning.');
  return { requests };
}

async function postPublicServiceRequest(body = {}) {
  const restaurantId = String(body.restaurantId || '').trim();
  const tableId = String(body.tableId || '').trim();
  const dineInTabId = String(body.dineInTabId || '').trim();

  if (!restaurantId || !tableId) {
    throw new HttpError(400, 'Restaurant and Table ID are required.');
  }

  const firestore = await getFirestore();
  const business = await findBusinessById({ firestore, businessId: restaurantId });
  const requestRef = business.ref.collection('serviceRequests').doc();

  await requestRef.set({
    id: requestRef.id,
    tableId,
    dineInTabId: dineInTabId || null,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
  });

  return {
    message: 'Service request sent successfully!',
    id: requestRef.id,
  };
}

async function patchOwnerServiceRequest(req, body = {}) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
    requiredPermissions: [PERMISSIONS.MANAGE_DINE_IN],
  });

  const requestId = String(body.requestId || '').trim();
  const status = String(body.status || '').trim();
  if (!requestId || !status) {
    throw new HttpError(400, 'Request ID and new status are required.');
  }

  const requestRef = owner.businessSnap.ref.collection('serviceRequests').doc(requestId);
  const requestSnap = await requestRef.get();
  if (!requestSnap.exists) {
    throw new HttpError(404, 'Service request not found.');
  }

  await requestRef.update({ status });
  return { message: `Request marked as ${status}.` };
}

module.exports = {
  getOwnerServiceRequests,
  postPublicServiceRequest,
  patchOwnerServiceRequest,
};
