const { getAuth, getFirestore } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { verifyAndGetUid } = require('./authIdentity.service');

function resolveBusinessCollectionName(businessType) {
  const normalized = String(businessType || '').trim().toLowerCase();
  if (normalized === 'restaurant') return 'restaurants';
  if (normalized === 'shop' || normalized === 'store') return 'shops';
  if (normalized === 'street-vendor' || normalized === 'street_vendor') return 'street_vendors';
  return null;
}

async function postUserDelete(req) {
  const uid = await verifyAndGetUid(req, { checkRevoked: true });
  const firestore = await getFirestore();
  const auth = await getAuth();

  const userRef = firestore.collection('users').doc(uid);
  const userDoc = await userRef.get();

  if (!userDoc.exists) {
    try {
      await auth.deleteUser(uid);
    } catch (error) {
      if (error?.code !== 'auth/user-not-found') {
        throw new HttpError(500, `Backend Error: ${error.message}`);
      }
    }

    return {
      message: 'User authentication record deleted. Firestore document was not found.',
    };
  }

  const userData = userDoc.data() || {};
  const businessType = userData.businessType;
  const businessCollectionName = resolveBusinessCollectionName(businessType);

  const batch = firestore.batch();
  if (businessCollectionName) {
    const businessQuery = await firestore
      .collection(businessCollectionName)
      .where('ownerId', '==', uid)
      .limit(1)
      .get();

    if (!businessQuery.empty) {
      batch.delete(businessQuery.docs[0].ref);
    }
  }

  batch.delete(userRef);

  try {
    await auth.deleteUser(uid);
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') {
      throw new HttpError(500, `Backend Error: ${error.message}`);
    }
  }

  await batch.commit();

  return {
    message: 'Account permanently deleted from all systems.',
  };
}

module.exports = {
  postUserDelete,
};
