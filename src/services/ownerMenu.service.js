const { getCache, setCache } = require('../lib/cache');
const { FieldValue } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { normalizeBusinessType } = require('./business.service');
const { resolveOwnerContext, PERMISSIONS } = require('./accessControl.service');

const RESERVED_OPEN_ITEMS_CATEGORY_ID = 'open-items';
const OWNER_MENU_CACHE_TTL_SEC = 43200; // 12 hours — cache key includes menuVersion so writes auto-bust it

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function normalizeCompactPortions(item = {}) {
  if (Array.isArray(item.portions) && item.portions.length > 0) {
    return item.portions.map((portion) => ({
      name: String(portion?.name || 'Regular'),
      price: Number(portion?.price ?? item?.price ?? 0) || 0,
    }));
  }
  const fallback = Number(item?.price ?? 0);
  return [{ name: 'Regular', price: Number.isFinite(fallback) ? fallback : 0 }];
}

function baseCategoriesForBusinessType(businessType) {
  if (businessType === 'store') {
    return [
      'electronics',
      'groceries',
      'clothing',
      'books',
      'home-appliances',
      'toys-games',
      'beauty-personal-care',
      'sports-outdoors',
    ];
  }
  return [
    'starters',
    'main-course',
    'beverages',
    'desserts',
    'soup',
    'tandoori-item',
    'momos',
    'burgers',
    'rolls',
    'rice',
    'noodles',
    'pasta',
    'raita',
    'snacks',
    'chaat',
    'sweets',
  ];
}

function normalizeCategoryId(value) {
  const safe = String(value || '').trim().toLowerCase();
  return safe || 'general';
}

function slugifyCategory(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
}

function ensureRoleIn(owner, allowedRoles, message) {
  if (owner.isAdminImpersonation) return;
  if (allowedRoles.has(String(owner.callerRole || '').toLowerCase())) return;
  throw new HttpError(403, message || 'Access denied.');
}

async function incrementMenuVersion(owner) {
  await owner.firestore
    .collection(owner.collectionName)
    .doc(owner.businessId)
    .update({
      menuVersion: FieldValue.increment(1),
      updatedAt: new Date(),
    })
    .catch(() => null);
}

async function ensureCustomCategory({
  owner,
  batch,
  categoryId,
  categoryTitle,
}) {
  const customCategoryRef = owner.firestore
    .collection(owner.collectionName)
    .doc(owner.businessId)
    .collection('custom_categories')
    .doc(categoryId);

  const customCategorySnap = await customCategoryRef.get();
  if (customCategorySnap.exists) return customCategoryRef;

  let highestOrder = 0;
  try {
    const latestSnap = await owner.firestore
      .collection(owner.collectionName)
      .doc(owner.businessId)
      .collection('custom_categories')
      .orderBy('order', 'desc')
      .limit(1)
      .get();
    if (!latestSnap.empty) {
      highestOrder = Number(latestSnap.docs[0].data()?.order || 0);
    }
  } catch {
    const fallback = await owner.firestore
      .collection(owner.collectionName)
      .doc(owner.businessId)
      .collection('custom_categories')
      .get();
    highestOrder = fallback.docs.reduce((max, doc) => {
      const order = Number(doc.data()?.order || 0);
      return order > max ? order : max;
    }, 0);
  }

  batch.set(customCategoryRef, {
    id: categoryId,
    title: categoryTitle || categoryId,
    order: highestOrder + 1,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return customCategoryRef;
}

function buildMenuPayload({
  docs = [],
  compactMode = false,
  businessType = 'restaurant',
  customCategories = [],
}) {
  const grouped = {};
  const knownCategoryIds = new Set();

  baseCategoriesForBusinessType(businessType).forEach((categoryId) => {
    grouped[categoryId] = [];
    knownCategoryIds.add(categoryId);
  });

  customCategories.forEach((category) => {
    const id = normalizeCategoryId(category?.id || category?.title);
    if (!grouped[id]) grouped[id] = [];
    knownCategoryIds.add(id);
  });

  docs.forEach((doc) => {
    const data = doc.data() || {};
    if (data.isDeleted === true) return;

    const categoryId = normalizeCategoryId(data.categoryId);
    if (categoryId === RESERVED_OPEN_ITEMS_CATEGORY_ID) return;
    if (!grouped[categoryId]) {
      grouped[categoryId] = [];
      knownCategoryIds.add(categoryId);
    }

    if (compactMode) {
      grouped[categoryId].push({
        id: doc.id,
        name: String(data.name || 'Unnamed Item'),
        categoryId,
        isVeg: !!data.isVeg,
        isAvailable: data.isAvailable !== false,
        portions: normalizeCompactPortions(data),
      });
      return;
    }

    grouped[categoryId].push({
      id: doc.id,
      ...data,
    });
  });

  if (!compactMode) {
    // Keep output deterministic for frontend diffing.
    Object.keys(grouped).forEach((categoryId) => {
      grouped[categoryId] = grouped[categoryId].sort((a, b) => {
        const ao = Number(a.order || 0);
        const bo = Number(b.order || 0);
        return ao - bo;
      });
    });
  }

  return grouped;
}

async function getOwnerMenu(req) {
  const owner = await resolveOwnerContext(req, {
    requiredPermissions: [PERMISSIONS.VIEW_MENU],
  });

  const firestore = owner.firestore;
  const businessId = owner.businessId;
  const collectionName = owner.collectionName;
  const businessData = owner.businessData || {};

  const compactMode = isTruthy(req.query.compact);
  const dashboardMode = isTruthy(req.query.dashboard);
  const includeOpenItems = isTruthy(req.query.includeOpenItems);
  const versionOnly = isTruthy(req.query.versionOnly);

  const menuVersion = Number(businessData.menuVersion || 0);
  if (versionOnly) {
    return {
      payload: {
        businessId,
        menuVersion,
      },
      cacheStatus: 'SKIP',
      context: owner,
    };
  }

  const cacheKey = [
    'owner_menu',
    collectionName,
    businessId,
    `v${menuVersion}`,
    compactMode ? 'compact' : 'full',
    dashboardMode ? 'dashboard' : 'normal',
    includeOpenItems ? 'open' : 'closed',
  ].join(':');

  const cacheHit = await getCache(cacheKey);
  if (cacheHit.hit && cacheHit.value) {
    return {
      payload: cacheHit.value,
      cacheStatus: cacheHit.source === 'memory' ? 'L1-HIT' : 'HIT',
      context: owner,
    };
  }

  const menuRef = firestore.collection(collectionName).doc(businessId).collection('menu');
  let menuSnap;
  try {
    menuSnap = await menuRef.orderBy('order', 'asc').get();
  } catch {
    // Fallback when `order` index/field is missing in some legacy docs.
    menuSnap = await menuRef.get();
  }

  const customCategoryRef = firestore.collection(collectionName).doc(businessId).collection('custom_categories');
  let customCategorySnap;
  try {
    customCategorySnap = await customCategoryRef.orderBy('order', 'asc').get();
  } catch {
    customCategorySnap = await customCategoryRef.get();
  }
  const customCategories = customCategorySnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));

  const businessType = normalizeBusinessType(
    businessData.businessType,
    collectionName
  );

  const menu = buildMenuPayload({
    docs: menuSnap.docs,
    compactMode,
    businessType,
    customCategories,
  });

  const payload = {
    menu,
    customCategories,
    businessType,
    restaurantId: businessId,
    menuVersion,
    compact: compactMode,
    dashboard: dashboardMode,
  };

  if (includeOpenItems) {
    payload.openItems = Array.isArray(businessData.openItems) ? businessData.openItems : [];
  }

  await setCache(cacheKey, payload, OWNER_MENU_CACHE_TTL_SEC);
  return {
    payload,
    cacheStatus: 'MISS',
    context: owner,
  };
}

async function updateOwnerMenuItemAvailability(req) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
    requiredPermissions: [PERMISSIONS.EDIT_MENU, PERMISSIONS.TOGGLE_ITEM_STOCK],
  });

  ensureRoleIn(
    owner,
    new Set(['owner', 'street-vendor', 'manager', 'chef']),
    'Access denied: your role cannot update item availability.'
  );

  const updates = req.body?.updates;
  if (!updates || typeof updates !== 'object') {
    throw new HttpError(400, 'Missing updates payload.');
  }
  const itemId = String(updates.id || '').trim();
  if (!itemId) {
    throw new HttpError(400, 'Item ID is required.');
  }
  if (typeof updates.isAvailable !== 'boolean') {
    throw new HttpError(400, 'isAvailable must be true or false.');
  }

  await owner.firestore
    .collection(owner.collectionName)
    .doc(owner.businessId)
    .collection('menu')
    .doc(itemId)
    .update({
      isAvailable: updates.isAvailable,
      updatedAt: new Date(),
    });

  await incrementMenuVersion(owner);

  return {
    payload: { message: 'Item availability updated.' },
    context: owner,
  };
}

function resolveFinalCategory(body = {}) {
  const newCategory = String(body.newCategory || '').trim();
  if (newCategory) {
    return {
      categoryId: slugifyCategory(newCategory),
      categoryTitle: newCategory,
      fromNewCategory: true,
    };
  }
  return {
    categoryId: normalizeCategoryId(body.categoryId),
    categoryTitle: '',
    fromNewCategory: false,
  };
}

function sanitizePortions(portions, fallbackPrice) {
  if (!Array.isArray(portions) || portions.length === 0) return [];
  return portions.map((portion) => ({
    name: String(portion?.name || 'Regular').trim() || 'Regular',
    price: Number(portion?.price ?? fallbackPrice ?? 0) || 0,
  }));
}

async function resolveMaxOrderInCategory(menuRef, categoryId) {
  try {
    const snap = await menuRef.where('categoryId', '==', categoryId).orderBy('order', 'desc').limit(1).get();
    if (snap.empty) return 0;
    return Number(snap.docs[0].data()?.order || 0);
  } catch {
    const fallback = await menuRef.where('categoryId', '==', categoryId).get();
    return fallback.docs.reduce((max, doc) => {
      const order = Number(doc.data()?.order || 0);
      return order > max ? order : max;
    }, 0);
  }
}

async function createOrUpdateOwnerMenuItem(req) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
    requiredPermissions: [PERMISSIONS.EDIT_MENU],
  });

  ensureRoleIn(
    owner,
    new Set(['owner', 'street-vendor', 'manager']),
    'Access denied: your role cannot manage menu items.'
  );

  const body = req.body || {};
  const item = body.item && typeof body.item === 'object' ? body.item : null;
  const isEditing = body.isEditing === true;
  if (!item || !String(item.name || '').trim()) {
    throw new HttpError(400, 'Item name is required.');
  }

  const portions = sanitizePortions(item.portions, item.price);
  if (!portions.length) {
    throw new HttpError(400, 'At least one portion is required.');
  }

  const categoryData = resolveFinalCategory(body);
  if (!categoryData.categoryId) {
    throw new HttpError(400, 'Category is required.');
  }
  if (categoryData.categoryId === RESERVED_OPEN_ITEMS_CATEGORY_ID) {
    throw new HttpError(400, 'Category "open-items" is reserved and cannot be used in menu.');
  }

  const menuRef = owner.firestore.collection(owner.collectionName).doc(owner.businessId).collection('menu');
  const batch = owner.firestore.batch();

  if (categoryData.fromNewCategory) {
    await ensureCustomCategory({
      owner,
      batch,
      categoryId: categoryData.categoryId,
      categoryTitle: categoryData.categoryTitle,
    });
  }

  const finalItem = {
    ...item,
    name: String(item.name || '').trim(),
    categoryId: categoryData.categoryId,
    portions,
    imageUrl: String(item.imageUrl || '').trim(),
    isAvailable: item.isAvailable === false ? false : true,
  };

  let itemId = '';
  let statusCode = 201;
  let message = 'Item added successfully.';

  if (isEditing) {
    itemId = String(item.id || '').trim();
    if (!itemId) throw new HttpError(400, 'Item ID is required for editing.');

    const itemRef = menuRef.doc(itemId);
    const { id, createdAt, ...updateData } = finalItem;
    batch.update(itemRef, {
      ...updateData,
      updatedAt: new Date(),
    });
    statusCode = 200;
    message = 'Item updated successfully.';
  } else {
    const newItemRef = menuRef.doc();
    itemId = newItemRef.id;
    const maxOrder = await resolveMaxOrderInCategory(menuRef, categoryData.categoryId);
    batch.set(newItemRef, {
      ...finalItem,
      id: itemId,
      order: maxOrder + 1,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
  await incrementMenuVersion(owner);

  return {
    payload: {
      message,
      id: itemId,
    },
    statusCode,
    context: owner,
  };
}

async function deleteOwnerMenuItem(req) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
    requiredPermissions: [PERMISSIONS.EDIT_MENU],
  });

  ensureRoleIn(
    owner,
    new Set(['owner', 'street-vendor']),
    'Access denied: only owners can delete menu items.'
  );

  const itemId = String(req.body?.itemId || '').trim();
  if (!itemId) {
    throw new HttpError(400, 'Item ID is required.');
  }

  await owner.firestore
    .collection(owner.collectionName)
    .doc(owner.businessId)
    .collection('menu')
    .doc(itemId)
    .delete();

  await incrementMenuVersion(owner);

  return {
    payload: { message: 'Item deleted successfully.' },
    context: owner,
  };
}

function supportsNativeOwnerMenuPatch(body = {}) {
  const updates = body.updates && typeof body.updates === 'object' ? body.updates : null;
  if (updates && updates.id) return true;
  if (updates && updates.categoryId && Object.prototype.hasOwnProperty.call(updates, 'imageUrl')) return true;

  const action = String(body.action || '').trim().toLowerCase();
  if (!action) return false;
  return ['delete', 'outofstock', 'instock'].includes(action);
}

async function patchOwnerMenu(req) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
    requiredPermissions: [PERMISSIONS.EDIT_MENU, PERMISSIONS.TOGGLE_ITEM_STOCK],
  });

  const body = req.body || {};
  const updates = body.updates && typeof body.updates === 'object' ? body.updates : null;
  const menuRef = owner.firestore.collection(owner.collectionName).doc(owner.businessId).collection('menu');

  if (updates && updates.categoryId && Object.prototype.hasOwnProperty.call(updates, 'imageUrl')) {
    ensureRoleIn(
      owner,
      new Set(['owner', 'street-vendor', 'manager']),
      'Access denied: your role cannot update category images.'
    );

    const categoryId = normalizeCategoryId(updates.categoryId);
    if (!categoryId) throw new HttpError(400, 'Category ID is required.');
    if (categoryId === RESERVED_OPEN_ITEMS_CATEGORY_ID) {
      throw new HttpError(400, 'Open-items category image cannot be updated here.');
    }

    const categoryTitle = String(updates.categoryTitle || '').trim();
    const imageUrl = String(updates.imageUrl || '').trim();
    const customCategoryRef = owner.firestore
      .collection(owner.collectionName)
      .doc(owner.businessId)
      .collection('custom_categories')
      .doc(categoryId);

    const existingCategorySnap = await customCategoryRef.get();
    if (existingCategorySnap.exists) {
      const updateData = {
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (categoryTitle) updateData.title = categoryTitle;
      if (imageUrl) updateData.imageUrl = imageUrl;
      else updateData.imageUrl = FieldValue.delete();
      await customCategoryRef.update(updateData);
    } else {
      let highestOrder = 0;
      try {
        const latestSnap = await owner.firestore
          .collection(owner.collectionName)
          .doc(owner.businessId)
          .collection('custom_categories')
          .orderBy('order', 'desc')
          .limit(1)
          .get();
        if (!latestSnap.empty) {
          highestOrder = Number(latestSnap.docs[0].data()?.order || 0);
        }
      } catch {
        const fallback = await owner.firestore
          .collection(owner.collectionName)
          .doc(owner.businessId)
          .collection('custom_categories')
          .get();
        highestOrder = fallback.docs.reduce((max, doc) => {
          const order = Number(doc.data()?.order || 0);
          return order > max ? order : max;
        }, 0);
      }

      await customCategoryRef.set(
        {
          id: categoryId,
          title: categoryTitle || categoryId.replace(/-/g, ' '),
          order: highestOrder + 1,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          ...(imageUrl ? { imageUrl } : {}),
        },
        { merge: true }
      );
    }

    await incrementMenuVersion(owner);

    return {
      payload: {
        message: imageUrl
          ? 'Category image updated successfully.'
          : 'Category image removed successfully.',
      },
      context: owner,
    };
  }

  if (updates && updates.id) {
    const result = await updateOwnerMenuItemAvailability(req);
    return result;
  }

  const itemIds = Array.isArray(body.itemIds) ? body.itemIds : [];
  const safeItemIds = Array.from(new Set(itemIds.map((value) => String(value || '').trim()).filter(Boolean)));
  const action = String(body.action || '').trim().toLowerCase();

  if (!safeItemIds.length || !action) {
    throw new HttpError(400, 'Item IDs array and action are required for bulk updates.');
  }

  if (action === 'delete') {
    ensureRoleIn(
      owner,
      new Set(['owner', 'street-vendor']),
      'Access denied: only owners can delete menu items.'
    );
  } else if (action === 'outofstock' || action === 'instock') {
    ensureRoleIn(
      owner,
      new Set(['owner', 'street-vendor', 'manager', 'chef']),
      'Access denied: your role cannot update item availability.'
    );
  } else {
    throw new HttpError(400, `Unsupported action "${action}".`);
  }

  const batch = owner.firestore.batch();
  safeItemIds.forEach((itemId) => {
    const itemRef = menuRef.doc(itemId);
    if (action === 'delete') {
      batch.delete(itemRef);
    } else {
      batch.update(itemRef, {
        isAvailable: action === 'instock',
        updatedAt: new Date(),
      });
    }
  });

  await batch.commit();
  await incrementMenuVersion(owner);

  return {
    payload: {
      message: `Bulk action "${action}" completed successfully on ${safeItemIds.length} items.`,
    },
    context: owner,
  };
}

module.exports = {
  getOwnerMenu,
  updateOwnerMenuItemAvailability,
  createOrUpdateOwnerMenuItem,
  deleteOwnerMenuItem,
  supportsNativeOwnerMenuPatch,
  patchOwnerMenu,
};
