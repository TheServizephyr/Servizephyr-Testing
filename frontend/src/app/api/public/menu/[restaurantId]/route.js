
import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { kv } from '@vercel/kv';
import { getEffectiveBusinessOpenStatus } from '@/lib/businessSchedule';
import { trackEndpointRead } from '@/lib/readTelemetry';
import { trackApiTelemetry } from '@/lib/opsTelemetry';
import { findBusinessById } from '@/services/business/businessService';

export const dynamic = 'force-dynamic';
// Removed revalidate=0 to allow CDN caching aligned with Cache-Control headers below
const RESERVED_OPEN_ITEMS_CATEGORY_ID = 'open-items';
const BUSINESS_COLLECTION_CACHE_TTL_SECONDS = 60 * 60; // 1 hour
const MENU_MEMORY_CACHE_TTL_MS = 30 * 1000;
const MENU_MEMORY_CACHE_MAX_ENTRIES = 200;
const isMenuApiDebugEnabled = process.env.DEBUG_MENU_API === 'true';
const debugLog = (...args) => {
    if (isMenuApiDebugEnabled) {
        console.log(...args);
    }
};

function getMenuMemoryCacheStore() {
    if (!globalThis.__menuApiL1Cache) {
        globalThis.__menuApiL1Cache = new Map();
    }
    return globalThis.__menuApiL1Cache;
}

function readMenuFromMemoryCache(cacheKey) {
    const store = getMenuMemoryCacheStore();
    const entry = store.get(cacheKey);
    if (!entry) return null;
    if (!entry.expiresAt || entry.expiresAt < Date.now()) {
        store.delete(cacheKey);
        return null;
    }
    return entry.value || null;
}

function writeMenuToMemoryCache(cacheKey, value) {
    if (!cacheKey || !value) return;
    const store = getMenuMemoryCacheStore();
    if (store.size >= MENU_MEMORY_CACHE_MAX_ENTRIES) {
        const oldestKey = store.keys().next().value;
        if (oldestKey) store.delete(oldestKey);
    }
    store.set(cacheKey, {
        value,
        expiresAt: Date.now() + MENU_MEMORY_CACHE_TTL_MS,
    });
}

function normalizeMenuSource(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    return raw.replace(/[^a-z0-9_-]/g, '').slice(0, 32);
}

function decodeUrlComponentRecursively(value, maxPasses = 3) {
    let normalized = String(value || '').trim();
    for (let i = 0; i < maxPasses; i += 1) {
        try {
            const decoded = decodeURIComponent(normalized);
            if (!decoded || decoded === normalized) break;
            normalized = decoded;
        } catch {
            break;
        }
    }
    return normalized;
}

function buildRestaurantIdCandidates(value) {
    const seed = String(value || '').trim();
    if (!seed) return [];

    const candidates = [];
    const seen = new Set();
    const add = (candidate) => {
        const normalized = String(candidate || '').trim();
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        candidates.push(normalized);
    };

    add(seed);

    let decoded = seed;
    for (let i = 0; i < 2; i += 1) {
        try {
            const next = decodeURIComponent(decoded);
            if (!next || next === decoded) break;
            add(next);
            decoded = next;
        } catch {
            break;
        }
    }

    for (const candidate of [...candidates]) {
        try {
            const encoded = encodeURIComponent(candidate);
            if (encoded !== candidate) add(encoded);
        } catch {
            // Keep existing candidates
        }
    }

    return candidates;
}

async function resolveBusinessWithCollectionCache({ firestore, restaurantId, isKvAvailable }) {
    const collectionsToTry = ['restaurants', 'street_vendors', 'shops'];
    const cacheKey = `business_collection:${restaurantId}`;

    if (isKvAvailable) {
        try {
            const cachedCollection = await kv.get(cacheKey);
            if (cachedCollection && collectionsToTry.includes(cachedCollection)) {
                const cachedDocRef = firestore.collection(cachedCollection).doc(restaurantId);
                const cachedDocSnap = await cachedDocRef.get();
                if (cachedDocSnap.exists) {
                    return {
                        winner: {
                            collectionName: cachedCollection,
                            businessRef: cachedDocRef,
                            businessData: cachedDocSnap.data(),
                            version: cachedDocSnap.data().menuVersion || 1
                        },
                        foundDocs: [{
                            collectionName: cachedCollection,
                            businessRef: cachedDocRef,
                            businessData: cachedDocSnap.data(),
                            version: cachedDocSnap.data().menuVersion || 1
                        }],
                        usedCollectionCache: true
                    };
                }
            }
        } catch (cacheErr) {
            console.warn(`[Menu API] Collection cache read failed for ${restaurantId}:`, cacheErr?.message || cacheErr);
        }
    }

    const results = await Promise.all(
        collectionsToTry.map(async (name) => {
            const docRef = firestore.collection(name).doc(restaurantId);
            const docSnap = await docRef.get();
            return { name, docRef, docSnap };
        })
    );

    const foundDocs = results
        .filter(r => r.docSnap.exists)
        .map(r => ({
            collectionName: r.name,
            businessRef: r.docRef,
            businessData: r.docSnap.data(),
            version: r.docSnap.data().menuVersion || 1
        }));

    if (foundDocs.length === 0) {
        return { winner: null, foundDocs: [], usedCollectionCache: false };
    }

    foundDocs.sort((a, b) => b.version - a.version);
    const winner = foundDocs[0];

    if (isKvAvailable) {
        try {
            await kv.set(cacheKey, winner.collectionName, { ex: BUSINESS_COLLECTION_CACHE_TTL_SECONDS });
        } catch (cacheErr) {
            console.warn(`[Menu API] Collection cache write failed for ${restaurantId}:`, cacheErr?.message || cacheErr);
        }
    }

    return { winner, foundDocs, usedCollectionCache: false };
}

async function resolveBusinessAcrossCandidates({ firestore, restaurantIds, isKvAvailable }) {
    for (const candidateRestaurantId of restaurantIds) {
        const resolved = await resolveBusinessWithCollectionCache({
            firestore,
            restaurantId: candidateRestaurantId,
            isKvAvailable,
        });
        if (resolved?.winner) {
            return {
                ...resolved,
                resolvedRestaurantId: candidateRestaurantId,
            };
        }
    }

    return {
        winner: null,
        foundDocs: [],
        usedCollectionCache: false,
        resolvedRestaurantId: restaurantIds[0] || null,
    };
}

export async function GET(req, { params }) {
    const telemetryStartedAt = Date.now();
    let telemetryStatus = 200;
    let telemetryError = null;

    const requestedRestaurantId = String(params?.restaurantId || '').trim();
    const canonicalRestaurantId = decodeUrlComponentRecursively(requestedRestaurantId);
    const restaurantIdCandidates = buildRestaurantIdCandidates(canonicalRestaurantId);
    const { searchParams } = new URL(req.url);
    const phone = searchParams.get('phone');
    const menuSource = normalizeMenuSource(searchParams.get('src'));
    const telemetryEndpoint = menuSource ? `api.public.menu.${menuSource}` : 'api.public.menu';
    const firestore = await getFirestore();
    const respond = (payload, status = 200, headers = undefined) => {
        telemetryStatus = status;
        return NextResponse.json(payload, {
            status,
            ...(headers ? { headers } : {}),
        });
    };

    if (!requestedRestaurantId) {
        return respond({ message: 'Restaurant ID is required.' }, 400);
    }

    debugLog(`[Menu API] 🚀 START - Request received for restaurantId: ${requestedRestaurantId} (canonical: ${canonicalRestaurantId}) at ${new Date().toISOString()}`);

    // Check if Vercel KV is available (optional for local dev)
    const isKvConfigured = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
    let isKvAvailable = isKvConfigured;

    try {
        // STEP 1: Resolve business collection (cache-first, fallback to multi-collection lookup)
        const { winner, foundDocs, usedCollectionCache, resolvedRestaurantId } = await resolveBusinessAcrossCandidates({
            firestore,
            restaurantIds: restaurantIdCandidates,
            isKvAvailable
        });

        let cacheRestaurantId = resolvedRestaurantId || canonicalRestaurantId;
        let resolvedWinner = winner;
        let resolvedFoundDocs = foundDocs;
        let resolvedUsedCollectionCache = usedCollectionCache;

        if (!resolvedWinner) {
            const fallbackBusiness = await findBusinessById(firestore, canonicalRestaurantId);
            if (fallbackBusiness?.ref) {
                const fallbackSnapshot = await fallbackBusiness.ref.get();
                if (fallbackSnapshot.exists) {
                    const fallbackData = fallbackSnapshot.data();
                    const fallbackVersion = fallbackData?.menuVersion || 1;
                    cacheRestaurantId = fallbackSnapshot.id;
                    resolvedWinner = {
                        collectionName: fallbackBusiness.collection || fallbackBusiness.ref.parent.id,
                        businessRef: fallbackBusiness.ref,
                        businessData: fallbackData,
                        version: fallbackVersion,
                    };
                    resolvedFoundDocs = [resolvedWinner];
                    resolvedUsedCollectionCache = false;
                }
            }
        }

        if (!resolvedWinner) {
            debugLog(`[Menu API] ❌ Business not found for ${requestedRestaurantId} in any collection`);
            return respond({ message: 'Business not found.' }, 404);
        }

        let businessData = resolvedWinner.businessData;
        let businessRef = resolvedWinner.businessRef;
        let collectionName = resolvedWinner.collectionName;
        let menuVersion = resolvedWinner.version;

        if (!resolvedUsedCollectionCache && resolvedFoundDocs.length > 1) {
            console.warn(`[Menu API] ⚠️ DUPLICATE DATA DETECTED for ${cacheRestaurantId}`);
            resolvedFoundDocs.forEach(d => debugLog(`   - Found in ${d.collectionName} (v${d.version})`));
            debugLog(`   ✅ Selected winner: ${collectionName} (v${menuVersion})`);
        } else if (resolvedUsedCollectionCache) {
            debugLog(`[Menu API] ✅ Collection cache hit: ${collectionName} (v${menuVersion})`);
        } else {
            debugLog(`[Menu API] ✅ Found active business in ${collectionName} (v${menuVersion})`);
        }

        const effectiveIsOpen = getEffectiveBusinessOpenStatus(businessData);

        // STEP 2: Build version-based cache key
        // PATCH: Added _patch4 to force cache refresh for new delivery fee engine fields
        const cacheKey = `menu:${cacheRestaurantId}:v${menuVersion}_patch4`;
        const skipCache = searchParams.get('skip_cache') === 'true';

        // 🔍 PROOF: Show Redis cache usage and menuVersion
        debugLog(`%c[Menu API] 📊 CACHE DEBUG`, 'color: cyan; font-weight: bold');
        debugLog(`[Menu API]    ├─ Restaurant: ${cacheRestaurantId}`);
        debugLog(`[Menu API]    ├─ menuVersion from Firestore: ${menuVersion}`);
        debugLog(`[Menu API]    ├─ Generated cache key: ${cacheKey}`);
        debugLog(`[Menu API]    ├─ Redis KV available: ${isKvAvailable ? '✅ YES' : '❌ NO'}`);
        debugLog(`[Menu API]    ├─ Skip Cache Requested: ${skipCache ? '⚠️ YES' : 'NO'}`);
        debugLog(`[Menu API]    └─ Timestamp: ${new Date().toISOString()}`);

        // STEP 3: Check Redis cache with version-specific key
        if (!skipCache) {
            const l1CacheData = readMenuFromMemoryCache(cacheKey);
            if (l1CacheData) {
                debugLog(`%c[Menu API] ✅ L1 CACHE HIT`, 'color: #22c55e; font-weight: bold');
                const payload = { ...l1CacheData, isOpen: effectiveIsOpen };
                await trackEndpointRead(telemetryEndpoint, 1);
                return respond(payload, 200, {
                    'X-Cache': 'L1-HIT',
                    'X-Menu-Version': menuVersion.toString(),
                    'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600',
                    'Vary': 'Accept-Encoding'
                });
            }
        }

        if (isKvAvailable && !skipCache) {
            try {
                const cachedData = await kv.get(cacheKey);
                if (cachedData) {
                    debugLog(`%c[Menu API] ✅ CACHE HIT`, 'color: green; font-weight: bold');
                    debugLog(`[Menu API]    └─ Serving from Redis cache for key: ${cacheKey}`);
                    writeMenuToMemoryCache(cacheKey, cachedData);
                    const payload = { ...cachedData, isOpen: effectiveIsOpen };
                    await trackEndpointRead(telemetryEndpoint, 1);

                    return respond(payload, 200, {
                        'X-Cache': 'HIT',
                        'X-Menu-Version': menuVersion.toString(),
                        // CDN Cache: Fresh for 60s, serve stale for 10m
                        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600',
                        'Vary': 'Accept-Encoding'
                    });
                }
                debugLog(`%c[Menu API] ❌ CACHE MISS`, 'color: red; font-weight: bold');
                debugLog(`[Menu API]    └─ Fetching from Firestore for key: ${cacheKey}`);
            } catch (cacheReadErr) {
                isKvAvailable = false;
                console.warn(`[Menu API] KV read failed; falling back to Firestore for ${cacheRestaurantId}:`, cacheReadErr?.message || cacheReadErr);
            }
        } else {
            debugLog(`[Menu API] ⚠️ Vercel KV not configured - skipping cache for ${cacheRestaurantId}`);
        }

        // STEP 4: Cache miss - fetch from Firestore
        debugLog(`[Menu API] ✅ Found business: ${businessData.name}`);
        debugLog(`[Menu API] 📂 SOURCE COLLECTION: ${collectionName} (Critical Check)`);
        debugLog(`[Menu API] 🟢 isOpen status in DB: ${businessData.isOpen}`);
        debugLog(`[Menu API] 🔍 Querying coupons with status='active' from ${collectionName}/${cacheRestaurantId}/coupons`);

        // Fetch menu, coupons, AND delivery settings in parallel
        const [menuSnap, couponsSnap, deliveryConfigSnap] = await Promise.all([
            businessRef.collection('menu').get(),
            businessRef.collection('coupons').where('status', '==', 'active').get(),
            businessRef.collection('delivery_settings').doc('config').get()
        ]);

        debugLog(`[Menu API] 📊 Coupons query returned ${couponsSnap.size} documents`);

        // Check delivery settings
        const deliveryConfig = deliveryConfigSnap.exists ? deliveryConfigSnap.data() : {};
        debugLog(`[Menu API] 🚚 Delivery Config found: ${deliveryConfigSnap.exists}`, deliveryConfigSnap.exists ? deliveryConfig : '(using legacy/defaults)');

        let menuData = {};
        // FETCH CUSTOM CATEGORIES FROM SUB-COLLECTION
        const customCatSnap = await businessRef.collection('custom_categories').orderBy('order', 'asc').get();
        const customCategories = customCatSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const estimatedReads =
            1 + // business doc lookup
            (menuSnap?.size || 0) +
            (couponsSnap?.size || 0) +
            (customCatSnap?.size || 0) +
            1; // delivery_settings doc
        await trackEndpointRead(telemetryEndpoint, estimatedReads);

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

        const businessTypeRaw = businessData.businessType || collectionName.slice(0, -1);
        const businessType = businessTypeRaw === 'shop' ? 'store' : businessTypeRaw;
        const allCategories = { ...(businessType === 'restaurant' || businessType === 'street-vendor' ? restaurantCategoryConfig : shopCategoryConfig) };
        customCategories.forEach(cat => {
            if (!allCategories[cat.id]) {
                allCategories[cat.id] = { title: cat.title };
            }
        });

        Object.keys(allCategories).forEach(key => {
            menuData[key] = [];
        });

        menuSnap.docs.forEach(doc => {
            const item = doc.data();
            const categoryKey = item.categoryId || 'general';
            if (String(categoryKey).toLowerCase() === RESERVED_OPEN_ITEMS_CATEGORY_ID) {
                return;
            }
            if (menuData[categoryKey]) {
                menuData[categoryKey].push({ id: doc.id, ...item });
            } else {
                if (!menuData['general']) menuData['general'] = [];
                menuData['general'].push({ id: doc.id, ...item });
            }
        });

        // Sort items by order field
        Object.keys(menuData).forEach(key => {
            menuData[key].sort((a, b) => (a.order || 999) - (b.order || 999));
        });

        // Process coupons
        const now = new Date();
        debugLog('[Menu API] Fetched', couponsSnap.size, 'coupons with status=active');
        debugLog('[Menu API] Current time:', now);

        const coupons = couponsSnap.docs
            .map(doc => {
                const couponData = { id: doc.id, ...doc.data() };
                debugLog('[Menu API] Coupon:', couponData.code, 'startDate:', couponData.startDate, 'expiryDate:', couponData.expiryDate);
                return couponData;
            })
            .filter(coupon => {
                const startDate = coupon.startDate?.toDate ? coupon.startDate.toDate() : new Date(coupon.startDate);
                const expiryDate = coupon.expiryDate?.toDate ? coupon.expiryDate.toDate() : new Date(coupon.expiryDate);
                const isPublic = !coupon.customerId;
                const isValid = startDate <= now && expiryDate >= now;

                debugLog('[Menu API] Coupon', coupon.code, '- valid:', isValid, 'public:', isPublic, 'start:', startDate, 'expiry:', expiryDate);

                return isValid && isPublic; // Only public coupons in cache
            });

        debugLog('[Menu API] Final coupons count:', coupons.length);

        const responseData = {
            // Coordinates for distance calculation consumers
            latitude: businessData.coordinates?.lat ?? businessData.address?.latitude ?? businessData.businessAddress?.latitude ?? null,
            longitude: businessData.coordinates?.lng ?? businessData.address?.longitude ?? businessData.businessAddress?.longitude ?? null,
            restaurantName: businessData.name,
            approvalStatus: businessData.approvalStatus || 'approved',
            logoUrl: businessData.logoUrl,
            bannerUrls: businessData.bannerUrls,
            // MERGED DELIVERY SETTINGS (Sub-collection takes precedence => fallback to legacy)
            // Use deliveryFixedFee as source of truth for fixed charge
            deliveryCharge: deliveryConfigSnap.exists ? (deliveryConfig.deliveryFeeType === 'fixed' ? deliveryConfig.deliveryFixedFee : 0) : (businessData.deliveryCharge || 0),
            deliveryFixedFee: deliveryConfigSnap.exists ? deliveryConfig.deliveryFixedFee : (businessData.deliveryFixedFee || 30),
            deliveryBaseDistance: deliveryConfigSnap.exists ? deliveryConfig.deliveryBaseDistance : (businessData.deliveryBaseDistance || 0),
            deliveryFreeThreshold: deliveryConfigSnap.exists ? deliveryConfig.deliveryFreeThreshold : (businessData.deliveryFreeThreshold || 500),
            minOrderValue: deliveryConfigSnap.exists ? deliveryConfig.minOrderValue : (businessData.minOrderValue || 0),

            // Correctly expose Per-Km settings
            deliveryFeeType: deliveryConfigSnap.exists ? deliveryConfig.deliveryFeeType : (businessData.deliveryFeeType || 'fixed'),
            deliveryPerKmFee: deliveryConfigSnap.exists ? deliveryConfig.deliveryPerKmFee : (businessData.deliveryPerKmFee || 0),
            deliveryRadius: deliveryConfigSnap.exists ? deliveryConfig.deliveryRadius : (businessData.deliveryRadius || 5),
            roadDistanceFactor: deliveryConfigSnap.exists ? (deliveryConfig.roadDistanceFactor || 1.0) : (businessData.roadDistanceFactor || 1.0),
            freeDeliveryRadius: deliveryConfigSnap.exists ? (deliveryConfig.freeDeliveryRadius || 0) : (businessData.freeDeliveryRadius || 0),
            freeDeliveryMinOrder: deliveryConfigSnap.exists ? (deliveryConfig.freeDeliveryMinOrder || 0) : (businessData.freeDeliveryMinOrder || 0),
            deliveryTiers: deliveryConfigSnap.exists ? (deliveryConfig.deliveryTiers || []) : (businessData.deliveryTiers || []),
            deliveryOrderSlabRules: deliveryConfigSnap.exists ? (deliveryConfig.deliveryOrderSlabRules || []) : (businessData.deliveryOrderSlabRules || []),
            deliveryOrderSlabAboveFee: deliveryConfigSnap.exists ? (deliveryConfig.deliveryOrderSlabAboveFee || 0) : (businessData.deliveryOrderSlabAboveFee || 0),
            deliveryOrderSlabBaseDistance: deliveryConfigSnap.exists ? (deliveryConfig.deliveryOrderSlabBaseDistance || 1) : (businessData.deliveryOrderSlabBaseDistance || 1),
            deliveryOrderSlabPerKmFee: deliveryConfigSnap.exists ? (deliveryConfig.deliveryOrderSlabPerKmFee || 15) : (businessData.deliveryOrderSlabPerKmFee || 15),

            menu: menuData,
            customCategories: customCategories,
            coupons: coupons,
            loyaltyPoints: 0, // User-specific data removed for better caching
            // MERGED DELIVERY ENABLED STATUS
            deliveryEnabled: deliveryConfigSnap.exists ? deliveryConfig.deliveryEnabled : businessData.deliveryEnabled,
            pickupEnabled: businessData.pickupEnabled,
            dineInEnabled: businessData.dineInEnabled,
            businessAddress: businessData.address,
            businessType: businessType,
            dineInModel: businessData.dineInModel,
            isOpen: effectiveIsOpen,
        };

        // STEP 5: Cache with version-based key and 12-hour TTL
        writeMenuToMemoryCache(cacheKey, responseData);
        if (isKvAvailable) {
            kv.set(cacheKey, responseData, { ex: 43200 }) // 12 hours = 43200 seconds
                .then(() => debugLog(`[Menu API] ✅ Cached as ${cacheKey} (TTL: 12 hours)`))
                .catch(cacheError => console.error('[Menu API] ❌ Cache storage failed:', cacheError));
        } else if (isKvConfigured) {
            debugLog(`[Menu API] ⚠️ KV configured but unavailable for this request; skipped cache write for ${cacheRestaurantId}`);
        }

        // Return with no-cache headers to prevent browser caching
        return respond(responseData, 200, {
            'X-Cache': 'MISS',
            'X-Menu-Version': menuVersion.toString(),
            'X-Debug-Source-Collection': collectionName,
            'X-Debug-DB-IsOpen': String(businessData.isOpen),
            'X-Debug-Effective-IsOpen': String(effectiveIsOpen),
            // CDN Cache: Fresh for 60s, serve stale for 10m
            'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600',
            'Vary': 'Accept-Encoding'
        });

    } catch (error) {
        telemetryStatus = error?.status || 500;
        telemetryError = error?.message || 'Menu API failed';
        console.error(`[API ERROR] /api/public/menu/${requestedRestaurantId}:`, error);
        return respond({ message: 'Internal Server Error: ' + error.message }, telemetryStatus);
    } finally {
        void trackApiTelemetry({
            endpoint: telemetryEndpoint,
            durationMs: Date.now() - telemetryStartedAt,
            statusCode: telemetryStatus,
            errorMessage: telemetryError,
            context: { restaurantId: String(requestedRestaurantId || ''), src: menuSource || null },
        });
    }
}

