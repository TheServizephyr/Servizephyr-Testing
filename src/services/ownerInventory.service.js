const { FieldValue } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { resolveOwnerContext, PERMISSIONS } = require('./accessControl.service');
const {
  INVENTORY_COLLECTION,
  INVENTORY_LEDGER_COLLECTION,
  RESERVED_OPEN_ITEMS_CATEGORY_ID,
  calculateAvailable,
  normalizeSearchValue,
  createInventoryPayloadFromMenuItem,
  normalizeAdjustmentReason,
  toFiniteNumber,
} = require('../utils/inventory');

const WRITE_BATCH_SIZE = 400;

function normalizeBusinessType(value, collectionName) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'street_vendor') return 'street-vendor';
  if (normalized === 'shop' || normalized === 'store') return 'store';
  if (normalized === 'street-vendor' || normalized === 'restaurant') {
    return normalized;
  }
  if (collectionName === 'shops') return 'store';
  if (collectionName === 'street_vendors') return 'street-vendor';
  return 'restaurant';
}

async function getOwnerInventory(req) {
  const owner = await resolveOwnerContext(req, {
    requiredPermissions: [PERMISSIONS.VIEW_MENU],
  });

  const limitParam = Number(req.query.limit || 50);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50;
  const cursor = String(req.query.cursor || '').trim();
  const q = normalizeSearchValue(req.query.q || '');

  const inventoryRef = owner.businessSnap.ref.collection(INVENTORY_COLLECTION);
  let inventoryQuery;

  if (q) {
    inventoryQuery = inventoryRef
      .where('searchTokens', 'array-contains', q)
      .limit(limit);
  } else {
    inventoryQuery = inventoryRef
      .orderBy('updatedAt', 'desc')
      .limit(limit);

    if (cursor) {
      const cursorDoc = await inventoryRef.doc(cursor).get();
      if (cursorDoc.exists) {
        inventoryQuery = inventoryQuery.startAfter(cursorDoc);
      }
    }
  }

  const snapshot = await inventoryQuery.get();
  const items = snapshot.docs.map((doc) => {
    const data = doc.data() || {};
    const stockOnHand = Number(data.stockOnHand || 0);
    const reserved = Number(data.reserved || 0);
    return {
      id: doc.id,
      ...data,
      stockOnHand,
      reserved,
      available: Number.isFinite(Number(data.available))
        ? Number(data.available)
        : calculateAvailable(stockOnHand, reserved),
    };
  });

  const nextCursor = !q && snapshot.size === limit && snapshot.docs.length > 0
    ? snapshot.docs[snapshot.docs.length - 1].id
    : null;

  return {
    items,
    nextCursor,
    businessId: owner.businessId,
    businessType: normalizeBusinessType(owner.businessData?.businessType, owner.collectionName),
  };
}

async function postOwnerInventoryAdjust(req, body = {}) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
    requiredPermissions: [PERMISSIONS.EDIT_MENU],
  });

  const itemId = String(body.itemId || '').trim();
  const qtyDelta = toFiniteNumber(body.qtyDelta, NaN);
  const reason = normalizeAdjustmentReason(body.reason);
  const note = String(body.note || '').trim().slice(0, 200);

  if (!itemId) {
    throw new HttpError(400, 'itemId is required.');
  }
  if (!Number.isFinite(qtyDelta) || qtyDelta === 0) {
    throw new HttpError(400, 'qtyDelta must be a non-zero number.');
  }

  const actorId = String(owner.actorUid || owner.ownerUid || '');
  const inventoryRef = owner.businessSnap.ref.collection(INVENTORY_COLLECTION).doc(itemId);
  const ledgerRef = owner.businessSnap.ref.collection(INVENTORY_LEDGER_COLLECTION).doc();

  const result = await owner.firestore.runTransaction(async (transaction) => {
    const inventorySnap = await transaction.get(inventoryRef);
    if (!inventorySnap.exists) {
      throw new HttpError(404, 'Inventory item not found. Sync items first.');
    }

    const current = inventorySnap.data() || {};
    const beforeOnHand = toFiniteNumber(current.stockOnHand, 0);
    const reserved = toFiniteNumber(current.reserved, 0);
    const afterOnHand = beforeOnHand + qtyDelta;

    if (afterOnHand < 0) {
      throw new HttpError(400, 'Adjustment would make stock negative.');
    }

    const available = calculateAvailable(afterOnHand, reserved);

    transaction.update(inventoryRef, {
      stockOnHand: afterOnHand,
      available,
      updatedAt: FieldValue.serverTimestamp(),
      lastAdjustedAt: FieldValue.serverTimestamp(),
      lastAdjustedBy: actorId,
    });

    transaction.set(ledgerRef, {
      itemId,
      sku: current.sku || null,
      name: current.name || null,
      type: reason,
      qtyDelta,
      before: {
        stockOnHand: beforeOnHand,
        reserved,
        available: toFiniteNumber(current.available, calculateAvailable(beforeOnHand, reserved)),
      },
      after: {
        stockOnHand: afterOnHand,
        reserved,
        available,
      },
      note: note || null,
      actorId,
      actorRole: owner.callerRole || 'owner',
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      itemId,
      stockOnHand: afterOnHand,
      reserved,
      available,
    };
  });

  return {
    message: 'Inventory adjusted successfully.',
    item: result,
  };
}

async function commitInChunks(firestore, writes) {
  let committed = 0;
  for (let i = 0; i < writes.length; i += WRITE_BATCH_SIZE) {
    const batch = firestore.batch();
    writes.slice(i, i + WRITE_BATCH_SIZE).forEach(({ ref, data }) => {
      batch.set(ref, data, { merge: true });
    });
    await batch.commit();
    committed += Math.min(WRITE_BATCH_SIZE, writes.length - i);
  }
  return committed;
}

async function postOwnerInventorySyncFromMenu(req) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
    requiredPermissions: [PERMISSIONS.EDIT_MENU],
  });

  const firestore = owner.businessSnap.ref.firestore;
  const menuRef = owner.businessSnap.ref.collection('menu');
  const inventoryRef = owner.businessSnap.ref.collection(INVENTORY_COLLECTION);

  const [menuSnapshot, inventorySnapshot] = await Promise.all([
    menuRef.get(),
    inventoryRef.get(),
  ]);

  const existingInventoryById = new Map(
    inventorySnapshot.docs.map((doc) => [doc.id, doc.data() || {}])
  );

  const writes = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  menuSnapshot.docs.forEach((menuDoc) => {
    const menuItem = menuDoc.data() || {};
    if (menuItem.isDeleted === true) {
      skipped += 1;
      return;
    }
    const categoryId = String(menuItem.categoryId || '').trim().toLowerCase();
    if (categoryId === RESERVED_OPEN_ITEMS_CATEGORY_ID) {
      skipped += 1;
      return;
    }

    const existingInventory = existingInventoryById.get(menuDoc.id) || null;
    const payload = createInventoryPayloadFromMenuItem(menuDoc, existingInventory);
    writes.push({ ref: inventoryRef.doc(menuDoc.id), data: payload });
    if (existingInventory) {
      updated += 1;
    } else {
      created += 1;
    }
  });

  if (writes.length > 0) {
    await commitInChunks(firestore, writes);
  }

  return {
    message: 'Inventory synced from menu successfully.',
    businessId: owner.businessId,
    collectionName: owner.collectionName,
    processed: writes.length,
    created,
    updated,
    skipped,
    menuItemsScanned: menuSnapshot.size,
  };
}

module.exports = {
  getOwnerInventory,
  postOwnerInventoryAdjust,
  postOwnerInventorySyncFromMenu,
};
