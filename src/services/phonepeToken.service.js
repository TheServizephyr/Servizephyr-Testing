const { HttpError } = require('../utils/httpError');
const { getPhonePeAccessTokenDetails } = require('./phonepe.service');

function getInternalSecret(req) {
  return String(req.headers['x-internal-secret'] || '').trim();
}

function validateInternalSecret(req) {
  const configuredSecret = String(process.env.INTERNAL_API_SECRET || '').trim();
  if (!configuredSecret) {
    throw new HttpError(500, 'INTERNAL_API_SECRET is not configured.');
  }

  const incomingSecret = getInternalSecret(req);
  if (!incomingSecret || incomingSecret !== configuredSecret) {
    throw new HttpError(403, 'Unauthorized. Internal access only.');
  }
}

async function getPhonePeTokenForInternal(req) {
  validateInternalSecret(req);
  const token = await getPhonePeAccessTokenDetails();
  return {
    success: true,
    access_token: token.accessToken,
    expires_at: token.expiresAtSec,
  };
}

module.exports = {
  getPhonePeTokenForInternal,
};
