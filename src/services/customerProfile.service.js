const { FieldValue } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { resolveAuthenticatedCustomer } = require('./customerAuth.service');

const DEFAULT_NOTIFICATIONS = {
  orderUpdates: true,
  promotions: true,
  communityAlerts: false,
};

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.slice(-10);
}

function buildProfilePayload(userData = {}) {
  const storedNotifications = userData?.customerPreferences?.notifications || {};
  return {
    name: userData.name || '',
    email: userData.email || '',
    phone: normalizePhone(userData.phone),
    profilePicture: userData.profilePictureUrl || userData.profilePicture || '',
    customerId: userData.customerId || '',
    notifications: {
      ...DEFAULT_NOTIFICATIONS,
      ...storedNotifications,
    },
  };
}

async function getCustomerProfile(req) {
  const customer = await resolveAuthenticatedCustomer(req, {
    checkRevoked: false,
    allowMissingUser: false,
  });

  return {
    payload: buildProfilePayload(customer.userData || {}),
    context: customer,
  };
}

async function updateCustomerProfile(req, body = {}) {
  const customer = await resolveAuthenticatedCustomer(req, {
    checkRevoked: true,
    allowMissingUser: false,
  });

  const updateData = {};

  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    const name = String(body.name || '').trim();
    if (!name) {
      throw new HttpError(400, 'Name cannot be empty.');
    }
    updateData.name = name;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'phone')) {
    const phone = normalizePhone(body.phone);
    if (phone.length !== 10) {
      throw new HttpError(400, 'Phone must be a valid 10-digit number.');
    }
    updateData.phone = phone;
  }

  if (body.notifications && typeof body.notifications === 'object') {
    const sanitized = {};
    Object.keys(DEFAULT_NOTIFICATIONS).forEach((key) => {
      if (typeof body.notifications[key] === 'boolean') {
        sanitized[key] = body.notifications[key];
      }
    });
    if (Object.keys(sanitized).length > 0) {
      updateData['customerPreferences.notifications'] = sanitized;
    }
  }

  if (Object.keys(updateData).length === 0) {
    throw new HttpError(400, 'No valid profile updates provided.');
  }

  updateData.updatedAt = FieldValue.serverTimestamp();
  await customer.userRef.set(updateData, { merge: true });

  const updatedDoc = await customer.userRef.get();
  return {
    payload: buildProfilePayload(updatedDoc.data() || {}),
    context: customer,
  };
}

module.exports = {
  getCustomerProfile,
  updateCustomerProfile,
};
