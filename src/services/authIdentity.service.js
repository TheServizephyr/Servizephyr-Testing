const { verifyIdToken } = require('../lib/firebaseAdmin');
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

async function verifyAndGetUid(req, options = {}) {
  const checkRevoked = options.checkRevoked === true;
  const token = extractBearerToken(req);

  try {
    const decoded = await verifyIdToken(token, checkRevoked);
    const uid = String(decoded?.uid || '').trim();
    if (!uid) {
      throw new HttpError(401, 'Invalid token.');
    }
    return uid;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    const code = String(error?.code || '').toLowerCase();
    if (code === 'auth/id-token-expired') {
      throw new HttpError(401, 'Login token has expired. Please log in again.');
    }
    if (code === 'auth/id-token-revoked') {
      throw new HttpError(401, 'Session token revoked. Please log in again.');
    }
    throw new HttpError(401, 'Token verification failed.');
  }
}

module.exports = {
  extractBearerToken,
  verifyAndGetUid,
};
