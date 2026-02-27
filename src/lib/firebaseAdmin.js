const admin = require('firebase-admin');
const { config } = require('../config/env');
const { logger } = require('./logger');

let appInstance = null;

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
    return appInstance;
  }

  const serviceAccount = parseServiceAccountFromEnv();
  appInstance = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

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
