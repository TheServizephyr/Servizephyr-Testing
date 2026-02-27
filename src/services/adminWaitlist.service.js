const { resolveAdminContext } = require('./adminAccess.service');

function toIso(value) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function getAdminWaitlist(req) {
  const { firestore } = await resolveAdminContext(req, { checkRevoked: false });
  let waitlistSnap;
  try {
    waitlistSnap = await firestore
      .collection('waitlist_entries')
      .orderBy('createdAt', 'desc')
      .get();
  } catch {
    waitlistSnap = await firestore.collection('waitlist_entries').get();
  }

  const entries = waitlistSnap.docs
    .map((doc) => {
      const data = doc.data() || {};
      return {
        id: doc.id,
        name: data.name || 'N/A',
        phone: data.phone || data.phoneNumber || 'N/A',
        email: data.email || '',
        businessName: data.businessName || data.restaurantName || 'N/A',
        address: data.address || 'N/A',
        createdAt: toIso(data.createdAt) || new Date().toISOString(),
      };
    })
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

  return { entries };
}

module.exports = {
  getAdminWaitlist,
};
