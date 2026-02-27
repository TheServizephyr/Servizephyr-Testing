const { FieldValue } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { normalizeBusinessType } = require('./business.service');
const { resolveOwnerContext, PERMISSIONS, hasPermission } = require('./accessControl.service');

const RESERVED_OPEN_ITEMS_CATEGORY_ID = 'open-items';

const RESTAURANT_CATEGORY_CONFIG = {
  starters: true,
  'main-course': true,
  beverages: true,
  desserts: true,
  soup: true,
  'tandoori-item': true,
  momos: true,
  burgers: true,
  rolls: true,
  'tandoori-khajana': true,
  rice: true,
  noodles: true,
  pasta: true,
  raita: true,
  snacks: true,
  chaat: true,
  sweets: true,
};

const SHOP_CATEGORY_CONFIG = {
  electronics: true,
  groceries: true,
  clothing: true,
  books: true,
  'home-appliances': true,
  'toys-games': true,
  'beauty-personal-care': true,
  'sports-outdoors': true,
};

function normalizeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toNumber(value, fallback = 0) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : fallback;
}

function canBulkManageMenu(owner) {
  if (owner.isAdminImpersonation) return true;
  if (hasPermission(owner, PERMISSIONS.EDIT_MENU)) return true;
  return false;
}

function validateMenuItem(item) {
  if (!item || typeof item !== 'object') return "Invalid menu item payload.";
  if (!item.name || typeof item.name !== 'string') return "Missing or invalid 'name'.";
  if (!item.categoryId || typeof item.categoryId !== 'string') {
    return `Missing 'categoryId' for item: ${item.name || 'unknown'}`;
  }

  const categoryId = normalizeSlug(item.categoryId);
  if (!categoryId) return `Invalid 'categoryId' for item: ${item.name || 'unknown'}`;
  if (categoryId === RESERVED_OPEN_ITEMS_CATEGORY_ID) {
    return `Category '${RESERVED_OPEN_ITEMS_CATEGORY_ID}' is reserved and not allowed in bulk upload.`;
  }

  if (!Array.isArray(item.portions) || item.portions.length === 0) {
    return `Missing or empty 'portions' array for item: ${item.name}`;
  }

  for (const portion of item.portions) {
    if (!portion?.name || typeof portion.name !== 'string') {
      return `Invalid portion name for item: ${item.name}`;
    }
    if (typeof portion.price !== 'number' || portion.price < 0) {
      return `Invalid portion price for item: ${item.name}`;
    }
  }

  return null;
}

async function createOwnerMenuBulk(req) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
    allowEmployee: true,
    allowAdminImpersonation: true,
    requiredPermissions: [PERMISSIONS.EDIT_MENU],
  });

  if (!canBulkManageMenu(owner)) {
    throw new HttpError(403, 'Access denied: insufficient privileges for bulk menu upload.');
  }

  const items = req.body?.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, 'Request body must include a non-empty items array.');
  }

  const businessData = owner.businessData || {};
  const businessType = normalizeBusinessType(businessData.businessType, owner.collectionName);
  const businessRef = owner.businessSnap.ref;
  const menuRef = businessRef.collection('menu');

  const hardcodedCategories = businessType === 'street-vendor'
    ? {}
    : (
      businessType === 'store'
        ? SHOP_CATEGORY_CONFIG
        : RESTAURANT_CATEGORY_CONFIG
    );

  const existingCustomCategoriesSnap = await businessRef.collection('custom_categories').get();
  const existingCustomCategoryMap = {};
  const allCategories = { ...hardcodedCategories };

  existingCustomCategoriesSnap.forEach((doc) => {
    const data = doc.data() || {};
    const categoryId = String(data.id || doc.id || '').trim();
    if (!categoryId) return;
    existingCustomCategoryMap[categoryId] = data;
    allCategories[categoryId] = {
      title: data.title,
      order: data.order,
    };
  });

  const categoryMetadataMap = {};
  items.forEach((rawItem) => {
    const categoryId = normalizeSlug(rawItem?.categoryId);
    if (!categoryId || categoryId === RESERVED_OPEN_ITEMS_CATEGORY_ID) return;
    const existing = categoryMetadataMap[categoryId] || {};
    const categoryTitle = String(rawItem?.categoryTitle || '').trim();
    const categoryImageUrl = String(rawItem?.categoryImageUrl || '').trim();
    const superCategoryTitle = String(rawItem?.superCategoryTitle || '').trim();
    const superCategoryId = normalizeSlug(rawItem?.superCategoryId || superCategoryTitle);
    categoryMetadataMap[categoryId] = {
      title: categoryTitle || existing.title || '',
      imageUrl: categoryImageUrl || existing.imageUrl || '',
      superCategoryId: superCategoryId || existing.superCategoryId || '',
      superCategoryTitle: superCategoryTitle || existing.superCategoryTitle || '',
    };
  });

  let maxOrder = 0;
  existingCustomCategoriesSnap.forEach((doc) => {
    const order = toNumber(doc.data()?.order, 0);
    if (order > maxOrder) maxOrder = order;
  });

  const batch = owner.firestore.batch();
  const uniqueCategories = new Set(
    items.map((item) => normalizeSlug(item?.categoryId)).filter(Boolean)
  );
  const newCategoriesToAdd = [];

  uniqueCategories.forEach((categoryId) => {
    if (!categoryId || categoryId === RESERVED_OPEN_ITEMS_CATEGORY_ID) return;

    const existingCustom = existingCustomCategoryMap[categoryId];
    const metadata = categoryMetadataMap[categoryId] || {};
    const hasMetadata = Boolean(
      metadata.title || metadata.imageUrl || metadata.superCategoryId || metadata.superCategoryTitle
    );
    const defaultTitle = categoryId.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
    const resolvedTitle = metadata.title || existingCustom?.title || defaultTitle;
    const categoryRef = businessRef.collection('custom_categories').doc(categoryId);

    const shouldCreateCategory = !existingCustom && (!allCategories[categoryId] || hasMetadata);
    if (shouldCreateCategory) {
      maxOrder += 1;
      const payload = {
        id: categoryId,
        title: resolvedTitle,
        order: maxOrder,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (metadata.imageUrl) payload.imageUrl = metadata.imageUrl;
      if (metadata.superCategoryId) payload.superCategoryId = metadata.superCategoryId;
      if (metadata.superCategoryTitle) payload.superCategoryTitle = metadata.superCategoryTitle;
      batch.set(categoryRef, payload, { merge: true });
      newCategoriesToAdd.push(categoryId);
      allCategories[categoryId] = { title: resolvedTitle, order: maxOrder };
      return;
    }

    if (existingCustom && hasMetadata) {
      const updatePayload = {
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (metadata.title) updatePayload.title = metadata.title;
      if (metadata.imageUrl) updatePayload.imageUrl = metadata.imageUrl;
      if (metadata.superCategoryId) updatePayload.superCategoryId = metadata.superCategoryId;
      if (metadata.superCategoryTitle) updatePayload.superCategoryTitle = metadata.superCategoryTitle;
      batch.set(categoryRef, updatePayload, { merge: true });
    }
  });

  let totalItemsAdded = 0;
  for (const item of items) {
    const validationError = validateMenuItem(item);
    if (validationError) {
      throw new HttpError(400, `Validation failed: ${validationError}`);
    }

    const normalizedCategoryId = normalizeSlug(item.categoryId);
    const {
      categoryTitle,
      categoryImageUrl,
      superCategoryId,
      superCategoryTitle,
      ...rest
    } = item || {};

    const docRef = menuRef.doc();
    const basePayload = { ...rest };
    delete basePayload.id;
    delete basePayload.categoryId;
    delete basePayload.createdAt;
    delete basePayload.updatedAt;

    batch.set(docRef, {
      ...basePayload,
      id: docRef.id,
      name: String(rest.name || '').trim(),
      categoryId: normalizedCategoryId,
      portions: Array.isArray(rest.portions) ? rest.portions : [],
      isVeg: typeof rest.isVeg === 'boolean' ? rest.isVeg : true,
      isAvailable: rest.isAvailable !== false,
      order: toNumber(rest.order, 999),
      imageUrl: String(rest.imageUrl || ''),
      tags: Array.isArray(rest.tags) ? rest.tags : [],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    totalItemsAdded += 1;
  }

  await batch.commit();

  await businessRef.update({
    menuVersion: FieldValue.increment(1),
    updatedAt: new Date(),
  }).catch(() => null);

  return {
    message: `Successfully added ${totalItemsAdded} items to your menu!`,
    categoriesAdded: newCategoriesToAdd.length,
  };
}

module.exports = {
  createOwnerMenuBulk,
};
