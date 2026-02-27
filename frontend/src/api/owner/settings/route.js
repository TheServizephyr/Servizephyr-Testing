

import { NextResponse } from 'next/server';
import { getAuth, getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';
import { initializeApp, getApps } from 'firebase-admin/app';
import { sendRestaurantStatusChangeNotification } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

async function verifyUserAndGetData(req) {
    const firestore = await getFirestore();
    const uid = await verifyAndGetUid(req); // Use central helper
    
    // Admin impersonation logic
    const url = new URL(req.url, `http://${req.headers.host}`);
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const adminUserDoc = await firestore.collection('users').doc(uid).get();

    let finalUserId = uid;
    if (adminUserDoc.exists && adminUserDoc.data().role === 'admin' && impersonatedOwnerId) {
        console.log(`[API Impersonation] Admin ${uid} is viewing data for owner ${impersonatedOwnerId}.`);
        finalUserId = impersonatedOwnerId;
    }
    
    const userRef = firestore.collection('users').doc(finalUserId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
        throw { message: "User profile not found.", status: 404 };
    }
    
    const userData = userDoc.data();
    let businessData = null;
    let businessRef = null;
    let businessId = null;

    if (userData.role === 'owner' || userData.role === 'restaurant-owner' || userData.role === 'shop-owner' || userData.role === 'street-vendor' || (adminUserDoc.exists && adminUserDoc.data().role === 'admin' && impersonatedOwnerId)) {
        const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];
        for (const collectionName of collectionsToTry) {
            const businessesQuery = await firestore.collection(collectionName).where('ownerId', '==', finalUserId).limit(1).get();
            if (!businessesQuery.empty) {
                const businessDoc = businessesQuery.docs[0];
                businessRef = businessDoc.ref;
                businessData = businessDoc.data();
                businessId = businessDoc.id;
                break; // Found the business, stop searching
            }
        }
    }
    
    return { uid: finalUserId, userRef, userData, businessRef, businessData, businessId };
}

export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const businessIdFromQuery = searchParams.get('restaurantId') || searchParams.get('businessId');
        
        // This block is for public-facing queries that only need payment settings.
        if (businessIdFromQuery) {
            const firestore = await getFirestore();
            let businessDoc;
            const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];
            for (const collectionName of collectionsToTry) {
                const docRef = firestore.collection(collectionName).doc(businessIdFromQuery);
                businessDoc = await docRef.get();
                if (businessDoc.exists) break;
            }

            if (!businessDoc || !businessDoc.exists) {
                return NextResponse.json({ message: "Business not found." }, { status: 404 });
            }
            const businessData = businessDoc.data();
            // This is the public response, only contains necessary info.
            return NextResponse.json({ 
                deliveryCodEnabled: businessData.deliveryCodEnabled === undefined ? true : businessData.deliveryCodEnabled,
                pickupPodEnabled: businessData.pickupPodEnabled === undefined ? true : businessData.pickupPodEnabled,
                dineInPayAtCounterEnabled: businessData.dineInPayAtCounterEnabled === undefined ? true : businessData.dineInPayAtCounterEnabled,
                botPhoneNumberId: businessData.botPhoneNumberId || null,
                botDisplayNumber: businessData.botDisplayNumber || null,
            }, { status: 200 });
        }
        
        // This block is for authenticated owner dashboard queries.
        const { uid, userData, businessData, businessId } = await verifyUserAndGetData(req);
        
        const profileData = {
            name: userData.name || 'No Name',
            email: userData.email || 'No Email',
            phone: userData.phone || '',
            role: userData.role || 'customer',
            restaurantName: businessData?.name || '',
            profilePicture: userData.profilePictureUrl || `https://picsum.photos/seed/${uid}/200/200`,
            notifications: userData.notifications || { newOrders: true, dailySummary: false, marketing: true },
            address: businessData?.address || { street: '', city: '', state: '', postalCode: '', country: 'IN' },
            gstin: businessData?.gstin || '',
            fssai: businessData?.fssai || '',
            botPhoneNumberId: businessData?.botPhoneNumberId || '',
            botDisplayNumber: businessData?.botDisplayNumber || '',
            razorpayAccountId: businessData?.razorpayAccountId || '', 
            logoUrl: businessData?.logoUrl || '',
            bannerUrls: businessData?.bannerUrls || [],
            // Delivery Settings
            deliveryEnabled: businessData?.deliveryEnabled === undefined ? true : businessData.deliveryEnabled,
            deliveryRadius: businessData?.deliveryRadius === undefined ? 5 : businessData.deliveryRadius,
            deliveryFeeType: businessData?.deliveryFeeType || 'fixed',
            deliveryFixedFee: businessData?.deliveryFixedFee === undefined ? 30 : businessData.deliveryFixedFee,
            deliveryPerKmFee: businessData?.deliveryPerKmFee === undefined ? 5 : businessData.deliveryPerKmFee,
            deliveryFreeThreshold: businessData?.deliveryFreeThreshold === undefined ? 500 : businessData.deliveryFreeThreshold,
            // Other Settings
            pickupEnabled: businessData?.pickupEnabled === undefined ? false : businessData.pickupEnabled,
            dineInEnabled: businessData?.dineInEnabled === undefined ? true : businessData.dineInEnabled,
            deliveryOnlinePaymentEnabled: businessData?.deliveryOnlinePaymentEnabled === undefined ? true : businessData.deliveryOnlinePaymentEnabled,
            deliveryCodEnabled: businessData?.deliveryCodEnabled === undefined ? true : businessData.deliveryCodEnabled,
            pickupOnlinePaymentEnabled: businessData?.pickupOnlinePaymentEnabled === undefined ? true : businessData.pickupOnlinePaymentEnabled,
            pickupPodEnabled: businessData?.pickupPodEnabled === undefined ? true : businessData.pickupPodEnabled,
            dineInOnlinePaymentEnabled: businessData?.dineInOnlinePaymentEnabled === undefined ? true : businessData.dineInOnlinePaymentEnabled,
            dineInPayAtCounterEnabled: businessData?.dineInPayAtCounterEnabled === undefined ? true : businessData.dineInPayAtCounterEnabled,
            isOpen: businessData?.isOpen === undefined ? true : businessData.isOpen,
            dineInModel: businessData?.dineInModel || 'post-paid',
            businessId: businessId
        };

        return NextResponse.json(profileData, { status: 200 });

    } catch (error) {
        console.error("GET SETTINGS ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

export async function PATCH(req) {
    try {
        const { userRef, userData, businessRef, businessData, businessId } = await verifyUserAndGetData(req);
        
        const updates = await req.json();

        const userUpdateData = {};
        if (updates.name !== undefined) userUpdateData.name = updates.name;
        if (updates.phone !== undefined) userUpdateData.phone = updates.phone;
        if (updates.notifications !== undefined) userUpdateData.notifications = updates.notifications;

        if (Object.keys(userUpdateData).length > 0) {
            await userRef.update(userUpdateData);
        }

        if (businessRef) {
            const businessUpdateData = {};
            if (updates.restaurantName !== undefined) businessUpdateData.name = updates.restaurantName;
            if (updates.gstin !== undefined) businessUpdateData.gstin = updates.gstin;
            if (updates.fssai !== undefined) businessUpdateData.fssai = updates.fssai;
            if (updates.botPhoneNumberId !== undefined) businessUpdateData.botPhoneNumberId = updates.botPhoneNumberId;
            if (updates.botDisplayNumber !== undefined) businessUpdateData.botDisplayNumber = updates.botDisplayNumber;
            if (updates.razorpayAccountId !== undefined) businessUpdateData.razorpayAccountId = updates.razorpayAccountId;
            if (updates.logoUrl !== undefined) businessUpdateData.logoUrl = updates.logoUrl;
            if (updates.bannerUrls !== undefined) businessUpdateData.bannerUrls = updates.bannerUrls;
            if (updates.address !== undefined) businessUpdateData.address = updates.address; 
            
            // Order and Payment Settings
            if (updates.deliveryEnabled !== undefined) businessUpdateData.deliveryEnabled = updates.deliveryEnabled;
            if (updates.pickupEnabled !== undefined) businessUpdateData.pickupEnabled = updates.pickupEnabled;
            if (updates.dineInEnabled !== undefined) businessUpdateData.dineInEnabled = updates.dineInEnabled;
            if (updates.deliveryOnlinePaymentEnabled !== undefined) businessUpdateData.deliveryOnlinePaymentEnabled = updates.deliveryOnlinePaymentEnabled;
            if (updates.deliveryCodEnabled !== undefined) businessUpdateData.deliveryCodEnabled = updates.deliveryCodEnabled;
            if (updates.pickupOnlinePaymentEnabled !== undefined) businessUpdateData.pickupOnlinePaymentEnabled = updates.pickupOnlinePaymentEnabled;
            if (updates.pickupPodEnabled !== undefined) businessUpdateData.pickupPodEnabled = updates.pickupPodEnabled;
            if (updates.dineInOnlinePaymentEnabled !== undefined) businessUpdateData.dineInOnlinePaymentEnabled = updates.dineInOnlinePaymentEnabled;
            if (updates.dineInPayAtCounterEnabled !== undefined) businessUpdateData.dineInPayAtCounterEnabled = updates.dineInPayAtCounterEnabled;
            
            if (updates.dineInModel !== undefined) businessUpdateData.dineInModel = updates.dineInModel;


            // Delivery Settings
            if (updates.deliveryRadius !== undefined) businessUpdateData.deliveryRadius = updates.deliveryRadius;
            if (updates.deliveryFeeType !== undefined) businessUpdateData.deliveryFeeType = updates.deliveryFeeType;
            if (updates.deliveryFixedFee !== undefined) businessUpdateData.deliveryFixedFee = updates.deliveryFixedFee;
            if (updates.deliveryPerKmFee !== undefined) businessUpdateData.deliveryPerKmFee = updates.deliveryPerKmFee;
            if (updates.deliveryFreeThreshold !== undefined) businessUpdateData.deliveryFreeThreshold = updates.deliveryFreeThreshold;


            if (updates.isOpen !== undefined && updates.isOpen !== businessData?.isOpen) {
                businessUpdateData.isOpen = updates.isOpen;
                
                sendRestaurantStatusChangeNotification({
                    ownerPhone: businessData.ownerPhone,
                    botPhoneNumberId: businessData.botPhoneNumberId,
                    newStatus: updates.isOpen,
                    restaurantId: businessId,
                }).catch(e => console.error("Failed to send status change notification:", e));
            }

            if (updates.phone !== undefined && updates.phone !== businessData?.ownerPhone) {
                businessUpdateData.ownerPhone = updates.phone;
            }
            
            if (Object.keys(businessUpdateData).length > 0) {
                await businessRef.update(businessUpdateData);
            }
        }
        
        const { userData: finalUserData, businessData: finalBusinessData, businessId: finalBusinessId } = await verifyUserAndGetData(req);
        
        const responseData = {
            name: finalUserData.name, email: finalUserData.email, phone: finalUserData.phone,
            role: finalUserData.role, restaurantName: finalBusinessData?.name || '',
            profilePicture: finalUserData.profilePictureUrl, notifications: finalUserData.notifications,
            gstin: finalBusinessData?.gstin || '', fssai: finalBusinessData?.fssai || '',
            botPhoneNumberId: finalBusinessData?.botPhoneNumberId || '',
            botDisplayNumber: finalBusinessData?.botDisplayNumber || '',
            razorpayAccountId: finalBusinessData?.razorpayAccountId || '',
            logoUrl: finalBusinessData?.logoUrl || '', bannerUrls: finalBusinessData?.bannerUrls || [],
            deliveryEnabled: finalBusinessData?.deliveryEnabled === undefined ? true : finalBusinessData.deliveryEnabled,
            deliveryRadius: finalBusinessData?.deliveryRadius === undefined ? 5 : finalBusinessData.deliveryRadius,
            deliveryFeeType: finalBusinessData?.deliveryFeeType || 'fixed',
            deliveryFixedFee: finalBusinessData?.deliveryFixedFee === undefined ? 30 : finalBusinessData.deliveryFixedFee,
            deliveryPerKmFee: finalBusinessData?.deliveryPerKmFee === undefined ? 5 : finalBusinessData.deliveryPerKmFee,
            deliveryFreeThreshold: finalBusinessData?.deliveryFreeThreshold === undefined ? 500 : finalBusinessData.deliveryFreeThreshold,
            pickupEnabled: finalBusinessData?.pickupEnabled === undefined ? false : finalBusinessData.pickupEnabled,
            dineInEnabled: finalBusinessData?.dineInEnabled === undefined ? true : finalBusinessData.dineInEnabled,
            deliveryOnlinePaymentEnabled: finalBusinessData?.deliveryOnlinePaymentEnabled === undefined ? true : finalBusinessData.deliveryOnlinePaymentEnabled,
            deliveryCodEnabled: finalBusinessData?.deliveryCodEnabled === undefined ? true : finalBusinessData.deliveryCodEnabled,
            pickupOnlinePaymentEnabled: finalBusinessData?.pickupOnlinePaymentEnabled === undefined ? true : finalBusinessData.pickupOnlinePaymentEnabled,
            pickupPodEnabled: finalBusinessData?.pickupPodEnabled === undefined ? true : finalBusinessData.pickupPodEnabled,
            dineInOnlinePaymentEnabled: finalBusinessData?.dineInOnlinePaymentEnabled === undefined ? true : finalBusinessData.dineInOnlinePaymentEnabled,
            dineInPayAtCounterEnabled: finalBusinessData?.dineInPayAtCounterEnabled === undefined ? true : finalBusinessData.dineInPayAtCounterEnabled,
            isOpen: finalBusinessData?.isOpen === undefined ? true : finalBusinessData.isOpen,
            dineInModel: finalBusinessData?.dineInModel || 'post-paid',
            address: finalBusinessData?.address || { street: '', city: '', state: '', postalCode: '', country: 'IN' },
            businessId: finalBusinessId,
        };

        return NextResponse.json(responseData, { status: 200 });

    } catch (error) {
        console.error("PATCH SETTINGS ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
