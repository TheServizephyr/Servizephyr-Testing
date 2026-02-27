const { FieldValue } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { resolveOwnerContext, PERMISSIONS } = require('./accessControl.service');

function normalizeOpenItems(items) {
  return Array.isArray(items) ? items : [];
}

async function getOwnerOpenItems(req) {
  const owner = await resolveOwnerContext(req, {
    requiredPermissions: [PERMISSIONS.MANUAL_BILLING_READ],
  });

  return {
    items: normalizeOpenItems(owner.businessData?.openItems),
  };
}

async function postOwnerOpenItem(req, body = {}) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
    requiredPermissions: [PERMISSIONS.MANUAL_BILLING_WRITE],
  });

  const name = String(body.name || '').trim();
  const itemPrice = Number(body.price);
  if (!name) {
    throw new HttpError(400, 'Item name is required');
  }
  if (!Number.isFinite(itemPrice) || itemPrice <= 0) {
    throw new HttpError(400, 'Price must be a positive number');
  }

  const businessRef = owner.businessSnap.ref;
  const payload = await owner.firestore.runTransaction(async (tx) => {
    const businessSnap = await tx.get(businessRef);
    if (!businessSnap.exists) {
      throw new HttpError(404, 'Business not found');
    }

    const existingItems = normalizeOpenItems(businessSnap.data()?.openItems);
    const normalizedName = name.toLowerCase();
    const duplicate = existingItems.find((item) => {
      const existingName = String(item?.name || '').trim().toLowerCase();
      const existingPrice = Number(item?.price || 0);
      return existingName === normalizedName && existingPrice === itemPrice;
    });

    if (duplicate) {
      return {
        item: duplicate,
        duplicate: true,
      };
    }

    const newItem = {
      id: `open-item-${Date.now()}`,
      name,
      price: itemPrice,
      createdAt: new Date(),
    };

    tx.update(businessRef, {
      openItems: FieldValue.arrayUnion(newItem),
      menuVersion: FieldValue.increment(1),
    });

    return {
      item: newItem,
      duplicate: false,
    };
  });

  return {
    ...payload,
    statusCode: payload.duplicate ? 200 : 201,
  };
}

async function deleteOwnerOpenItem(req, body = {}) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
    requiredPermissions: [PERMISSIONS.MANUAL_BILLING_WRITE],
  });

  const itemId = String(body.itemId || '').trim();
  if (!itemId) {
    throw new HttpError(400, 'Item ID is required');
  }

  const businessRef = owner.businessSnap.ref;
  const businessSnap = await businessRef.get();
  if (!businessSnap.exists) {
    throw new HttpError(404, 'Business not found');
  }

  const openItems = normalizeOpenItems(businessSnap.data()?.openItems);
  const itemToDelete = openItems.find((item) => item?.id === itemId);
  if (!itemToDelete) {
    throw new HttpError(404, 'Item not found');
  }

  await businessRef.update({
    openItems: FieldValue.arrayRemove(itemToDelete),
    menuVersion: FieldValue.increment(1),
  });

  return { success: true };
}

module.exports = {
  getOwnerOpenItems,
  postOwnerOpenItem,
  deleteOwnerOpenItem,
};
