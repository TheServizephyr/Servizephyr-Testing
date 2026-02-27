import { NextResponse } from 'next/server';
import { getFirestore, FieldValue, getAuth } from '@/lib/firebase-admin';

export async function POST(req) {
    console.log('[Admin Retry] Webhook retry request received');

    try {
        const { verifyAdmin } = await import('@/lib/verify-admin');
        const { uid, userData } = await verifyAdmin(req);
        console.log(`[Admin Retry] Authenticated admin: ${uid}`);

        const { webhookId } = await req.json();

        if (!webhookId) {
            return NextResponse.json({ error: 'Missing webhookId' }, { status: 400 });
        }

        const firestore = await getFirestore();
        const webhookRef = firestore.collection('failed_webhooks').doc(webhookId);

        // TRANSACTION LOCK: Prevent concurrent retries
        let webhookData;
        try {
            webhookData = await firestore.runTransaction(async (transaction) => {
                const snap = await transaction.get(webhookRef);

                if (!snap.exists) {
                    throw new Error('NOT_FOUND');
                }

                const data = snap.data();

                // Already resolved
                if (data.status === 'resolved') {
                    throw new Error('ALREADY_RESOLVED');
                }

                // Already being processed
                if (data.status === 'processing') {
                    throw new Error('ALREADY_PROCESSING');
                }

                // Max retries exceeded
                if (data.retryCount >= 5) {
                    // Mark as dead_letter
                    transaction.update(webhookRef, {
                        status: 'dead_letter',
                        lastTriedAt: FieldValue.serverTimestamp()
                    });
                    throw new Error('MAX_RETRIES');
                }

                // Lock for processing
                transaction.update(webhookRef, {
                    status: 'processing',
                    lastTriedAt: FieldValue.serverTimestamp()
                });

                return data;
            });
        } catch (txError) {
            if (txError.message === 'NOT_FOUND') {
                return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
            }
            if (txError.message === 'ALREADY_RESOLVED') {
                return NextResponse.json({
                    message: 'Webhook already resolved',
                    status: 'resolved'
                });
            }
            if (txError.message === 'ALREADY_PROCESSING') {
                return NextResponse.json({
                    error: 'Webhook is currently being processed by another request',
                    status: 'processing'
                }, { status: 409 });
            }
            if (txError.message === 'MAX_RETRIES') {
                return NextResponse.json({
                    error: 'Max retries exceeded. Marked as dead letter.',
                    status: 'dead_letter'
                }, { status: 400 });
            }
            throw txError;
        }

        // RE-RUN WEBHOOK PROCESSING LOGIC
        console.log(`[Admin Retry] Retrying webhook ${webhookId}, attempt ${webhookData.retryCount + 1}/5`);

        try {
            const payload = webhookData.payload;

            if (!payload || payload.event !== 'payment.captured') {
                throw new Error('Invalid payload or event type');
            }

            const paymentEntity = payload.payload.payment.entity;
            const paymentId = paymentEntity.id;
            const notes = paymentEntity.notes;

            // SAME LOGIC AS WEBHOOK: Check processed_payments, merge order
            const paymentRef = firestore.collection('processed_payments').doc(paymentId);

            await firestore.runTransaction(async (transaction) => {
                const paymentSnap = await transaction.get(paymentRef);

                // Already processed (idempotency protection)
                if (paymentSnap.exists) {
                    console.log(`[Admin Retry] Payment ${paymentId} already processed (idempotent)`);
                    return { alreadyProcessed: true };
                }

                // Process add-on payment
                if (notes && notes.type === 'addon') {
                    const orderId = notes.orderId;
                    const itemsToAdd = JSON.parse(notes.items);
                    const orderRef = firestore.collection('orders').doc(orderId);
                    const orderSnap = await transaction.get(orderRef);

                    if (!orderSnap.exists) {
                        throw new Error('Order not found for add-on');
                    }

                    const orderData = orderSnap.data();

                    // SECURITY: Only merge into pending/awaiting_payment orders
                    const allowedStatuses = ['pending', 'awaiting_payment'];
                    if (!allowedStatuses.includes(orderData.status)) {
                        console.log(`[Admin Retry] Cannot add items. Order status: ${orderData.status}`);
                        throw new Error(`Order status ${orderData.status} not allowed for add-on`);
                    }

                    // MERGE ITEMS
                    const newItems = [...(orderData.items || []), ...itemsToAdd];
                    const newSubtotal = (orderData.subtotal || 0) + (parseFloat(notes.subtotal) || 0);
                    const newCgst = (orderData.cgst || 0) + (parseFloat(notes.cgst) || 0);
                    const newSgst = (orderData.sgst || 0) + (parseFloat(notes.sgst) || 0);
                    const newGrandTotal = (orderData.totalAmount || 0) + (parseFloat(notes.grandTotal) || 0);

                    const paymentDetail = {
                        method: 'razorpay',
                        amount: paymentEntity.amount / 100,
                        razorpay_payment_id: paymentId,
                        razorpay_order_id: paymentEntity.order_id,
                        timestamp: new Date(),
                        status: 'paid',
                        notes: 'Add-on payment (manual retry)'
                    };

                    // UPDATE ORDER
                    transaction.update(orderRef, {
                        items: newItems,
                        subtotal: newSubtotal,
                        cgst: newCgst,
                        sgst: newSgst,
                        totalAmount: newGrandTotal,
                        paymentDetails: FieldValue.arrayUnion(paymentDetail),
                        statusHistory: FieldValue.arrayUnion({
                            status: 'updated',
                            timestamp: new Date(),
                            notes: `Added ${itemsToAdd.length} item(s) via admin retry`
                        })
                    });

                    // MARK PAYMENT AS PROCESSED
                    transaction.set(paymentRef, {
                        processedAt: FieldValue.serverTimestamp(),
                        orderId: orderId,
                        type: 'addon',
                        amount: paymentEntity.amount / 100,
                        razorpayOrderId: paymentEntity.order_id,
                        retriedBy: 'admin'
                    });

                    console.log(`[Admin Retry] Successfully processed add-on for order ${orderId}`);
                }
            });

            // SUCCESS - Mark as resolved
            await webhookRef.update({
                status: 'resolved',
                retryCount: FieldValue.increment(1),
                lastTriedAt: FieldValue.serverTimestamp(),
                resolvedAt: FieldValue.serverTimestamp(),
                resolvedBy: uid
            });

            console.log(`[Admin Retry] Webhook ${webhookId} resolved successfully`);

            return NextResponse.json({
                message: 'Webhook retried and resolved successfully',
                orderId: notes?.orderId || null
            });

        } catch (retryError) {
            console.error(`[Admin Retry] Retry failed for ${webhookId}:`, retryError);

            // RETRY FAILED - Update status back to pending with error
            await webhookRef.update({
                status: 'pending',
                error: retryError.message,
                errorStack: retryError.stack,
                retryCount: FieldValue.increment(1),
                lastTriedAt: FieldValue.serverTimestamp()
            });

            return NextResponse.json({
                error: 'Retry failed',
                details: retryError.message,
                retryCount: webhookData.retryCount + 1
            }, { status: 500 });
        }

    } catch (error) {
        console.error('[Admin Retry] Error:', error);
        return NextResponse.json({
            error: 'Internal server error',
            details: error.message
        }, { status: 500 });
    }
}
