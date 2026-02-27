const { resolveAdminContext } = require('./adminAccess.service');

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) return fallback;
  return parsed;
}

function toIso(value) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function getAdminAuditLogs(req) {
  const { firestore } = await resolveAdminContext(req, { checkRevoked: false });

  const adminFilter = String(req.query?.adminId || '').trim();
  const actionFilter = String(req.query?.action || '').trim();
  const startDate = String(req.query?.startDate || '').trim();
  const endDate = String(req.query?.endDate || '').trim();
  const limit = toPositiveInt(req.query?.limit, 50) || 50;
  const offset = toPositiveInt(req.query?.offset, 0) || 0;

  let baseQuery = firestore.collection('audit_logs');
  if (adminFilter) baseQuery = baseQuery.where('adminId', '==', adminFilter);
  if (actionFilter) baseQuery = baseQuery.where('action', '==', actionFilter);
  if (startDate) baseQuery = baseQuery.where('timestamp', '>=', new Date(startDate));
  if (endDate) baseQuery = baseQuery.where('timestamp', '<=', new Date(endDate));

  baseQuery = baseQuery.orderBy('timestamp', 'desc');

  const countSnapshot = await baseQuery.get();
  const totalCount = countSnapshot.size;

  let query = baseQuery.limit(limit);
  if (offset > 0 && typeof query.offset === 'function') {
    query = baseQuery.offset(offset).limit(limit);
  } else if (offset > 0) {
    const docs = countSnapshot.docs;
    const pivot = docs[offset - 1];
    if (pivot) {
      query = baseQuery.startAfter(pivot).limit(limit);
    }
  }

  const snapshot = await query.get();
  const logs = snapshot.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      id: doc.id,
      ...data,
      timestamp: toIso(data.timestamp) || data.timestampISO || null,
    };
  });

  return {
    logs,
    totalCount,
    limit,
    offset,
    hasMore: offset + limit < totalCount,
  };
}

module.exports = {
  getAdminAuditLogs,
};
