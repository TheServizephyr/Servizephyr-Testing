const admin = require('firebase-admin');
const { config } = require('../config/env');
const { logger } = require('./logger');

let appInstance = null;
let dbAnalyticsPatched = false;
const DB_ANALYTICS_PENDING = new Map();
let dbAnalyticsFlushTimer = null;

const DB_ANALYTICS_ENABLED = process.env.ENABLE_FIREBASE_DB_QUERY_ANALYTICS !== 'false';
const DB_ANALYTICS_FLUSH_MS = Math.max(5000, Number(process.env.DB_ANALYTICS_FLUSH_MS || 30000));
const DB_ANALYTICS_SLOW_MS = Math.max(1, Number(process.env.DB_ANALYTICS_SLOW_MS || 500));
const DB_ANALYTICS_PATH = String(process.env.DB_ANALYTICS_PATH || 'ops/db_query_metrics')
  .replace(/^\/+|\/+$/g, '');

function getDayKey() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeDurationMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

function queueDbMetric(dbType, op, durationMs, ok, target) {
  if (!DB_ANALYTICS_ENABLED) return;
  const day = getDayKey();
  const safeDbType = String(dbType || 'unknown');
  const safeOp = String(op || 'unknown');
  const key = `${day}|${safeDbType}|${safeOp}`;
  const duration = normalizeDurationMs(durationMs);
  const nowIso = new Date().toISOString();

  const prev = DB_ANALYTICS_PENDING.get(key) || {
    day,
    dbType: safeDbType,
    op: safeOp,
    count: 0,
    totalMs: 0,
    maxMs: 0,
    slowCount: 0,
    errorCount: 0,
    lastMs: 0,
    lastAt: nowIso,
    lastTarget: '',
  };

  prev.count += 1;
  prev.totalMs += duration;
  prev.maxMs = Math.max(prev.maxMs, duration);
  prev.lastMs = duration;
  prev.lastAt = nowIso;
  prev.lastTarget = String(target || '').slice(0, 400);
  if (duration >= DB_ANALYTICS_SLOW_MS) prev.slowCount += 1;
  if (!ok) prev.errorCount += 1;
  DB_ANALYTICS_PENDING.set(key, prev);
}

function shouldSkipRtdbTarget(target) {
  const t = String(target || '');
  if (!t) return false;
  return t.includes(`/${DB_ANALYTICS_PATH}/`) || t.endsWith(`/${DB_ANALYTICS_PATH}`);
}

async function flushDbMetrics() {
  if (!DB_ANALYTICS_ENABLED) return;
  if (!appInstance || DB_ANALYTICS_PENDING.size === 0) return;

  const metrics = Array.from(DB_ANALYTICS_PENDING.values());
  DB_ANALYTICS_PENDING.clear();

  let db;
  try {
    db = appInstance.database();
  } catch {
    return;
  }

  await Promise.all(metrics.map(async (metric) => {
    const ref = db.ref(`${DB_ANALYTICS_PATH}/${metric.day}/${metric.dbType}/${metric.op}`);
    await ref.transaction((current) => {
      const base = current || {};
      return {
        count: (Number(base.count) || 0) + metric.count,
        totalMs: (Number(base.totalMs) || 0) + metric.totalMs,
        maxMs: Math.max(Number(base.maxMs) || 0, metric.maxMs),
        slowCount: (Number(base.slowCount) || 0) + metric.slowCount,
        errorCount: (Number(base.errorCount) || 0) + metric.errorCount,
        lastMs: metric.lastMs,
        lastAt: metric.lastAt,
        lastTarget: metric.lastTarget,
      };
    });
  })).catch((error) => {
    logger.warn({ err: error?.message || String(error) }, 'DB analytics metric flush failed');
  });
}

function wrapAsyncMethod(proto, methodName, dbType, getTarget) {
  if (!proto || typeof proto[methodName] !== 'function') return;
  const original = proto[methodName];
  if (original.__dbAnalyticsWrapped) return;

  const wrapped = function (...args) {
    const startedAt = Date.now();
    const target = typeof getTarget === 'function' ? getTarget.call(this, ...args) : '';
    if (dbType === 'rtdb' && shouldSkipRtdbTarget(target)) {
      return original.apply(this, args);
    }

    try {
      const result = original.apply(this, args);
      if (!result || typeof result.then !== 'function') {
        queueDbMetric(dbType, methodName, Date.now() - startedAt, true, target);
        return result;
      }

      return result
        .then((value) => {
          queueDbMetric(dbType, methodName, Date.now() - startedAt, true, target);
          return value;
        })
        .catch((error) => {
          queueDbMetric(dbType, methodName, Date.now() - startedAt, false, target);
          throw error;
        });
    } catch (error) {
      queueDbMetric(dbType, methodName, Date.now() - startedAt, false, target);
      throw error;
    }
  };

  wrapped.__dbAnalyticsWrapped = true;
  proto[methodName] = wrapped;
}

function patchFirestoreInstrumentation(app) {
  const firestore = app.firestore();
  const collectionRef = firestore.collection('_db_analytics_probe');
  const docRef = collectionRef.doc('_probe');
  const queryRef = collectionRef.where('__name__', '==', '_probe');
  const batch = firestore.batch();

  wrapAsyncMethod(Object.getPrototypeOf(docRef), 'get', 'firestore', function () { return this.path; });
  wrapAsyncMethod(Object.getPrototypeOf(docRef), 'set', 'firestore', function () { return this.path; });
  wrapAsyncMethod(Object.getPrototypeOf(docRef), 'update', 'firestore', function () { return this.path; });
  wrapAsyncMethod(Object.getPrototypeOf(docRef), 'delete', 'firestore', function () { return this.path; });
  wrapAsyncMethod(Object.getPrototypeOf(collectionRef), 'add', 'firestore', function () { return this.path; });
  wrapAsyncMethod(Object.getPrototypeOf(collectionRef), 'get', 'firestore', function () { return this.path; });
  wrapAsyncMethod(Object.getPrototypeOf(queryRef), 'get', 'firestore', function () {
    const parentSegments = this?._queryOptions?.parentPath?.segments;
    const collectionId = this?._queryOptions?.collectionId;
    const parent = Array.isArray(parentSegments) ? parentSegments.join('/') : '';
    return [parent, collectionId].filter(Boolean).join('/') || 'query';
  });
  wrapAsyncMethod(Object.getPrototypeOf(batch), 'commit', 'firestore', function () { return 'batch'; });

  if (typeof firestore.runTransaction === 'function' && !firestore.runTransaction.__dbAnalyticsWrapped) {
    const originalRunTransaction = firestore.runTransaction.bind(firestore);
    const wrappedRunTransaction = async (...args) => {
      const startedAt = Date.now();
      try {
        const result = await originalRunTransaction(...args);
        queueDbMetric('firestore', 'runTransaction', Date.now() - startedAt, true, 'transaction');
        return result;
      } catch (error) {
        queueDbMetric('firestore', 'runTransaction', Date.now() - startedAt, false, 'transaction');
        throw error;
      }
    };
    wrappedRunTransaction.__dbAnalyticsWrapped = true;
    firestore.runTransaction = wrappedRunTransaction;
  }
}

function patchRtdbInstrumentation(app) {
  const database = app.database();
  const probeRef = database.ref('_db_analytics_probe');
  const proto = Object.getPrototypeOf(probeRef);
  const getTarget = function () {
    if (typeof this?.toString === 'function') return this.toString();
    return this?.key || 'ref';
  };

  ['get', 'once', 'set', 'update', 'remove', 'transaction'].forEach((methodName) => {
    wrapAsyncMethod(proto, methodName, 'rtdb', getTarget);
  });
}

function ensureDbAnalyticsInstrumentation(app) {
  if (!DB_ANALYTICS_ENABLED) return;
  if (dbAnalyticsPatched) return;

  try {
    patchFirestoreInstrumentation(app);
  } catch (error) {
    logger.warn({ err: error?.message || String(error) }, 'Firestore instrumentation skipped');
  }

  try {
    patchRtdbInstrumentation(app);
  } catch (error) {
    logger.warn({ err: error?.message || String(error) }, 'RTDB instrumentation skipped');
  }

  dbAnalyticsFlushTimer = setInterval(() => {
    flushDbMetrics().catch(() => {});
  }, DB_ANALYTICS_FLUSH_MS);
  if (typeof dbAnalyticsFlushTimer.unref === 'function') {
    dbAnalyticsFlushTimer.unref();
  }

  dbAnalyticsPatched = true;
}

function parseServiceAccountFromEnv() {
  if (config.firebase.serviceAccountJson) {
    try {
      return JSON.parse(config.firebase.serviceAccountJson);
    } catch (error) {
      throw new Error(`Invalid FIREBASE_SERVICE_ACCOUNT_JSON: ${error.message}`);
    }
  }

  if (config.firebase.serviceAccountBase64) {
    try {
      const decoded = Buffer.from(config.firebase.serviceAccountBase64, 'base64').toString('utf8');
      return JSON.parse(decoded);
    } catch (error) {
      throw new Error(`Invalid FIREBASE_SERVICE_ACCOUNT_BASE64: ${error.message}`);
    }
  }

  throw new Error('Firebase credentials missing. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_BASE64.');
}

function getAdminApp() {
  if (appInstance) return appInstance;
  if (admin.apps.length > 0) {
    appInstance = admin.app();
    ensureDbAnalyticsInstrumentation(appInstance);
    return appInstance;
  }

  const serviceAccount = parseServiceAccountFromEnv();
  const initOptions = {
    credential: admin.credential.cert(serviceAccount),
  };
  if (config.firebase.databaseUrl) {
    initOptions.databaseURL = config.firebase.databaseUrl;
  }
  appInstance = admin.initializeApp(initOptions);
  ensureDbAnalyticsInstrumentation(appInstance);

  logger.info({ projectId: serviceAccount.project_id }, 'Firebase Admin initialized');
  return appInstance;
}

async function getFirestore() {
  return getAdminApp().firestore();
}

async function getAuth() {
  return getAdminApp().auth();
}

async function getDatabase() {
  return getAdminApp().database();
}

async function getStorage() {
  return getAdminApp().storage();
}

async function verifyIdToken(idToken, checkRevoked = false) {
  const auth = await getAuth();
  return auth.verifyIdToken(idToken, checkRevoked);
}

module.exports = {
  getFirestore,
  getAuth,
  getDatabase,
  getStorage,
  verifyIdToken,
  FieldValue: admin.firestore.FieldValue,
  GeoPoint: admin.firestore.GeoPoint,
  Timestamp: admin.firestore.Timestamp,
};
