const { getFirestore, verifyIdToken } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');

function extractBearerToken(req) {
  const authHeader = String(req.headers.authorization || '');
  if (!authHeader.startsWith('Bearer ')) {
    throw new HttpError(401, 'Authorization token is missing or malformed.');
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    throw new HttpError(401, 'Authorization token is missing or malformed.');
  }
  return token;
}

function mapTokenError(error) {
  const code = String(error?.code || '').toLowerCase();
  if (code === 'auth/id-token-revoked') {
    return new HttpError(401, 'Session expired. Please login again.');
  }
  if (code === 'auth/id-token-expired') {
    return new HttpError(401, 'Token expired. Please login again.');
  }
  return new HttpError(401, `Token verification failed: ${error?.message || 'invalid token'}`);
}

async function resolveAuthenticatedCustomer(req, options = {}) {
  const checkRevoked = options.checkRevoked === true;
  const allowMissingUser = options.allowMissingUser === true;

  const token = extractBearerToken(req);
  let decoded;
  try {
    decoded = await verifyIdToken(token, checkRevoked);
  } catch (error) {
    throw mapTokenError(error);
  }

  const uid = String(decoded?.uid || '').trim();
  if (!uid) {
    throw new HttpError(401, 'Invalid authorization token.');
  }

  const firestore = await getFirestore();
  const userRef = firestore.collection('users').doc(uid);
  const userDoc = await userRef.get();
  if (!userDoc.exists && !allowMissingUser) {
    throw new HttpError(404, 'User profile not found.');
  }

  return {
    firestore,
    uid,
    userRef,
    userDoc,
    userData: userDoc.exists ? (userDoc.data() || {}) : {},
  };
}

module.exports = {
  resolveAuthenticatedCustomer,
};
