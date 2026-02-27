const { FieldValue } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { resolveOwnerContext } = require('./accessControl.service');

async function getOwnerLocations(req) {
  const owner = await resolveOwnerContext(req, { checkRevoked: false });
  const businessData = owner.businessData || {};
  const address = businessData.address;

  if (!address || typeof address.latitude !== 'number' || typeof address.longitude !== 'number') {
    return { location: null, message: 'No operational location set.' };
  }

  return { location: address };
}

async function saveOwnerLocation(req, body = {}) {
  const owner = await resolveOwnerContext(req, { checkRevoked: false });
  const location = body.location;

  if (!location || typeof location.latitude !== 'number' || typeof location.longitude !== 'number') {
    throw new HttpError(400, 'Valid location object with latitude and longitude is required.');
  }

  const nextAddress = {
    ...location,
    updatedAt: FieldValue.serverTimestamp(),
  };

  await owner.businessSnap.ref.set(
    { address: nextAddress },
    { merge: true }
  );

  return {
    message: 'Operational location saved successfully!',
    location: nextAddress,
  };
}

module.exports = {
  getOwnerLocations,
  saveOwnerLocation,
};
