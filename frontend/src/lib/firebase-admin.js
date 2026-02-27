
import admin from 'firebase-admin';

// --- START: SINGLETON PATTERN ---
// This ensures that we only initialize the Firebase Admin SDK once,
// no matter how many times these helper functions are imported.

let adminInstance = null;

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
    return admin;
  }

  const serviceAccount = getServiceAccount();
  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || "https://studio-6552995429-8bffe-default-rtdb.asia-southeast1.firebasedatabase.app"  // ✅ RTDB
    });
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

