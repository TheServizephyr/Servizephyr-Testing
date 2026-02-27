
import { NextResponse } from 'next/server';
import { getAuth, FieldValue, getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';
import { logAuditEvent, AUDIT_ACTIONS } from '@/lib/security/audit-log';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { couponLimiter } from '@/lib/security/rate-limiter';


// Helper to verify owner and get their first business ID
async function verifyOwnerAndGetBusiness(req, auth, firestore) {
    const uid = await verifyAndGetUid(req); // Use central helper

    // --- ADMIN IMPERSONATION & EMPLOYEE ACCESS LOGIC ---
    const url = new URL(req.url, `http://${req.headers.host}`);
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = url.searchParams.get('employee_of');
    const userDoc = await firestore.collection('users').doc(uid).get();

    if (!userDoc.exists) {
        throw { message: 'Access Denied: User profile not found.', status: 403 };
    }

    const userData = userDoc.data();
    const userRole = userData.role;

    let targetOwnerId = uid;

    // Admin impersonation
    if (userRole === 'admin' && impersonatedOwnerId) {
        console.log(`[API Impersonation] Admin ${uid} is managing coupons for owner ${impersonatedOwnerId}.`);
        targetOwnerId = impersonatedOwnerId;
    }
    // Employee access
    else if (employeeOfOwnerId) {
        const linkedOutlets = userData.linkedOutlets || [];
        const hasAccess = linkedOutlets.some(o => o.ownerId === employeeOfOwnerId && o.status === 'active');

        if (!hasAccess) {
            throw { message: 'Access Denied: You are not an employee of this outlet.', status: 403 };
        }

        console.log(`[API Employee Access] ${uid} accessing ${employeeOfOwnerId}'s coupons`);
        targetOwnerId = employeeOfOwnerId;
    }
    // Owner access
    else if (!['owner', 'restaurant-owner', 'shop-owner', 'street-vendor'].includes(userRole)) {
        throw { message: 'Access Denied: You do not have sufficient privileges.', status: 403 };
    }

    const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];
    for (const collectionName of collectionsToTry) {
        const query = await firestore.collection(collectionName).where('ownerId', '==', targetOwnerId).limit(1).get();
        if (!query.empty) {
            const doc = query.docs[0];
            return { uid: targetOwnerId, businessId: doc.id, collectionName: collectionName, isAdmin: userRole === 'admin', businessData: doc.data(), userRole };
        }
    }

    throw { message: 'No business associated with this owner.', status: 404 };
}


export async function GET(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { businessId, collectionName } = await verifyOwnerAndGetBusiness(req, auth, firestore);

        const couponsRef = firestore.collection(collectionName).doc(businessId).collection('coupons');
        const couponsSnap = await couponsRef.orderBy('expiryDate', 'desc').get();

        let coupons = couponsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        return NextResponse.json({ coupons }, { status: 200 });

    } catch (error) {
        console.error("GET COUPONS ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


export async function POST(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { businessId, collectionName, uid, userRole, businessData } = await verifyOwnerAndGetBusiness(req, auth, firestore);
        const { coupon } = await req.json();

        // 🔒 Rate limit check (15 coupon operations per minute)
        const rateLimitCheck = couponLimiter.check(uid, businessId);
        if (!rateLimitCheck.allowed) {
            logAuditEvent({
                actorUid: uid,
                actorRole: userRole,
                action: AUDIT_ACTIONS.RATE_LIMIT_VIOLATION,
                targetUid: null,
                outletId: businessId,
                metadata: {
                    endpoint: 'coupon_create',
                    limit: '15/min',
                    retryAfter: rateLimitCheck.retryAfter
                },
                source: 'rate_limiter',
                req
            }).catch(err => console.error('[AUDIT_LOG_FAILED]', err));

            return NextResponse.json({
                message: `Too many coupon operations. Please wait ${rateLimitCheck.retryAfter} seconds.`
            }, { status: 429 });
        }

        // Updated Validation
        const isFreeDelivery = coupon.type === 'free_delivery';
        if (!coupon || !coupon.code || coupon.minOrder === undefined || (!isFreeDelivery && coupon.value === undefined)) {
            return NextResponse.json({ message: 'Missing required coupon data.' }, { status: 400 });
        }

        const couponsCollectionRef = firestore.collection(collectionName).doc(businessId).collection('coupons');
        const newCouponRef = couponsCollectionRef.doc();

        const newCouponData = {
            ...coupon,
            id: newCouponRef.id,
            timesUsed: 0,
            value: isFreeDelivery ? 0 : Number(coupon.value),
            createdAt: FieldValue.serverTimestamp(),
            startDate: new Date(coupon.startDate),
            expiryDate: new Date(coupon.expiryDate),
        };

        await newCouponRef.set(newCouponData);

        // 🔍 Audit log: COUPON_CREATE (fire-and-forget)
        logAuditEvent({
            actorUid: uid,
            actorRole: userRole,
            action: AUDIT_ACTIONS.COUPON_CREATE,
            targetUid: null,
            outletId: businessId,
            metadata: {
                couponId: newCouponRef.id,
                couponCode: coupon.code,
                discountType: coupon.type, // 'percentage', 'fixed', 'free_delivery'
                discountValue: isFreeDelivery ? 0 : coupon.value,
                minOrder: coupon.minOrder,
                expiryDate: coupon.expiryDate,
                createdAt: new Date().toISOString()
            },
            source: 'coupons_api',
            req
        }).catch(err => console.error('[AUDIT_LOG_FAILED]', err));

        // 📱 SEND WHATSAPP NOTIFICATION
        if (businessData.botPhoneNumberId && coupon.customerId) {
            try {
                // 1. Fetch Customer to get Phone Number
                const customerDoc = await firestore.collection(collectionName).doc(businessId).collection('customers').doc(coupon.customerId).get();
                if (customerDoc.exists) {
                    const customerData = customerDoc.data();
                    const phone = customerData.phone || customerData.phoneNumber || customerData.contactInfo?.phone;

                    if (phone) {
                        // Ensure phone has country code (default to 91 if missing and looks like 10 digits)
                        let formattedPhone = phone.toString().replace(/\D/g, ''); // Remove non-digits
                        if (formattedPhone.length === 10) formattedPhone = '91' + formattedPhone;

                        const discountText = isFreeDelivery ? 'FREE DELIVERY' : (coupon.type === 'percentage' ? `${coupon.value}% OFF` : `₹${coupon.value} OFF`);
                        const message = `High five, ${customerData.name?.split(' ')[0] || 'there'}! 🙌\n\nYou've just unlocked a special reward at ${businessData.name}: *${discountText}*!\n\nUse Code: *${coupon.code}*\n${coupon.description || ''}\n\nMinimum Order: ₹${coupon.minOrder}\nValid until: ${new Date(coupon.expiryDate).toLocaleDateString('en-IN')}\n\nOrder now to redeem! 🍕`;

                        await sendWhatsAppMessage(formattedPhone, message, businessData.botPhoneNumberId);
                    } else {
                        console.warn(`[Coupon API] Customer ${coupon.customerId} has no phone number. Skipped WhatsApp.`);
                    }
                }
            } catch (waError) {
                console.error(`[Coupon API] Failed to send WhatsApp notification: ${waError.message}`);
                // Verify we don't fail the request request just because notification failed
            }
        }

        // 🔄 CACHE INVALIDATION: Increment menuVersion to force public API refresh
        await firestore.collection(collectionName).doc(businessId).update({
            menuVersion: FieldValue.increment(1)
        });

        return NextResponse.json({ message: 'Coupon created successfully!', id: newCouponRef.id }, { status: 201 });

    } catch (error) {
        console.error("POST COUPON ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

export async function PATCH(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { businessId, collectionName } = await verifyOwnerAndGetBusiness(req, auth, firestore);
        const { coupon } = await req.json();

        if (!coupon || !coupon.id) {
            return NextResponse.json({ message: 'Coupon ID is required for updating.' }, { status: 400 });
        }

        const couponRef = firestore.collection(collectionName).doc(businessId).collection('coupons').doc(coupon.id);

        const { id, timesUsed, createdAt, ...updateData } = coupon;

        if (updateData.type === 'free_delivery') {
            updateData.value = 0;
        } else {
            updateData.value = Number(updateData.value);
        }

        if (updateData.startDate) {
            updateData.startDate = new Date(updateData.startDate);
        }
        if (updateData.expiryDate) {
            updateData.expiryDate = new Date(updateData.expiryDate);
        }

        await couponRef.update(updateData);

        // 🔄 CACHE INVALIDATION: Increment menuVersion to force public API refresh
        await firestore.collection(collectionName).doc(businessId).update({
            menuVersion: FieldValue.increment(1)
        });

        return NextResponse.json({ message: 'Coupon updated successfully!' }, { status: 200 });

    } catch (error) {
        console.error("PATCH COUPON ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


export async function DELETE(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { businessId, collectionName, uid, userRole } = await verifyOwnerAndGetBusiness(req, auth, firestore);
        const { couponId } = await req.json();

        if (!couponId) {
            return NextResponse.json({ message: 'Coupon ID is required.' }, { status: 400 });
        }

        // 🔒 Rate limit check (15 coupon operations per minute)
        const rateLimitCheck = couponLimiter.check(uid, businessId);
        if (!rateLimitCheck.allowed) {
            logAuditEvent({
                actorUid: uid,
                actorRole: userRole,
                action: AUDIT_ACTIONS.RATE_LIMIT_VIOLATION,
                targetUid: null,
                outletId: businessId,
                metadata: {
                    endpoint: 'coupon_delete',
                    limit: '15/min',
                    retryAfter: rateLimitCheck.retryAfter
                },
                source: 'rate_limiter',
                req
            }).catch(err => console.error('[AUDIT_LOG_FAILED]', err));

            return NextResponse.json({
                message: `Too many coupon operations. Please wait ${rateLimitCheck.retryAfter} seconds.`
            }, { status: 429 });
        }

        // Fetch coupon data before deleting for audit log
        const couponRef = firestore.collection(collectionName).doc(businessId).collection('coupons').doc(couponId);
        const couponSnap = await couponRef.get();

        let couponData = {};
        if (couponSnap.exists) {
            couponData = couponSnap.data();
        }

        await couponRef.delete();

        // 🔄 CACHE INVALIDATION: Increment menuVersion to force public API refresh
        await firestore.collection(collectionName).doc(businessId).update({
            menuVersion: FieldValue.increment(1)
        });

        // 🔍 Audit log: COUPON_DELETE (fire-and-forget)
        logAuditEvent({
            actorUid: uid,
            actorRole: userRole,
            action: AUDIT_ACTIONS.COUPON_DELETE,
            targetUid: null,
            outletId: businessId,
            metadata: {
                couponId,
                couponCode: couponData.code || 'N/A',
                discountType: couponData.type || 'N/A',
                discountValue: couponData.value || 0,
                timesUsed: couponData.timesUsed || 0,
                deletedAt: new Date().toISOString()
            },
            source: 'coupons_api',
            req
        }).catch(err => console.error('[AUDIT_LOG_FAILED]', err));

        return NextResponse.json({ message: 'Coupon deleted successfully.' }, { status: 200 });
    } catch (error) {
        console.error("DELETE COUPON ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
