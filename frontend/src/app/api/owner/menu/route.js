

import { NextResponse } from 'next/server';
import { getAuth, getFirestore, FieldValue, verifyAndGetUid } from '@/lib/firebase-admin';
import { logImpersonation, getClientIP, getUserAgent, isSessionExpired } from '@/lib/audit-logger';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';
import { kv } from '@vercel/kv';
import { verifyEmployeeAccess } from '@/lib/verify-employee-access';
import { logAuditEvent, AUDIT_ACTIONS, createPriceChangeMetadata } from '@/lib/security/audit-log';
import { menuPriceLimiter, menuDeleteLimiter } from '@/lib/security/rate-limiter';
import { validatePriceChange, extractPortions } from '@/lib/security/validation-helpers';
import { normalizeMenuItemImageUrl } from '@/lib/server/menu-image-storage';
import { trackEndpointRead } from '@/lib/readTelemetry';
import { trackApiTelemetry } from '@/lib/opsTelemetry';

// --- 1. SINGLE ITEM AVAILABILITY UPDATE ---
// (Logic moved inside methods below)
const RESERVED_OPEN_ITEMS_CATEGORY_ID = 'open-items';

function normalizeCompactPortions(item = {}) {
    if (Array.isArray(item?.portions) && item.portions.length > 0) {
        return item.portions.map((portion) => ({
            name: String(portion?.name || 'Regular'),
            price: Number(portion?.price ?? item?.price ?? 0) || 0,
        }));
    }

    const fallbackPrice = Number(item?.price ?? 0);
    return [{ name: 'Regular', price: Number.isFinite(fallbackPrice) ? fallbackPrice : 0 }];
}

const MENU_RESPONSE_CACHE_TTL_MS = 30 * 1000;
const getOwnerMenuResponseCache = () => {
    if (!globalThis.__ownerMenuResponseCache) {
        globalThis.__ownerMenuResponseCache = new Map();
    }
    return globalThis.__ownerMenuResponseCache;
};

export async function GET(req) {
    const telemetryStartedAt = Date.now();
    let telemetryStatus = 200;
    let telemetryError = null;
    const respond = (payload, status = 200, headers = undefined) => {
        telemetryStatus = status;
        return NextResponse.json(payload, {
            status,
            ...(headers ? { headers } : {}),
        });
    };

    try {
        const firestore = await getFirestore();
        const { businessId, businessSnap, collectionName } = await verifyOwnerWithAudit(req, 'view_menu');
        const requestUrl = new URL(req.url);
        const versionOnly = ['1', 'true', 'yes'].includes(String(requestUrl.searchParams.get('versionOnly') || '').toLowerCase());
        const compactMode = ['1', 'true', 'yes'].includes(String(requestUrl.searchParams.get('compact') || '').toLowerCase());
        const dashboardMode = ['1', 'true', 'yes'].includes(String(requestUrl.searchParams.get('dashboard') || '').toLowerCase());
        const includeOpenItems = ['1', 'true', 'yes'].includes(String(requestUrl.searchParams.get('includeOpenItems') || '').toLowerCase());


        // (Audit logging handled by verifyOwnerWithAudit internally for impersonation)

        const businessData = businessSnap.data();
        const menuVersion = Number(businessData?.menuVersion || 0);
        if (versionOnly) {
            return respond({ businessId, menuVersion }, 200);
        }
        const compactCacheKey = compactMode
            ? `${collectionName}:${businessId}:v${menuVersion}:compact:${includeOpenItems ? 1 : 0}`
            : null;
        if (compactCacheKey) {
            const cache = getOwnerMenuResponseCache();
            const cached = cache.get(compactCacheKey);
            if (cached && (Date.now() - cached.ts) < MENU_RESPONSE_CACHE_TTL_MS) {
                return respond(cached.payload, 200, { 'x-owner-menu-cache': 'hit' });
            }
        }

        const menuRef = firestore.collection(collectionName).doc(businessId).collection('menu');
        let menuQuery = menuRef.orderBy('order', 'asc');
        if (compactMode) {
            menuQuery = menuQuery.select(
                'name',
                'categoryId',
                'isVeg',
                'isAvailable',
                'portions',
                'price',
                'order',
                'isDeleted'
            );
        } else if (dashboardMode) {
            menuQuery = menuQuery.select(
                'name',
                'description',
                'categoryId',
                'isVeg',
                'isAvailable',
                'portions',
                'price',
                'order',
                'isDeleted',
                'imageUrl',
                'tags',
                'addOnGroups'
            );
        }
        const menuSnap = await menuQuery.get();
        // ✅ SOFT-DELETE: Filter items in JS to avoid index dependency
        const activeDocs = menuSnap.docs.filter(doc => doc.data().isDeleted !== true);


        let menuData = {};
        let customCategories = [];
        const openItems = includeOpenItems ? (businessData?.openItems || []) : undefined;
        if (!compactMode) {
            // FETCH CUSTOM CATEGORIES FROM SUB-COLLECTION
            const customCatSnap = await firestore.collection(collectionName).doc(businessId).collection('custom_categories').orderBy('order', 'asc').get();
            customCategories = customCatSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            await trackEndpointRead('api.owner.menu.get', 1 + (menuSnap?.size || 0) + (customCatSnap?.size || 0));
        } else {
            await trackEndpointRead('api.owner.menu.get', 1 + (menuSnap?.size || 0));
        }

        const businessTypeRaw = businessData.businessType || (collectionName === 'restaurants' ? 'restaurant' : (collectionName === 'shops' ? 'store' : 'street-vendor'));
        const businessType = businessTypeRaw === 'shop' ? 'store' : businessTypeRaw;
        console.log(`[API LOG] GET /api/owner/menu: Determined businessType as '${businessType}'.`);

        if (!compactMode) {
            const restaurantCategoryConfig = {
                "starters": { title: "Starters" }, "main-course": { title: "Main Course" }, "beverages": { title: "Beverages" },
                "desserts": { title: "Desserts" }, "soup": { title: "Soup" }, "tandoori-item": { title: "Tandoori Items" },
                "momos": { title: "Momos" }, "burgers": { title: "Burgers" }, "rolls": { title: "Rolls" },
                "tandoori-khajana": { title: "Tandoori Khajana" }, "rice": { title: "Rice" }, "noodles": { title: "Noodles" },
                "pasta": { title: "Pasta" }, "raita": { title: "Raita" },
                'snacks': { title: 'Snacks' }, 'chaat': { title: 'Chaat' }, 'sweets': { title: 'Sweets' },
            };
            const shopCategoryConfig = {
                "electronics": { title: "Electronics" }, "groceries": { title: "Groceries" }, "clothing": { title: "Clothing" },
                "books": { title: "Books" }, "home-appliances": { title: "Home Appliances" }, "toys-games": { title: "Toys & Games" },
                "beauty-personal-care": { title: "Beauty & Personal Care" }, "sports-outdoors": { title: "Sports & Outdoors" },
            };

            const allCategories = { ...(businessType === 'restaurant' || businessType === 'street-vendor' ? restaurantCategoryConfig : shopCategoryConfig) };
            customCategories.forEach(cat => {
                if (!allCategories[cat.id]) {
                    allCategories[cat.id] = { title: cat.title };
                }
            });

            const allCategoryKeys = Object.keys(allCategories);

            allCategoryKeys.forEach(key => {
                menuData[key] = [];
            });
        }

        activeDocs.forEach(doc => {
            const item = doc.data();
            const categoryKey = item.categoryId || 'general';
            if (String(categoryKey).toLowerCase() === RESERVED_OPEN_ITEMS_CATEGORY_ID) {
                return;
            }
            if (!menuData[categoryKey]) {
                menuData[categoryKey] = [];
            }
            if (compactMode) {
                menuData[categoryKey].push({
                    id: doc.id,
                    name: String(item?.name || 'Unnamed Item'),
                    categoryId: categoryKey,
                    isVeg: !!item?.isVeg,
                    isAvailable: item?.isAvailable !== false,
                    portions: normalizeCompactPortions(item),
                });
            } else {
                menuData[categoryKey].push({ id: doc.id, ...item });
            }
        });

        console.log("[API LOG] GET /api/owner/menu: Successfully processed menu data. Responding to client.");
        const payload = {
            menu: menuData,
            customCategories: customCategories,
            businessType: businessType,
            restaurantId: businessId,
            menuVersion,
            compact: compactMode,
            dashboard: dashboardMode,
            ...(includeOpenItems ? { openItems } : {}),
        };

        if (compactCacheKey) {
            const cache = getOwnerMenuResponseCache();
            cache.set(compactCacheKey, { ts: Date.now(), payload });
        }

        return respond(payload, 200);

    } catch (error) {
        telemetryStatus = error?.status || 500;
        telemetryError = error?.message || 'Owner menu GET failed';
        console.error("[API LOG] CRITICAL ERROR in GET /api/owner/menu:", error);
        return respond({ message: `Backend Error: ${error.message}` }, telemetryStatus);
    } finally {
        void trackApiTelemetry({
            endpoint: 'api.owner.menu.get',
            durationMs: Date.now() - telemetryStartedAt,
            statusCode: telemetryStatus,
            errorMessage: telemetryError,
        });
    }
}


export async function POST(req) {
    try {
        const firestore = await getFirestore();


        const { businessId, collectionName, uid, callerRole } = await verifyOwnerWithAudit(req, 'manage_menu_post', {}, true);
        const userRole = callerRole; // Use the actual role of the caller (owner/manager/etc)
        console.log(`[API LOG] POST /api/owner/menu: Owner verified for business ID: ${businessId} in collection ${collectionName}. Caller role: ${userRole}`);

        // 🔐 RBAC: Only Owner and Manager can create/edit items
        if (!['owner', 'manager'].includes(userRole)) {
            return NextResponse.json({ message: 'Access Denied: Your role does not have permission to manage menu items.' }, { status: 403 });
        }

        const { item, categoryId, newCategory, isEditing } = await req.json();
        console.log("[API LOG] POST /api/owner/menu: Request body parsed:", { isEditing, categoryId, newCategory: !!newCategory });

        if (!item || !item.name || !item.portions || item.portions.length === 0) {
            console.error("[API ERROR] POST /api/owner/menu: Validation Failed: Missing required item data.");
            return NextResponse.json({ message: 'Missing required item data. Name and at least one portion are required.' }, { status: 400 });
        }

        const batch = firestore.batch();
        const menuRef = firestore.collection(collectionName).doc(businessId).collection('menu');

        let finalCategoryId = categoryId;

        if (newCategory && newCategory.trim() !== '') {
            console.log(`[API LOG] POST /api/owner/menu: New category detected: "${newCategory}"`);
            const formattedId = newCategory.trim().toLowerCase().replace(/\s+/g, '-');
            finalCategoryId = formattedId;

            // Check sub-collection
            const customCatRef = firestore.collection(collectionName).doc(businessId).collection('custom_categories').doc(formattedId);
            const customCatSnap = await customCatRef.get();

            if (!customCatSnap.exists) {
                console.log(`[API LOG] POST /api/owner/menu: Category "${formattedId}" does not exist. Adding to batch.`);

                // Get max order
                const allCats = await firestore.collection(collectionName).doc(businessId).collection('custom_categories').orderBy('order', 'desc').limit(1).get();
                const maxOrder = allCats.empty ? 0 : (allCats.docs[0].data().order || 0);

                batch.set(customCatRef, {
                    id: formattedId,
                    title: newCategory.trim(),
                    order: maxOrder + 1,
                    createdAt: FieldValue.serverTimestamp()
                });
            } else {
                console.log(`[API LOG] POST /api/owner/menu: Category "${formattedId}" already exists.`);
            }
        }

        const normalizedFinalCategoryId = String(finalCategoryId || '').trim().toLowerCase();
        if (!normalizedFinalCategoryId) {
            return NextResponse.json({ message: 'Category is required.' }, { status: 400 });
        }
        if (normalizedFinalCategoryId === RESERVED_OPEN_ITEMS_CATEGORY_ID) {
            return NextResponse.json(
                { message: 'Category "open-items" is reserved for manual billing and cannot be used in menu.' },
                { status: 400 }
            );
        }
        finalCategoryId = normalizedFinalCategoryId;

        const normalizedImageUrl = await normalizeMenuItemImageUrl(item.imageUrl || '', businessId, item.id || item.name);

        const finalItem = {
            ...item,
            imageUrl: normalizedImageUrl,
            categoryId: finalCategoryId,
            portions: item.portions || [],
            isAvailable: item.isAvailable === undefined ? true : item.isAvailable,
        };

        let newItemId = item.id;

        if (isEditing) {
            console.log(`[API LOG] POST /api/owner/menu: Editing item ID: ${item.id}. Adding update to batch.`);
            if (!item.id) {
                console.error("[API ERROR] POST /api/owner/menu: Edit failed: No item ID provided.");
                return NextResponse.json({ message: 'Item ID is required for editing.' }, { status: 400 });
            }

            // Fetch old item to detect price changes
            const itemRef = menuRef.doc(item.id);
            const oldItemSnap = await itemRef.get();

            if (oldItemSnap.exists) {
                const oldItem = oldItemSnap.data();

                // Check if price changed (compare portions)
                const oldPrices = (oldItem.portions || []).map(p => ({ name: p.name, price: p.price }));
                const newPrices = (finalItem.portions || []).map(p => ({ name: p.name, price: p.price }));

                // Simple price change detection (if any portion price differs)
                const priceChanged = JSON.stringify(oldPrices) !== JSON.stringify(newPrices);

                if (priceChanged) {
                    // 🔒 Rate limit check (20 price updates per minute)
                    const rateLimitCheck = menuPriceLimiter.check(uid, businessId);
                    if (!rateLimitCheck.allowed) {
                        logAuditEvent({
                            actorUid: uid,
                            actorRole: userRole,
                            action: AUDIT_ACTIONS.RATE_LIMIT_VIOLATION,
                            targetUid: null,
                            outletId: businessId,
                            metadata: {
                                endpoint: 'menu_price_update',
                                limit: '20/min',
                                retryAfter: rateLimitCheck.retryAfter
                            },
                            source: 'rate_limiter',
                            req
                        }).catch(err => console.error('[AUDIT_LOG_FAILED]', err));

                        return NextResponse.json({
                            message: `Too many price updates. Please wait ${rateLimitCheck.retryAfter} seconds.`
                        }, { status: 429 });
                    }

                    // 🛡️ Validate price change (prevent extreme increases)
                    const validation = validatePriceChange(
                        extractPortions(oldItem),
                        extractPortions(finalItem),
                        finalItem.name
                    );

                    if (!validation.valid) {
                        return NextResponse.json({
                            message: validation.error
                        }, { status: 400 });
                    }

                    // 🔐 Manager Specific: Block >50% increase (1.5x)
                    if (userRole === 'manager') {
                        for (let i = 0; i < finalItem.portions.length; i++) {
                            const newP = finalItem.portions[i];
                            const oldP = (oldItem.portions || []).find(p => p.name === newP.name);
                            if (oldP && oldP.price > 0) {
                                const ratio = newP.price / oldP.price;
                                if (ratio > 1.5) {
                                    return NextResponse.json({
                                        message: `Price increase too large for manager (${Math.round((ratio - 1) * 100)}%). Increases over 50% require owner approval.`
                                    }, { status: 403 });
                                }
                            }
                        }
                    }

                    // Log warning if present (large decrease)
                    if (validation.warning) {
                        console.warn('[MENU API] Price Change Warning:', validation.warning);
                    }

                    // 🔍 Audit log: MENU_PRICE_UPDATE (fire-and-forget)
                    logAuditEvent({
                        actorUid: uid,
                        actorRole: userRole,
                        action: AUDIT_ACTIONS.MENU_PRICE_UPDATE,
                        targetUid: null,
                        outletId: businessId,
                        metadata: {
                            itemId: item.id,
                            itemName: finalItem.name || oldItem.name,
                            categoryId: finalItem.categoryId || oldItem.categoryId,
                            oldPrices,
                            newPrices,
                            changedAt: new Date().toISOString()
                        },
                        source: 'menu_api',
                        req
                    }).catch(err => console.error('[AUDIT_LOG_FAILED]', err));
                }
            }

            const { id, createdAt, ...updateData } = finalItem;
            batch.update(itemRef, updateData);
        } else {
            console.log(`[API LOG] POST /api/owner/menu: Creating new item in category: ${finalCategoryId}.`);
            const categoryQuerySnap = await menuRef.where('categoryId', '==', finalCategoryId).orderBy('order', 'desc').limit(1).get();
            const maxOrder = categoryQuerySnap.empty ? 0 : (categoryQuerySnap.docs[0].data().order || 0);
            console.log(`[API LOG] POST /api/owner/menu: Max order in category is ${maxOrder}. New order will be ${maxOrder + 1}.`);

            const newItemRef = menuRef.doc();
            newItemId = newItemRef.id;

            batch.set(newItemRef, {
                ...finalItem,
                id: newItemId,
                order: maxOrder + 1,
                createdAt: FieldValue.serverTimestamp(),
            });
            console.log(`[API LOG] POST /api/owner/menu: New item with ID ${newItemId} added to batch:`, JSON.stringify({ ...finalItem, id: newItemId, order: maxOrder + 1 }));
        }

        await batch.commit();


        // Increment menuVersion for automatic cache invalidation
        console.log(`[Menu API] 🔄 Incrementing menuVersion for businessId: ${businessId}`);
        try {
            const businessRef = firestore.collection(collectionName).doc(businessId);
            await businessRef.update({
                menuVersion: FieldValue.increment(1)
            });
            console.log(`[Menu API] ✅ menuVersion incremented for ${businessId}`);
        } catch (versionError) {
            console.error('[Menu API] ❌ menuVersion increment failed:', versionError);
            // Non-fatal - menu save succeeded, just cache won't auto-invalidate
        }

        // (Audit logging handled by verifyOwnerWithAudit internally for impersonation)

        const message = isEditing ? 'Item updated successfully!' : 'Item added successfully!';
        const status = isEditing ? 200 : 201;

        return NextResponse.json({ message, id: newItemId }, { status });

    } catch (error) {
        console.error("[API LOG] CRITICAL ERROR in POST /api/owner/menu:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


export async function DELETE(req) {
    console.log("[API LOG] DELETE /api/owner/menu: Request received.");
    try {
        const firestore = await getFirestore();
        const { businessId, collectionName, callerRole } = await verifyOwnerWithAudit(req, 'delete_menu_item', {}, true);
        const userRole = callerRole;

        // 🔐 RBAC: Only Owner can delete menu items
        if (userRole !== 'owner') {
            return NextResponse.json({ message: 'Access Denied: Only owners can delete menu items.' }, { status: 403 });
        }
        const { itemId } = await req.json();

        if (!itemId) {
            console.error("[API ERROR] DELETE /api/owner/menu: Item ID is required.");
            return NextResponse.json({ message: 'Item ID is required.' }, { status: 400 });
        }

        console.log(`[API LOG] DELETE /api/owner/menu: Soft-deleting item ${itemId} from ${collectionName}/${businessId}/menu.`);
        const itemRef = firestore.collection(collectionName).doc(businessId).collection('menu').doc(itemId);
        // ✅ HARD-DELETE: Physically remove document as per user request
        await itemRef.delete();
        console.log(`[API LOG] DELETE /api/owner/menu: Item soft-deleted successfully.`);

        // Increment menuVersion for automatic cache invalidation
        try {
            const businessRef = firestore.collection(collectionName).doc(businessId);
            await businessRef.update({
                menuVersion: FieldValue.increment(1)
            });
            console.log(`[Menu API] ✅ menuVersion incremented for ${businessId}`);
        } catch (versionError) {
            console.error('[Menu API] ❌ menuVersion increment failed:', versionError);
        }

        // (Audit logging handled by verifyOwnerWithAudit internally for impersonation)

        return NextResponse.json({ message: 'Item deleted successfully.' }, { status: 200 });
    } catch (error) {
        console.error("[API LOG] CRITICAL ERROR in DELETE /api/owner/menu:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


export async function PATCH(req) {
    console.log("[API LOG] PATCH /api/owner/menu: Request received.");
    try {
        const firestore = await getFirestore();
        const { businessId, collectionName, callerRole, uid } = await verifyOwnerWithAudit(req, 'update_menu_patch', {}, true);
        const userRole = callerRole;
        const { itemIds, action, updates } = await req.json();
        console.log("[API LOG] PATCH /api/owner/menu: Body:", { itemIds, action, updates, userRole });

        const menuRef = firestore.collection(collectionName).doc(businessId).collection('menu');

        // --- 0. CATEGORY IMAGE UPDATE (Store categories) ---
        if (updates && updates.categoryId && Object.prototype.hasOwnProperty.call(updates, 'imageUrl')) {
            if (!['owner', 'manager'].includes(userRole)) {
                return NextResponse.json({ message: 'Access Denied: Your role cannot update category image.' }, { status: 403 });
            }

            const normalizedCategoryId = String(updates.categoryId || '').trim().toLowerCase();
            if (!normalizedCategoryId) {
                return NextResponse.json({ message: 'Category ID is required.' }, { status: 400 });
            }
            if (normalizedCategoryId === RESERVED_OPEN_ITEMS_CATEGORY_ID) {
                return NextResponse.json({ message: 'Open items category image cannot be changed here.' }, { status: 400 });
            }

            const imageUrl = String(updates.imageUrl || '').trim();
            const categoryTitleFromInput = String(updates.categoryTitle || '').trim();
            const fallbackTitle = normalizedCategoryId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            const customCategoryRef = firestore
                .collection(collectionName)
                .doc(businessId)
                .collection('custom_categories')
                .doc(normalizedCategoryId);

            const existingCategorySnap = await customCategoryRef.get();
            if (existingCategorySnap.exists) {
                const updatePayload = {
                    updatedAt: FieldValue.serverTimestamp(),
                };
                if (categoryTitleFromInput) {
                    updatePayload.title = categoryTitleFromInput;
                }
                if (imageUrl) {
                    updatePayload.imageUrl = imageUrl;
                } else {
                    updatePayload.imageUrl = FieldValue.delete();
                }
                await customCategoryRef.update(updatePayload);
            } else {
                const latestCustomCategory = await firestore
                    .collection(collectionName)
                    .doc(businessId)
                    .collection('custom_categories')
                    .orderBy('order', 'desc')
                    .limit(1)
                    .get();
                const maxOrder = latestCustomCategory.empty ? 0 : Number(latestCustomCategory.docs[0].data().order || 0);
                const createPayload = {
                    id: normalizedCategoryId,
                    title: categoryTitleFromInput || fallbackTitle,
                    order: maxOrder + 1,
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                };
                if (imageUrl) {
                    createPayload.imageUrl = imageUrl;
                }
                await customCategoryRef.set(createPayload, { merge: true });
            }

            try {
                const businessRef = firestore.collection(collectionName).doc(businessId);
                await businessRef.update({ menuVersion: FieldValue.increment(1) });
            } catch (versionError) {
                console.error('[Menu API] menuVersion increment failed after category image update:', versionError);
            }

            return NextResponse.json({
                message: imageUrl ? 'Category image updated successfully.' : 'Category image removed successfully.',
            }, { status: 200 });
        }

        // --- 1. SINGLE ITEM AVAILABILITY UPDATE ---
        if (updates && updates.id) {
            // 🔐 RBAC: Owner, Manager, Chef can toggle availability
            if (!['owner', 'manager', 'chef'].includes(userRole)) {
                return NextResponse.json({ message: 'Access Denied: Your role cannot update item availability.' }, { status: 403 });
            }

            console.log(`[API LOG] PATCH /api/owner/menu: Single item availability update for ${updates.id}.`);
            const itemRef = menuRef.doc(updates.id);
            await itemRef.update({ isAvailable: updates.isAvailable });
            console.log(`[API LOG] PATCH /api/owner/menu: Item ${updates.id} updated.`);
            return NextResponse.json({ message: 'Item availability updated.' }, { status: 200 });
        }

        // --- 2. BULK ACTIONS ---
        if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0 || !action) {
            console.error("[API ERROR] PATCH /api/owner/menu: Item IDs array and action are required for bulk updates.");
            return NextResponse.json({ message: 'Item IDs array and action are required for bulk updates.' }, { status: 400 });
        }

        // 🔐 RBAC: Only Owner can bulk delete
        if (action === 'delete' && userRole !== 'owner') {
            return NextResponse.json({ message: 'Access Denied: Only owners can delete menu items.' }, { status: 403 });
        }

        // 🔐 RBAC: Owner, Manager, Chef can mark items as out of stock
        if (action === 'outOfStock' && !['owner', 'manager', 'chef'].includes(userRole)) {
            return NextResponse.json({ message: 'Access Denied: Your role cannot update item availability.' }, { status: 403 });
        }

        console.log(`[API LOG] PATCH /api/owner/menu: Performing bulk action '${action}' on ${itemIds.length} items.`);
        const batch = firestore.batch();

        // For delete action, fetch item details first for audit log
        const itemsToDelete = [];
        if (action === 'delete') {
            // 🔒 Rate limit check (10 deletes per minute)
            const rateLimitCheck = menuDeleteLimiter.check(uid, businessId);
            if (!rateLimitCheck.allowed) {
                logAuditEvent({
                    actorUid: uid,
                    actorRole: userRole,
                    action: AUDIT_ACTIONS.RATE_LIMIT_VIOLATION,
                    targetUid: null,
                    outletId: businessId,
                    metadata: {
                        endpoint: 'menu_delete',
                        limit: '10/min',
                        retryAfter: rateLimitCheck.retryAfter,
                        itemCount: itemIds.length
                    },
                    source: 'rate_limiter',
                    req
                }).catch(err => console.error('[AUDIT_LOG_FAILED]', err));

                return NextResponse.json({
                    message: `Too many menu deletions. Please wait ${rateLimitCheck.retryAfter} seconds.`
                }, { status: 429 });
            }

            for (const itemId of itemIds) {
                const itemRef = menuRef.doc(itemId);
                const itemSnap = await itemRef.get();
                if (itemSnap.exists) {
                    const itemData = itemSnap.data();
                    itemsToDelete.push({
                        id: itemId,
                        name: itemData.name,
                        categoryId: itemData.categoryId,
                        portions: itemData.portions || []
                    });
                }
            }
        }

        itemIds.forEach(itemId => {
            const itemRef = menuRef.doc(itemId);
            if (action === 'delete') {
                // ✅ HARD-DELETE: Physically remove document as per user request
                batch.delete(itemRef);
            } else if (action === 'outOfStock') {
                batch.update(itemRef, { isAvailable: false });
            }
        });

        await batch.commit();

        // 🔍 Audit log: MENU_ITEM_DELETE (only for delete action, fire-and-forget)
        if (action === 'delete' && itemsToDelete.length > 0) {
            for (const item of itemsToDelete) {
                logAuditEvent({
                    actorUid: uid,
                    actorRole: userRole,
                    action: AUDIT_ACTIONS.MENU_ITEM_DELETE,
                    targetUid: null,
                    outletId: businessId,
                    metadata: {
                        itemId: item.id,
                        itemName: item.name,
                        categoryId: item.categoryId,
                        portions: item.portions,
                        deletedAt: new Date().toISOString()
                    },
                    source: 'menu_api',
                    req
                }).catch(err => console.error('[AUDIT_LOG_FAILED]', err));
            }
        }

        console.log(`[API LOG] PATCH /api/owner/menu: Bulk action completed.`);

        // Increment menuVersion for automatic cache invalidation
        try {
            const businessRef = firestore.collection(collectionName).doc(businessId);
            await businessRef.update({
                menuVersion: FieldValue.increment(1)
            });
            console.log(`[Menu API] ✅ menuVersion incremented for ${businessId}`);
        } catch (versionError) {
            console.error('[Menu API] ❌ menuVersion increment failed:', versionError);
        }

        return NextResponse.json({ message: `Bulk action '${action}' completed successfully on ${itemIds.length} items.` }, { status: 200 });

    } catch (error) {
        console.error("[API LOG] CRITICAL ERROR in PATCH /api/owner/menu:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
