import { createHash } from 'crypto';
import { NextResponse } from 'next/server';

import { FieldValue, getFirestore } from '@/lib/firebase-admin';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';
import { PERMISSIONS } from '@/lib/permissions';

const toAmount = (value, fallback = 0) => {
    const amount = Number(value);
    return Number.isFinite(amount) && amount >= 0 ? amount : fallback;
};

const normalizePhone = (phone) => {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return '';
    return digits.length >= 10 ? digits.slice(-10) : digits;
};

const sanitizeText = (value, fallback = '') => String(value || fallback).trim();
const toLowerText = (value) => String(value || '').toLowerCase();
const isSettlementEligible = (printedVia) => printedVia !== 'create_order';

const normalizeItem = (item, index) => {
    const quantity = Math.max(1, parseInt(item?.quantity, 10) || 1);
    const unitPrice = toAmount(item?.price ?? item?.portion?.price, 0);
    const totalPrice = toAmount(item?.totalPrice, unitPrice * quantity);

    return {
        id: item?.id || `manual-item-${index + 1}`,
        name: sanitizeText(item?.name, 'Custom Item'),
        quantity,
        price: unitPrice,
        totalPrice,
        categoryId: sanitizeText(item?.categoryId, 'manual'),
        portionName: sanitizeText(item?.portion?.name || item?.portionName || '', ''),
    };
};

const timestampToDate = (value) => {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value?.toDate === 'function') {
        const converted = value.toDate();
        return converted instanceof Date && !Number.isNaN(converted.getTime()) ? converted : null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const buildHistoryQuery = (historyRef, fromDate, toDate, maxRecords) => {
    let query = historyRef.orderBy('printedAt', 'desc');
    if (fromDate) query = query.where('printedAt', '>=', fromDate);
    if (toDate) query = query.where('printedAt', '<=', toDate);
    return query.limit(maxRecords);
};

const buildFingerprint = ({ businessId, phone, items, totalAmount }) => {
    const normalizedItems = (items || [])
        .map((item) => `${item.id}:${item.quantity}:${Number(item.totalPrice || 0).toFixed(2)}`)
        .sort()
        .join('|');

    const signature = `${businessId}|${phone}|${Number(totalAmount || 0).toFixed(2)}|${normalizedItems}`;
    return createHash('sha256').update(signature).digest('hex').slice(0, 32);
};

async function resolveCustomerIdentity(firestore, normalizedPhone) {
    if (!normalizedPhone) {
        return {
            customerType: 'guest',
            customerId: null,
        };
    }

    const usersRef = firestore.collection('users');
    const candidatePhones = [normalizedPhone, `+91${normalizedPhone}`];

    for (const candidate of candidatePhones) {
        const snap = await usersRef.where('phone', '==', candidate).limit(1).get();
        if (!snap.empty) {
            return {
                customerType: 'uid',
                customerId: snap.docs[0].id,
            };
        }
    }

    return {
        customerType: 'guest',
        customerId: normalizedPhone,
    };
}

export async function POST(req) {
    try {
        const context = await verifyOwnerWithAudit(
            req,
            'custom_bill_save_history',
            {},
            false,
            [PERMISSIONS.CREATE_ORDER]
        );

        const { businessId, collectionName, uid, adminId = null } = context;
        const firestore = await getFirestore();
        const body = await req.json();

        const customerDetails = body?.customerDetails || {};
        const rawItems = Array.isArray(body?.items) ? body.items : [];
        const billDetails = body?.billDetails || {};

        if (rawItems.length === 0) {
            return NextResponse.json({ message: 'At least one item is required for bill history.' }, { status: 400 });
        }

        const items = rawItems.map(normalizeItem);
        const subtotalFromItems = items.reduce((sum, item) => sum + toAmount(item.totalPrice), 0);
        const subtotal = toAmount(billDetails?.subtotal, subtotalFromItems);
        const cgst = toAmount(billDetails?.cgst, 0);
        const sgst = toAmount(billDetails?.sgst, 0);
        const deliveryCharge = toAmount(billDetails?.deliveryCharge, 0);
        const totalAmount = toAmount(billDetails?.grandTotal, subtotal + cgst + sgst + deliveryCharge);

        const customerName = sanitizeText(customerDetails?.name, 'Walk-in Customer') || 'Walk-in Customer';
        const customerAddress = sanitizeText(customerDetails?.address, '');
        const customerPhone = normalizePhone(customerDetails?.phone);

        const billDraftId = sanitizeText(body?.billDraftId, '');
        const printedViaRaw = sanitizeText(body?.printedVia, '').toLowerCase();
        const printedVia = ['browser', 'direct_usb', 'create_order'].includes(printedViaRaw)
            ? printedViaRaw
            : 'browser';
        const settlementEligible = isSettlementEligible(printedVia);

        const historyRef = firestore
            .collection(collectionName)
            .doc(businessId)
            .collection('custom_bill_history');

        if (billDraftId) {
            const duplicateSnap = await historyRef.where('billDraftId', '==', billDraftId).limit(1).get();
            if (!duplicateSnap.empty) {
                const duplicateDoc = duplicateSnap.docs[0];
                return NextResponse.json({
                    message: 'Bill history already saved.',
                    duplicateRequest: true,
                    historyId: duplicateDoc.id,
                });
            }
        }

        const { customerType, customerId } = await resolveCustomerIdentity(firestore, customerPhone);
        const fingerprint = buildFingerprint({
            businessId,
            phone: customerPhone || 'na',
            items,
            totalAmount,
        });

        const docRef = historyRef.doc();
        await docRef.set({
            historyId: docRef.id,
            billDraftId: billDraftId || null,
            source: 'offline_counter',
            channel: 'custom_bill',
            printedVia,
            fingerprint,
            businessId,
            ownerId: uid,
            actorUid: adminId || uid,
            customerName,
            customerPhone: customerPhone || null,
            customerAddress: customerAddress || null,
            customerType,
            customerId: customerId || null,
            itemCount: items.length,
            items,
            subtotal,
            cgst,
            sgst,
            deliveryCharge,
            totalAmount,
            settlementEligible,
            isSettled: false,
            settledAt: null,
            settledByUid: null,
            settledByRole: null,
            settlementBatchId: null,
            createdAt: FieldValue.serverTimestamp(),
            printedAt: FieldValue.serverTimestamp(),
        });

        return NextResponse.json({
            message: 'Bill history saved successfully.',
            historyId: docRef.id,
            duplicateRequest: false,
        });
    } catch (error) {
        console.error('[Custom Bill History] Error:', error);
        return NextResponse.json(
            { message: `Backend Error: ${error.message}` },
            { status: error.status || 500 }
        );
    }
}

export async function GET(req) {
    try {
        const context = await verifyOwnerWithAudit(
            req,
            'custom_bill_view_history',
            {},
            false,
            [PERMISSIONS.VIEW_ORDERS, PERMISSIONS.CREATE_ORDER]
        );

        const { businessId, collectionName } = context;
        const firestore = await getFirestore();
        const url = new URL(req.url);

        const fromParam = sanitizeText(url.searchParams.get('from'), '');
        const toParam = sanitizeText(url.searchParams.get('to'), '');
        const search = toLowerText(url.searchParams.get('search') || '');
        const maxRecords = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 200));

        const fromDate = fromParam ? new Date(fromParam) : null;
        const toDate = toParam ? new Date(toParam) : null;
        if (fromDate) fromDate.setHours(0, 0, 0, 0);
        if (toDate) toDate.setHours(23, 59, 59, 999);

        const historyRef = firestore
            .collection(collectionName)
            .doc(businessId)
            .collection('custom_bill_history');

        let snapshot;
        try {
            snapshot = await buildHistoryQuery(historyRef, fromDate, toDate, maxRecords).get();
        } catch (queryError) {
            // Fallback to legacy path so history remains available even if a query/index issue occurs.
            snapshot = await historyRef
                .orderBy('printedAt', 'desc')
                .limit(maxRecords)
                .get();
        }

        let totalAmount = 0;
        let totalBills = 0;
        let pendingSettlementAmount = 0;
        let pendingSettlementBills = 0;
        let settledAmount = 0;
        let settledBills = 0;
        const history = [];

        snapshot.forEach((doc) => {
            const data = doc.data() || {};
            const printedAt = timestampToDate(data.printedAt) || timestampToDate(data.createdAt);

            if (fromDate && printedAt && printedAt < fromDate) return;
            if (toDate && printedAt && printedAt > toDate) return;

            const itemNames = Array.isArray(data.items)
                ? data.items.map((item) => sanitizeText(item?.name, '')).join(' ')
                : '';

            if (search) {
                const haystack = [
                    sanitizeText(data.historyId, doc.id),
                    sanitizeText(data.billDraftId, ''),
                    sanitizeText(data.customerName, ''),
                    sanitizeText(data.customerPhone, ''),
                    sanitizeText(data.customerAddress, ''),
                    sanitizeText(data.customerId, ''),
                    itemNames,
                ]
                    .join(' ')
                    .toLowerCase();

                if (!haystack.includes(search)) return;
            }

            const amount = toAmount(data.totalAmount, 0);
            totalAmount += amount;
            totalBills += 1;

            const printedVia = data.printedVia || 'browser';
            const settlementEligible = data.settlementEligible ?? isSettlementEligible(printedVia);
            const isSettled = settlementEligible ? !!data.isSettled : false;
            if (settlementEligible) {
                if (isSettled) {
                    settledAmount += amount;
                    settledBills += 1;
                } else {
                    pendingSettlementAmount += amount;
                    pendingSettlementBills += 1;
                }
            }

            history.push({
                id: doc.id,
                historyId: data.historyId || doc.id,
                billDraftId: data.billDraftId || null,
                source: data.source || 'offline_counter',
                channel: data.channel || 'custom_bill',
                printedVia,
                customerName: data.customerName || 'Walk-in Customer',
                customerPhone: data.customerPhone || null,
                customerAddress: data.customerAddress || null,
                customerType: data.customerType || 'guest',
                customerId: data.customerId || null,
                settlementEligible,
                isSettled,
                settledAt: timestampToDate(data.settledAt)?.toISOString() || null,
                settledByUid: data.settledByUid || null,
                settledByRole: data.settledByRole || null,
                settlementBatchId: data.settlementBatchId || null,
                subtotal: toAmount(data.subtotal, 0),
                cgst: toAmount(data.cgst, 0),
                sgst: toAmount(data.sgst, 0),
                deliveryCharge: toAmount(data.deliveryCharge, 0),
                totalAmount: amount,
                itemCount: Number(data.itemCount || (Array.isArray(data.items) ? data.items.length : 0)),
                items: Array.isArray(data.items) ? data.items : [],
                printedAt: printedAt ? printedAt.toISOString() : null,
                createdAt: timestampToDate(data.createdAt)?.toISOString() || null,
            });
        });

        return NextResponse.json({
            history,
            summary: {
                totalBills,
                totalAmount,
                avgBillValue: totalBills > 0 ? totalAmount / totalBills : 0,
                pendingSettlementAmount,
                pendingSettlementBills,
                settledAmount,
                settledBills,
            },
        });
    } catch (error) {
        console.error('[Custom Bill History][GET] Error:', error);
        return NextResponse.json(
            { message: `Backend Error: ${error.message}` },
            { status: error.status || 500 }
        );
    }
}

export async function PATCH(req) {
    try {
        const context = await verifyOwnerWithAudit(
            req,
            'custom_bill_settle_history',
            {},
            false,
            [PERMISSIONS.MANUAL_BILLING.WRITE, PERMISSIONS.CREATE_ORDER]
        );

        const { businessId, collectionName, uid, callerRole, adminId = null } = context;
        const firestore = await getFirestore();
        const body = await req.json();

        const action = sanitizeText(body?.action, '').toLowerCase();
        const historyIds = Array.isArray(body?.historyIds)
            ? [...new Set(body.historyIds.map((id) => sanitizeText(id, '')).filter(Boolean))]
            : [];

        if (action !== 'settle') {
            return NextResponse.json({ message: 'Unsupported action.' }, { status: 400 });
        }
        if (historyIds.length === 0) {
            return NextResponse.json({ message: 'At least one bill ID is required.' }, { status: 400 });
        }
        if (historyIds.length > 500) {
            return NextResponse.json({ message: 'You can settle up to 500 bills in one request.' }, { status: 400 });
        }

        const historyRef = firestore
            .collection(collectionName)
            .doc(businessId)
            .collection('custom_bill_history');

        const nowIso = new Date().toISOString();
        const actorUid = adminId || uid;
        const settlementBatchId = createHash('sha256')
            .update(`${businessId}|${historyIds.sort().join('|')}|${nowIso}`)
            .digest('hex')
            .slice(0, 16);

        const docs = await Promise.all(historyIds.map((id) => historyRef.doc(id).get()));
        const batch = firestore.batch();
        let settledCount = 0;
        let settledAmount = 0;
        let skippedCount = 0;

        docs.forEach((docSnap) => {
            if (!docSnap.exists) {
                skippedCount += 1;
                return;
            }

            const data = docSnap.data() || {};
            const printedVia = data.printedVia || 'browser';
            const settlementEligible = data.settlementEligible ?? isSettlementEligible(printedVia);
            if (!settlementEligible || data.isSettled) {
                skippedCount += 1;
                return;
            }

            settledCount += 1;
            settledAmount += toAmount(data.totalAmount, 0);
            batch.update(docSnap.ref, {
                settlementEligible: true,
                isSettled: true,
                settledAt: FieldValue.serverTimestamp(),
                settledByUid: actorUid,
                settledByRole: callerRole || null,
                settlementBatchId,
            });
        });

        if (settledCount > 0) {
            await batch.commit();
        }

        return NextResponse.json({
            message: settledCount > 0
                ? `${settledCount} bill(s) settled successfully.`
                : 'No pending manual bills were eligible for settlement.',
            settledCount,
            settledAmount,
            skippedCount,
            settlementBatchId: settledCount > 0 ? settlementBatchId : null,
        });
    } catch (error) {
        console.error('[Custom Bill History][PATCH] Error:', error);
        return NextResponse.json(
            { message: `Backend Error: ${error.message}` },
            { status: error.status || 500 }
        );
    }
}
