const { FieldValue } = require('../lib/firebaseAdmin');
const { resolveAdminContext } = require('./adminAccess.service');

const BUSINESS_COLLECTIONS = ['restaurants', 'shops', 'street_vendors'];

function generateDisplayId(prefix, timestamp) {
  let date = new Date();
  if (timestamp) {
    if (typeof timestamp?.toDate === 'function') {
      date = timestamp.toDate();
    } else if (typeof timestamp?.seconds === 'number') {
      date = new Date(timestamp.seconds * 1000);
    } else {
      const parsed = new Date(timestamp);
      if (!Number.isNaN(parsed.getTime())) {
        date = parsed;
      }
    }
  }

  const yy = String(date.getFullYear()).slice(-2);
  const MM = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const HH = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const rr = Math.floor(10 + Math.random() * 90).toString();
  return `${prefix}${yy}${MM}${dd}${HH}${mm}${rr}`;
}

async function commitSetChunks({ firestore, writes, chunkSize = 350 }) {
  if (!Array.isArray(writes) || writes.length === 0) return 0;
  let committed = 0;

  for (let i = 0; i < writes.length; i += chunkSize) {
    const chunk = writes.slice(i, i + chunkSize);
    const batch = firestore.batch();
    for (const write of chunk) {
      batch.set(write.ref, write.data, write.options || { merge: true });
    }
    await batch.commit();
    committed += chunk.length;
  }

  return committed;
}

async function getAdminMigrationDisplayIds(req) {
  const { firestore } = await resolveAdminContext(req, { checkRevoked: true });

  const writeStats = {
    users: 0,
    restaurants: 0,
    shops: 0,
    vendors: 0,
  };

  const usersSnap = await firestore.collection('users').get();
  const userWrites = usersSnap.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      ref: doc.ref,
      data: {
        customerId: generateDisplayId('CS_', data.createdAt || data.created_at),
      },
    };
  });
  writeStats.users = await commitSetChunks({ firestore, writes: userWrites });

  const restaurantsSnap = await firestore.collection('restaurants').get();
  const restaurantWrites = restaurantsSnap.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      ref: doc.ref,
      data: {
        merchantId: generateDisplayId('RS_', data.createdAt || data.created_at),
      },
    };
  });
  writeStats.restaurants = await commitSetChunks({ firestore, writes: restaurantWrites });

  const shopsSnap = await firestore.collection('shops').get();
  const shopWrites = shopsSnap.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      ref: doc.ref,
      data: {
        merchantId: generateDisplayId('RS_', data.createdAt || data.created_at),
      },
    };
  });
  writeStats.shops = await commitSetChunks({ firestore, writes: shopWrites });

  const vendorsSnap = await firestore.collection('street_vendors').get();
  const vendorWrites = vendorsSnap.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      ref: doc.ref,
      data: {
        merchantId: generateDisplayId('RS_', data.createdAt || data.created_at),
      },
    };
  });
  writeStats.vendors = await commitSetChunks({ firestore, writes: vendorWrites });

  return {
    message: 'Migration Complete',
    stats: writeStats,
  };
}

async function postAdminMigrateDeliverySettings(req) {
  const { firestore } = await resolveAdminContext(req, { checkRevoked: true });

  const results = {
    migrated: 0,
    errors: [],
  };

  for (const collectionName of BUSINESS_COLLECTIONS) {
    const snapshot = await firestore.collection(collectionName).get();
    for (const doc of snapshot.docs) {
      try {
        const data = doc.data() || {};
        const deliverySettings = {
          deliveryEnabled: data.deliveryEnabled ?? true,
          deliveryRadius: data.deliveryRadius ?? 5,
          deliveryFeeType: data.deliveryFeeType ?? 'fixed',
          deliveryFixedFee: data.deliveryFixedFee ?? 30,
          deliveryPerKmFee: data.deliveryPerKmFee ?? 5,
          deliveryFreeThreshold: data.deliveryFreeThreshold ?? 500,
          deliveryOnlinePaymentEnabled: data.deliveryOnlinePaymentEnabled ?? true,
          deliveryCodEnabled: data.deliveryCodEnabled ?? true,
          migratedAt: new Date(),
        };

        await doc.ref.collection('delivery_settings').doc('config').set(deliverySettings, { merge: true });
        await doc.ref.set(
          {
            menuVersion: FieldValue.increment(1),
            updatedAt: new Date(),
          },
          { merge: true }
        );
        results.migrated += 1;
      } catch (error) {
        results.errors.push(`${collectionName}/${doc.id}: ${error.message}`);
      }
    }
  }

  return {
    success: true,
    message: 'Delivery settings migration started',
    details: results,
  };
}

async function postAdminCleanupDeliverySettings(req) {
  const { firestore } = await resolveAdminContext(req, { checkRevoked: true });

  const results = {
    cleaned: 0,
    checked: 0,
    errors: [],
  };

  for (const collectionName of BUSINESS_COLLECTIONS) {
    const snapshot = await firestore.collection(collectionName).get();
    for (const doc of snapshot.docs) {
      results.checked += 1;
      const data = doc.data() || {};

      if (data.deliveryFeeType === undefined && data.deliveryRadius === undefined) {
        continue;
      }

      try {
        const configRef = doc.ref.collection('delivery_settings').doc('config');
        const configSnap = await configRef.get();
        if (!configSnap.exists) {
          results.errors.push(`Skipped ${collectionName}/${doc.id}: Sub-collection missing`);
          continue;
        }

        await doc.ref.update({
          deliveryEnabled: FieldValue.delete(),
          deliveryRadius: FieldValue.delete(),
          deliveryFeeType: FieldValue.delete(),
          deliveryFixedFee: FieldValue.delete(),
          deliveryPerKmFee: FieldValue.delete(),
          deliveryFreeThreshold: FieldValue.delete(),
          deliveryOnlinePaymentEnabled: FieldValue.delete(),
          deliveryCodEnabled: FieldValue.delete(),
          menuVersion: FieldValue.increment(1),
          updatedAt: new Date(),
        });

        results.cleaned += 1;
      } catch (error) {
        results.errors.push(`${collectionName}/${doc.id}: ${error.message}`);
      }
    }
  }

  return {
    success: true,
    message: 'Delivery settings cleanup completed',
    details: results,
  };
}

async function postAdminMigrateCustomCategories(req) {
  const { firestore } = await resolveAdminContext(req, { checkRevoked: true });

  const results = {
    processed: 0,
    migrated_items: 0,
    errors: [],
  };

  for (const collectionName of BUSINESS_COLLECTIONS) {
    const snapshot = await firestore.collection(collectionName).get();
    for (const doc of snapshot.docs) {
      results.processed += 1;
      const data = doc.data() || {};
      const customCategories = Array.isArray(data.customCategories) ? data.customCategories : [];
      if (customCategories.length === 0) continue;

      const batch = firestore.batch();
      let order = 1;
      let itemCount = 0;

      for (const cat of customCategories) {
        if (!cat?.id || !cat?.title) continue;
        const newDocRef = doc.ref.collection('custom_categories').doc(String(cat.id));
        batch.set(
          newDocRef,
          {
            id: String(cat.id),
            title: String(cat.title),
            order,
            migratedAt: new Date(),
          },
          { merge: true }
        );
        order += 1;
        itemCount += 1;
      }

      if (itemCount === 0) continue;
      batch.set(
        doc.ref,
        {
          menuVersion: FieldValue.increment(1),
          updatedAt: new Date(),
        },
        { merge: true }
      );

      try {
        await batch.commit();
        results.migrated_items += itemCount;
      } catch (error) {
        results.errors.push(`${collectionName}/${doc.id}: ${error.message}`);
      }
    }
  }

  return {
    success: true,
    message: 'Custom Categories migration completed',
    details: results,
  };
}

async function postAdminCleanupCustomCategories(req) {
  const { firestore } = await resolveAdminContext(req, { checkRevoked: true });

  const results = {
    cleaned: 0,
    checked: 0,
    errors: [],
  };

  for (const collectionName of BUSINESS_COLLECTIONS) {
    const snapshot = await firestore.collection(collectionName).get();
    for (const doc of snapshot.docs) {
      results.checked += 1;
      const data = doc.data() || {};
      if (data.customCategories === undefined) continue;

      try {
        const subColSnap = await doc.ref.collection('custom_categories').limit(1).get();
        const customCategories = Array.isArray(data.customCategories) ? data.customCategories : [];
        if (!subColSnap.empty || customCategories.length === 0) {
          await doc.ref.update({
            customCategories: FieldValue.delete(),
            menuVersion: FieldValue.increment(1),
            updatedAt: new Date(),
          });
          results.cleaned += 1;
        } else {
          results.errors.push(`Skipped ${collectionName}/${doc.id}: Sub-collection empty but array has data`);
        }
      } catch (error) {
        results.errors.push(`${collectionName}/${doc.id}: ${error.message}`);
      }
    }
  }

  return {
    success: true,
    message: 'Custom Categories cleanup completed',
    details: results,
  };
}

module.exports = {
  getAdminMigrationDisplayIds,
  postAdminMigrateDeliverySettings,
  postAdminCleanupDeliverySettings,
  postAdminMigrateCustomCategories,
  postAdminCleanupCustomCategories,
};
