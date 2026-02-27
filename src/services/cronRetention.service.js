const { getFirestore } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');

const DAYS_TO_KEEP = 7;

async function deleteByRefs(firestore, refs) {
  if (!refs.length) return 0;
  const chunkSize = 450;
  let deleted = 0;

  for (let i = 0; i < refs.length; i += chunkSize) {
    const chunk = refs.slice(i, i + chunkSize);
    const batch = firestore.batch();
    for (const ref of chunk) {
      batch.delete(ref);
    }
    await batch.commit();
    deleted += chunk.length;
  }

  return deleted;
}

function toMillis(value) {
  if (!value) return null;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseBearerToken(req) {
  const auth = String(req.headers.authorization || '');
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}

async function getCronCleanupRetention(req) {
  const secret = String(process.env.CRON_SECRET || '').trim();
  const token = parseBearerToken(req);
  if (!secret || token !== secret) {
    throw new HttpError(401, 'Unauthorized');
  }

  const firestore = await getFirestore();
  const cutoffMs = Date.now() - DAYS_TO_KEEP * 24 * 60 * 60 * 1000;
  const cutoffDate = new Date(cutoffMs);

  const rateSnap = await firestore
    .collection('rate_limits')
    .where('createdAt', '<', cutoffDate)
    .get();
  const rateDeleted = await deleteByRefs(firestore, rateSnap.docs.map((d) => d.ref));

  const idemSnap = await firestore.collection('idempotency_keys').get();
  const idemRefsToDelete = [];
  for (const doc of idemSnap.docs) {
    const data = doc.data() || {};
    const ts = toMillis(data.completedAt) ?? toMillis(data.failedAt) ?? toMillis(data.createdAt);
    if (ts && ts < cutoffMs) {
      idemRefsToDelete.push(doc.ref);
    }
  }
  const idempotencyDeleted = await deleteByRefs(firestore, idemRefsToDelete);

  const authTokenSnap = await firestore.collection('auth_tokens').get();
  const authTokenRefsToDelete = [];
  for (const doc of authTokenSnap.docs) {
    const data = doc.data() || {};
    const ts = toMillis(data.expiresAt) ?? toMillis(data.createdAt);
    if (ts && ts < cutoffMs) {
      authTokenRefsToDelete.push(doc.ref);
    }
  }
  const authTokensDeleted = await deleteByRefs(firestore, authTokenRefsToDelete);

  const auditSnap = await firestore.collection('audit_logs').get();
  const auditRefsToDelete = [];
  for (const doc of auditSnap.docs) {
    const data = doc.data() || {};
    const ts = toMillis(data.createdAt) ?? toMillis(data.timestamp);
    if (ts && ts < cutoffMs) {
      auditRefsToDelete.push(doc.ref);
    }
  }
  const auditLogsDeleted = await deleteByRefs(firestore, auditRefsToDelete);

  return {
    success: true,
    retentionDays: DAYS_TO_KEEP,
    rateLimits: {
      scannedByQuery: rateSnap.size,
      deleted: rateDeleted,
    },
    idempotencyKeys: {
      scanned: idemSnap.size,
      deleted: idempotencyDeleted,
    },
    authTokens: {
      scanned: authTokenSnap.size,
      deleted: authTokensDeleted,
    },
    auditLogs: {
      scanned: auditSnap.size,
      deleted: auditLogsDeleted,
    },
  };
}

module.exports = {
  getCronCleanupRetention,
};
