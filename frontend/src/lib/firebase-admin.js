
import admin from 'firebase-admin';

// --- START: SINGLETON PATTERN ---
// This ensures that we only initialize the Firebase Admin SDK once,
// no matter how many times these helper functions are imported.

let adminInstance = null;
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

async function flushDbMetrics(adminSdk) {
  if (!DB_ANALYTICS_ENABLED) return;
  if (!adminSdk || DB_ANALYTICS_PENDING.size === 0) return;

  const metrics = Array.from(DB_ANALYTICS_PENDING.values());
  DB_ANALYTICS_PENDING.clear();

  let db;
  try {
    db = adminSdk.database();
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
    console.warn('[db-analytics] Metric flush failed:', error?.message || error);
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

function patchFirestoreInstrumentation(adminSdk) {
  const firestore = adminSdk.firestore();
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

function patchRtdbInstrumentation(adminSdk) {
  const database = adminSdk.database();
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

function ensureDbAnalyticsInstrumentation(adminSdk) {
  if (!DB_ANALYTICS_ENABLED) return;
  if (dbAnalyticsPatched) return;

  try {
    patchFirestoreInstrumentation(adminSdk);
  } catch (error) {
    console.warn('[db-analytics] Firestore instrumentation skipped:', error?.message || error);
  }

  try {
    patchRtdbInstrumentation(adminSdk);
  } catch (error) {
    console.warn('[db-analytics] RTDB instrumentation skipped:', error?.message || error);
  }

  dbAnalyticsFlushTimer = setInterval(() => {
    flushDbMetrics(adminSdk).catch(() => {});
  }, DB_ANALYTICS_FLUSH_MS);
  if (typeof dbAnalyticsFlushTimer.unref === 'function') {
    dbAnalyticsFlushTimer.unref();
  }

  dbAnalyticsPatched = true;
}

function getServiceAccount() {
  // This function remains the same, it correctly gets credentials from env vars.
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    console.log("[firebase-admin] Found FIREBASE_SERVICE_ACCOUNT_JSON env var.");
    try {
      const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      console.log("[firebase-admin] Successfully parsed FIREBASE_SERVICE_ACCOUNT_JSON.");
      return parsed;
    } catch (e) {
      console.error("[firebase-admin] CRITICAL: Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON.", e.message);
      return null;
    }
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    console.log("[firebase-admin] Found FIREBASE_SERVICE_ACCOUNT_BASE64 env var.");
    try {
      const decodedServiceAccount = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf-8');
      const parsed = JSON.parse(decodedServiceAccount);
      console.log("[firebase-admin] Successfully parsed FIREBASE_SERVICE_ACCOUNT_BASE64.");
      return parsed;
    } catch (e) {
      console.error("[firebase-admin] CRITICAL: Failed to parse Base64 encoded service account.", e.message);
      return null;
    }
  }

  console.error("[firebase-admin] FATAL: No Firebase service account credentials found in env vars.");
  return null;
}

function initializeAdmin() {
  if (admin.apps.length > 0) {
    ensureDbAnalyticsInstrumentation(admin);
    return admin;
  }

  const serviceAccount = getServiceAccount();
  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || "https://studio-6552995429-8bffe-default-rtdb.asia-southeast1.firebasedatabase.app"  // ✅ RTDB
    });
    ensureDbAnalyticsInstrumentation(admin);
    console.log("[firebase-admin] Firebase Admin SDK initialized successfully.");
    return admin;
  }

  // This will only be reached if no credentials are found at all.
  console.error("[firebase-admin] CRITICAL: Firebase Admin SDK initialization failed because no credentials were found.");
  // We don't throw an error here to prevent server crashes on build,
  // but subsequent calls to getAuth/getFirestore will fail.
  return null;
}

const getAdminInstance = () => {
  if (!adminInstance) {
    adminInstance = initializeAdmin();
  }
  if (!adminInstance) {
    // This is the safety net. If initialization failed, every call will throw a clear error.
    throw new Error("Firebase Admin SDK is not initialized. Check server logs for credential errors.");
  }
  return adminInstance;
};
// --- END: SINGLETON PATTERN ---


const getAuth = async () => {
  const adminSdk = getAdminInstance();
  return adminSdk.auth();
};

const getFirestore = async () => {
  const adminSdk = getAdminInstance();
  return adminSdk.firestore();
};

const FieldValue = admin.firestore.FieldValue;
const GeoPoint = admin.firestore.GeoPoint;
const Timestamp = admin.firestore.Timestamp;


/**
 * Verifies the authorization token from a request and returns the user's UID.
 * This is the central point for all API authentication checks.
 * @param {Request} req The incoming Next.js request object.
 * @param {boolean} checkRevoked Whether to check if the token has been revoked (slower).
 * @returns {Promise<string>} The user's UID.
 * @throws Will throw an error with a status code if the token is missing or invalid.
 */
const verifyAndGetUid = async (req, checkRevoked = false) => {
  const auth = await getAuth();
  const authHeader = req.headers.get('authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw { message: 'Authorization token is missing or malformed.', status: 401 };
  }
  const token = authHeader.split('Bearer ')[1];

  try {
    // ✅ OPTIMIZED: checkRevoked is only done on security-critical routes if requested
    const decodedToken = await auth.verifyIdToken(token, checkRevoked);
    return decodedToken.uid;
  } catch (error) {
    console.error("[verifyAndGetUid] Error verifying token:", error.message);

    // Map specific Firebase auth errors to appropriate HTTP status codes
    if (error.code === 'auth/id-token-revoked') {
      throw {
        message: 'Session expired. Please login again.',
        status: 401,
        code: 'TOKEN_REVOKED'
      };
    }

    if (error.code === 'auth/id-token-expired') {
      throw {
        message: 'Token expired. Please login again.',
        status: 401,
        code: 'TOKEN_EXPIRED'
      };
    }

    // Generic auth failure
    throw {
      message: `Token verification failed: ${error.message}`,
      status: 401,  // Changed from 403 to 401 for auth failures
      code: error.code || 'AUTH_FAILED'
    };
  }
}

const getDatabase = async () => {
  const adminSdk = getAdminInstance();
  return adminSdk.database(); // ✅ RTDB for real-time tracking
};


const verifyIdToken = async (token, checkRevoked = false) => {
  const auth = await getAuth();
  return auth.verifyIdToken(token, checkRevoked);
};

export { getAuth, getFirestore, getDatabase, FieldValue, GeoPoint, Timestamp, verifyAndGetUid, verifyIdToken };

