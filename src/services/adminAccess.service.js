const { getFirestore, verifyIdToken } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');

function extractBearerToken(req) {
  const authHeader = String(req.headers.authorization || '');
  if (!authHeader.startsWith('Bearer ')) {
    throw new HttpError(401, 'Authorization token missing or malformed.');
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    throw new HttpError(401, 'Authorization token missing or malformed.');
  }
  return token;
}

async function resolveAdminContext(req, options = {}) {
  const checkRevoked = options.checkRevoked === true;
  const token = extractBearerToken(req);

  let decoded;
  try {
    decoded = await verifyIdToken(token, checkRevoked);
  } catch {
    throw new HttpError(401, 'Token verification failed.');
  }

  const uid = String(decoded?.uid || '').trim();
  if (!uid) throw new HttpError(401, 'Invalid token.');

  const firestore = await getFirestore();
  const userDoc = await firestore.collection('users').doc(uid).get();
  const userData = userDoc.exists ? (userDoc.data() || {}) : {};

  if (String(userData.role || '').trim().toLowerCase() !== 'admin') {
    throw new HttpError(403, 'Access Denied: Admin only');
  }

  return {
    firestore,
    uid,
    userDoc,
    userData,
  };
}

module.exports = {
  extractBearerToken,
  resolveAdminContext,
};
