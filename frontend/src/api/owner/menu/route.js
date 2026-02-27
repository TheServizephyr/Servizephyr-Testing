

import { NextResponse } from 'next/server';
import { getAuth, getFirestore, FieldValue, verifyAndGetUid } from '@/lib/firebase-admin';

// Helper to verify owner and get their first business ID
async function verifyOwnerAndGetBusiness(req, auth, firestore) {
    console.log("[API LOG] verifyOwnerAndGetBusiness: Starting verification...");
    const uid = await verifyAndGetUid(req); // Use central helper
    console.log(`[API LOG] verifyOwnerAndGetBusiness: UID verified: ${uid}`);
    
    // --- ADMIN IMPERSONATION & PERMISSION LOGIC ---
    const url = new URL(req.url, `http://${req.headers.host}`);
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const userDoc = await firestore.collection('users').doc(uid).get();

    if (!userDoc.exists) {
        console.error(`[API ERROR] verifyOwnerAndGetBusiness: User profile not found for UID: ${uid}`);
        throw { message: 'Access Denied: User profile not found.', status: 403 };
    }

    const userData = userDoc.data();
    const userRole = userData.role;
    console.log(`[API LOG] verifyOwnerAndGetBusiness: User role is '${userRole}'.`);

    let targetOwnerId = uid;
    if (userRole === 'admin' && impersonatedOwnerId) {
        console.log(`[API LOG] Impersonation: Admin ${uid} is managing data for owner ${impersonatedOwnerId}.`);
        targetOwnerId = impersonatedOwnerId;
    } else if (!['owner', 'restaurant-owner', 'shop-owner', 'street-vendor'].includes(userRole)) {
        console.error(`[API ERROR] verifyOwnerAndGetBusiness: User ${uid} with role '${userRole}' does not have sufficient privileges.`);
        throw { message: 'Access Denied: You do not have sufficient privileges.', status: 403 };
    }

    const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];
    for (const collectionName of collectionsToTry) {
        console.log(`[API LOG] verifyOwnerAndGetBusiness: Checking collection '${collectionName}' for ownerId '${targetOwnerId}'...`);
        const querySnapshot = await firestore.collection(collectionName).where('ownerId', '==', targetOwnerId).limit(1).get();
        if (!querySnapshot.empty) {
            const doc = querySnapshot.docs[0];
            console.log(`[API LOG] verifyOwnerAndGetBusiness: Found business in '${collectionName}' with ID: ${doc.id}`);
            return { uid: targetOwnerId, businessId: doc.id, businessSnap: doc, collectionName, isAdmin: userRole === 'admin' };
        }
    }
    
    console.error(`[API ERROR] verifyOwnerAndGetBusiness: No business associated with ownerId '${targetOwnerId}' found in any collection.`);
    throw { message: 'No business associated with this owner.', status: 404 };
}

export async function GET(req) {
    console.log("[API LOG] GET /api/owner/menu: Request received.");
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { businessId, businessSnap, collectionName } = await verifyOwnerAndGetBusiness(req, auth, firestore);
        console.log(`[API LOG] GET /api/owner/menu: Verified access for business ${businessId}.`);

        const menuRef = firestore.collection(collectionName).doc(businessId).collection('menu');
        const menuSnap = await menuRef.orderBy('order', 'asc').get();
        console.log(`[API LOG] GET /api/owner/menu: Fetched ${menuSnap.size} items from menu subcollection.`);

        let menuData = {};
        const businessData = businessSnap.data();
        const customCategories = businessData.customCategories || [];

        const businessTypeRaw = businessData.businessType || (collectionName === 'restaurants' ? 'restaurant' : (collectionName === 'shops' ? 'store' : 'street-vendor'));
        const businessType = businessTypeRaw === 'shop' ? 'store' : businessTypeRaw;
        console.log(`[API LOG] GET /api/owner/menu: Determined businessType as '${businessType}'.`);
        
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

        menuSnap.docs.forEach(doc => {
            const item = doc.data();
            const categoryKey = item.categoryId || 'general';
            if (!menuData[categoryKey]) {
                menuData[categoryKey] = [];
            }
            menuData[categoryKey].push({ id: doc.id, ...item });
        });
        
        console.log("[API LOG] GET /api/owner/menu: Successfully processed menu data. Responding to client.");
        return NextResponse.json({ menu: menuData, customCategories: customCategories, businessType: businessType }, { status: 200 });

    } catch (error) {
        console.error("[API LOG] CRITICAL ERROR in GET /api/owner/menu:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


export async function POST(req) {
    console.log("[API LOG] POST /api/owner/menu: Request received.");
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        console.log("[API LOG] Firebase Admin SDK initialized for POST.");

        const { businessId, businessSnap, collectionName } = await verifyOwnerAndGetBusiness(req, auth, firestore);
        console.log(`[API LOG] POST /api/owner/menu: Owner verified for business ID: ${businessId} in collection ${collectionName}.`);

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
            
            const businessRef = businessSnap.ref;
            const businessData = businessSnap.data();
            const currentCategories = businessData.customCategories || [];
            
            if (!currentCategories.some(cat => cat.id === formattedId)) {
                console.log(`[API LOG] POST /api/owner/menu: Category "${formattedId}" does not exist. Adding to batch.`);
                const newCategoryObject = { id: formattedId, title: newCategory.trim() };
                const updatedCategories = [...currentCategories, newCategoryObject];
                batch.update(businessRef, { customCategories: updatedCategories });
            } else {
                console.log(`[API LOG] POST /api/owner/menu: Category "${formattedId}" already exists.`);
            }
        }
        
        const finalItem = {
            ...item,
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
            const itemRef = menuRef.doc(item.id);
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

        console.log("[API LOG] POST /api/owner/menu: Committing batch...");
        await batch.commit();
        console.log("[API LOG] POST /api/owner/menu: Batch commit successful!");

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
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { businessId, collectionName } = await verifyOwnerAndGetBusiness(req, auth, firestore);
        const { itemId } = await req.json();

        if (!itemId) {
            console.error("[API ERROR] DELETE /api/owner/menu: Item ID is required.");
            return NextResponse.json({ message: 'Item ID is required.' }, { status: 400 });
        }

        console.log(`[API LOG] DELETE /api/owner/menu: Deleting item ${itemId} from ${collectionName}/${businessId}/menu.`);
        const itemRef = firestore.collection(collectionName).doc(businessId).collection('menu').doc(itemId);
        await itemRef.delete();
        console.log(`[API LOG] DELETE /api/owner/menu: Item deleted successfully.`);

        return NextResponse.json({ message: 'Item deleted successfully.' }, { status: 200 });
    } catch (error) {
        console.error("[API LOG] CRITICAL ERROR in DELETE /api/owner/menu:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


export async function PATCH(req) {
    console.log("[API LOG] PATCH /api/owner/menu: Request received.");
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { businessId, collectionName } = await verifyOwnerAndGetBusiness(req, auth, firestore);
        const { itemIds, action, updates } = await req.json();
        console.log("[API LOG] PATCH /api/owner/menu: Body:", { itemIds, action, updates });
        
        const menuRef = firestore.collection(collectionName).doc(businessId).collection('menu');

        if (updates && updates.id) {
            console.log(`[API LOG] PATCH /api/owner/menu: Single item availability update for ${updates.id}.`);
            const itemRef = menuRef.doc(updates.id);
            await itemRef.update({ isAvailable: updates.isAvailable });
            console.log(`[API LOG] PATCH /api/owner/menu: Item ${updates.id} updated.`);
            return NextResponse.json({ message: 'Item availability updated.' }, { status: 200 });
        }

        if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0 || !action) {
            console.error("[API ERROR] PATCH /api/owner/menu: Item IDs array and action are required for bulk updates.");
            return NextResponse.json({ message: 'Item IDs array and action are required for bulk updates.' }, { status: 400 });
        }

        console.log(`[API LOG] PATCH /api/owner/menu: Performing bulk action '${action}' on ${itemIds.length} items.`);
        const batch = firestore.batch();
        itemIds.forEach(itemId => {
            const itemRef = menuRef.doc(itemId);
            if (action === 'delete') {
                batch.delete(itemRef);
            } else if (action === 'outOfStock') {
                batch.update(itemRef, { isAvailable: false });
            }
        });

        await batch.commit();
        console.log(`[API LOG] PATCH /api/owner/menu: Bulk action completed.`);

        return NextResponse.json({ message: `Bulk action '${action}' completed successfully on ${itemIds.length} items.` }, { status: 200 });

    } catch (error) {
        console.error("[API LOG] CRITICAL ERROR in PATCH /api/owner/menu:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
