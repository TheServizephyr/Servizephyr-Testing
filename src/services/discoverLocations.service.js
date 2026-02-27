const { getFirestore } = require('../lib/firebaseAdmin');

async function fetchCollectionLocations(firestore, collectionName) {
  const snapshot = await firestore
    .collection(collectionName)
    .where('approvalStatus', '==', 'approved')
    .get();

  return snapshot.docs
    .map((doc) => {
      const data = doc.data() || {};
      const latitude = data?.address?.latitude;
      const longitude = data?.address?.longitude;
      if (typeof latitude !== 'number' || typeof longitude !== 'number') {
        return null;
      }

      const businessTypeRaw = data.businessType || collectionName.slice(0, -1);
      const businessType = businessTypeRaw === 'shop' ? 'store' : businessTypeRaw;

      return {
        id: doc.id,
        name: data.name || 'Unnamed Business',
        businessType,
        lat: latitude,
        lng: longitude,
        address: `${data?.address?.street || ''}, ${data?.address?.city || ''}`.replace(/^,\s*|\s*,\s*$/g, ''),
      };
    })
    .filter(Boolean);
}

async function getDiscoverLocations() {
  const firestore = await getFirestore();

  const [restaurants, shops] = await Promise.all([
    fetchCollectionLocations(firestore, 'restaurants'),
    fetchCollectionLocations(firestore, 'shops'),
  ]);

  return {
    locations: [...restaurants, ...shops],
  };
}

module.exports = {
  getDiscoverLocations,
};
