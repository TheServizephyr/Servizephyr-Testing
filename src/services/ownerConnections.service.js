const { resolveOwnerContext } = require('./accessControl.service');

async function getOwnerConnections(req) {
  const owner = await resolveOwnerContext(req, { checkRevoked: false });
  const firestore = owner.firestore;
  const ownerId = owner.ownerUid;

  const mapConnection = (doc) => {
    const data = doc.data() || {};
    return {
      id: doc.id,
      restaurantName: data.name,
      whatsAppNumber: data.botPhoneNumberId,
      status: data.botStatus || 'Connected',
    };
  };

  const fetchCollection = async (collectionName) => {
    try {
      const snap = await firestore
        .collection(collectionName)
        .where('ownerId', '==', ownerId)
        .get();
      // Filter in JS to avoid needing a composite index for `!= null`
      return snap.docs
        .filter((doc) => doc.data()?.botPhoneNumberId != null)
        .map(mapConnection);
    } catch (err) {
      console.warn(`[getOwnerConnections] Failed to fetch ${collectionName}:`, err.message);
      return [];
    }
  };

  const [restaurants, shops, vendors] = await Promise.all([
    fetchCollection('restaurants'),
    fetchCollection('shops'),
    fetchCollection('street_vendors'),
  ]);

  return {
    connections: [...restaurants, ...shops, ...vendors],
  };
}

module.exports = {
  getOwnerConnections,
};
