const { resolveOwnerContext } = require('./accessControl.service');

async function getOwnerConnections(req) {
  const owner = await resolveOwnerContext(req, { checkRevoked: false });
  const firestore = owner.firestore;
  const ownerId = owner.ownerUid;

  const [restaurantsQuery, shopsQuery, vendorsQuery] = await Promise.all([
    firestore
      .collection('restaurants')
      .where('ownerId', '==', ownerId)
      .where('botPhoneNumberId', '!=', null)
      .get(),
    firestore
      .collection('shops')
      .where('ownerId', '==', ownerId)
      .where('botPhoneNumberId', '!=', null)
      .get(),
    firestore
      .collection('street_vendors')
      .where('ownerId', '==', ownerId)
      .where('botPhoneNumberId', '!=', null)
      .get(),
  ]);

  const mapConnection = (doc) => {
    const data = doc.data() || {};
    return {
      id: doc.id,
      restaurantName: data.name,
      whatsAppNumber: data.botPhoneNumberId,
      status: data.botStatus || 'Connected',
    };
  };

  return {
    connections: [
      ...restaurantsQuery.docs.map(mapConnection),
      ...shopsQuery.docs.map(mapConnection),
      ...vendorsQuery.docs.map(mapConnection),
    ],
  };
}

module.exports = {
  getOwnerConnections,
};
