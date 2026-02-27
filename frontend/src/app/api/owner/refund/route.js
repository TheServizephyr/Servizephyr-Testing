import { NextResponse } from 'next/server';
import Razorpay from 'razorpay';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';
import { logAuditEvent, AUDIT_ACTIONS } from '@/lib/security/audit-log';
import { refundLimiter } from '@/lib/security/rate-limiter';

export const dynamic = 'force-dynamic';

/**
 * POST /api/owner/refund
 * Process refund for an order (full or partial)
 */
export async function POST(req) {
    console.log('[API /owner/refund] POST request received');

    try {
        const firestore = await getFirestore();
        const body = await req.json();

        const {
            orderId,
            refundType, // 'full' or 'partial'
            items = [], // for partial refund
            reason,
            notes
        } = body;

        console.log(`[API /owner/refund] Processing ${refundType} refund for order: ${orderId}`);

        // Validate input
        if (!orderId || !refundType || !reason) {
            return NextResponse.json({
                message: 'Missing required fields: orderId, refundType, reason'
            }, { status: 400 });
        }

        if (refundType === 'partial' && (!items || items.length === 0)) {
            return NextResponse.json({
                message: 'Items array required for partial refund'
            }, { status: 400 });
        }

        // Verify owner and log action
        const { businessId, uid: actorUid } = await verifyOwnerWithAudit(
            req,
            `${refundType}_refund`,
            { orderId, refundType, itemCount: items.length, reason }
        );

        // 🔒 CRITICAL: Rate limit check (5 refunds per minute - highest risk)
        const rateLimitCheck = refundLimiter.check(actorUid, businessId);
        if (!rateLimitCheck.allowed) {
            // Log rate limit violation
            logAuditEvent({
                actorUid,
                actorRole: 'owner',
                action: AUDIT_ACTIONS.RATE_LIMIT_VIOLATION,
                targetUid: null,
                outletId: businessId,
                metadata: {
                    endpoint: 'refund',
                    limit: '5/min',
                    retryAfter: rateLimitCheck.retryAfter
                },
                source: 'rate_limiter',
                req
            }).catch(err => console.error('[AUDIT_LOG_FAILED]', err));

            return NextResponse.json({
                message: `Rate limit exceeded for refunds. This is a security measure to prevent abuse. Please wait ${rateLimitCheck.retryAfter} seconds before trying again.`
            }, {
                status: 429,
                headers: { 'Retry-After': rateLimitCheck.retryAfter.toString() }
            });
        }

        // Get order details
        const orderRef = firestore.collection('orders').doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) {
            return NextResponse.json({ message: 'Order not found' }, { status: 404 });
        }

        const orderData = orderDoc.data();

        // Verify order belongs to this business
        if (orderData.restaurantId !== businessId) {
            return NextResponse.json({
                message: 'Access denied: Order does not belong to this business'
            }, { status: 403 });
        }

        // Check if order is already refunded
        if (orderData.refundStatus === 'completed') {
            return NextResponse.json({
                message: 'Order has already been fully refunded'
            }, { status: 400 });
        }

        // Check if order is in valid status for refund
        const validStatuses = ['completed', 'delivered', 'cancelled'];
        if (!validStatuses.includes(orderData.status)) {
            return NextResponse.json({
                message: `Cannot refund order with status: ${orderData.status}. Order must be completed, delivered, or cancelled.`
            }, { status: 400 });
        }

        // Check refund time limit (7 days)
        const orderDate = orderData.orderDate?.toDate ? orderData.orderDate.toDate() : new Date(orderData.orderDate);
        const daysSinceOrder = (Date.now() - orderDate.getTime()) / (1000 * 60 * 60 * 24);

        if (daysSinceOrder > 7) {
            return NextResponse.json({
                message: 'Refund period expired. Refunds are only allowed within 7 days of order.'
            }, { status: 400 });
        }

        // Get payment details
        const paymentDetails = orderData.paymentDetails;
        if (!paymentDetails || paymentDetails.length === 0) {
            return NextResponse.json({
                message: 'No payment information found for this order'
            }, { status: 400 });
        }

        // Get ALL Razorpay payments (for split payment support where multiple users paid)
        const razorpayPayments = paymentDetails.filter(p => p.method === 'razorpay' && p.razorpay_payment_id);
        if (razorpayPayments.length === 0) {
            return NextResponse.json({
                message: 'No Razorpay payment found. Only online payments can be refunded.'
            }, { status: 400 });
        }

        // Sum all online payment amounts (for split payments)
        const onlinePaymentAmount = razorpayPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

        // For refund processing, we'll use the first payment ID
        // (In future, we might need to refund each payment separately for split orders)
        const paymentId = razorpayPayments[0].razorpay_payment_id;

        // Calculate refund amount
        let refundAmount = 0;

        // First, calculate already refunded amount from refundedItems
        const refundedItemIds = orderData.refundedItems || [];
        let alreadyRefundedFromItems = 0;

        if (refundedItemIds.length > 0) {
            const orderItems = orderData.items || [];
            refundedItemIds.forEach(itemId => {
                const item = orderItems.find(i => (i.id || i.name) === itemId);
                if (item) {
                    let itemPrice = item.totalPrice || item.price || 0;
                    const itemQty = item.quantity || item.qty || 1;
                    alreadyRefundedFromItems += itemPrice * itemQty;
                }
            });
        }

        // Use the calculated amount or fallback to stored refundAmount
        const actuallyAlreadyRefunded = refundedItemIds.length > 0 ? alreadyRefundedFromItems : (orderData.refundAmount || 0);

        if (refundType === 'full') {
            // Refund remaining online payment amount (total - already refunded)
            refundAmount = Math.max(0, onlinePaymentAmount - actuallyAlreadyRefunded);
        } else if (refundType === 'partial') {
            // Calculate amount for selected items
            const orderItems = orderData.items || [];
            let itemsTotal = items.reduce((sum, itemId) => {
                const item = orderItems.find(i => i.id === itemId || i.name === itemId);
                if (item) {
                    // Use totalPrice (includes portion + addons) or fallback to price
                    const itemPrice = item.totalPrice || item.price || 0;
                    const itemQty = item.quantity || item.qty || 1;
                    return sum + (itemPrice * itemQty);
                }
                return sum;
            }, 0);

            // Add proportional tax
            const subtotal = orderData.subtotal || orderData.totalAmount || 0;
            const taxAmount = (orderData.totalAmount || 0) - subtotal;
            const taxRatio = subtotal > 0 ? taxAmount / subtotal : 0;
            itemsTotal += (itemsTotal * taxRatio);

            // Cap partial refund to online payment amount
            refundAmount = Math.min(itemsTotal, onlinePaymentAmount);
        }

        // Validate refund amount
        if (refundAmount <= 0) {
            return NextResponse.json({
                message: 'Invalid refund amount calculated'
            }, { status: 400 });
        }

        // Calculate actual already refunded amount from refundedItems (more reliable than refundAmount field)
        const refundedItems = orderData.refundedItems || [];
        let actualRefundedAmount = 0;

        if (refundedItems.length > 0) {
            const orderItems = orderData.items || [];
            refundedItems.forEach(itemId => {
                const item = orderItems.find(i => (i.id || i.name) === itemId);
                if (item) {
                    let itemPrice = item.totalPrice || item.price || 0;
                    const itemQty = item.quantity || item.qty || 1;
                    actualRefundedAmount += itemPrice * itemQty;
                }
            });
        } else {
            actualRefundedAmount = orderData.refundAmount || 0;
        }

        const maxRefundable = onlinePaymentAmount - actualRefundedAmount;

        if (refundAmount > maxRefundable) {
            return NextResponse.json({
                message: `Refund amount (₹${refundAmount.toFixed(2)}) exceeds remaining refundable amount (₹${maxRefundable.toFixed(2)})`
            }, { status: 400 });
        }

        // Initialize Razorpay
        if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
            console.error('CRITICAL: Razorpay credentials not configured');
            return NextResponse.json({
                message: 'Payment gateway not configured'
            }, { status: 500 });
        }

        const razorpay = new Razorpay({
            key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET,
        });

        // Process refund via Razorpay - handle multiple payments for split orders
        console.log(`[API /owner/refund] Processing Razorpay refund for ${razorpayPayments.length} payment(s), Total: ₹${refundAmount}`);

        let remainingRefund = refundAmount;
        const refundResults = [];

        // Refund each payment separately (for split payment support)
        for (const payment of razorpayPayments) {
            if (remainingRefund <= 0) break;

            // Calculate how much to refund from this specific payment
            const refundForThisPayment = Math.min(payment.amount, remainingRefund);

            try {
                console.log(`[API /owner/refund] Refunding ₹${refundForThisPayment} from payment ${payment.razorpay_payment_id}`);

                const refundData = await razorpay.payments.refund(payment.razorpay_payment_id, {
                    amount: Math.round(refundForThisPayment * 100), // Convert to paise
                    speed: 'normal', // Normal refund - no balance required, processes in 5-7 days
                    notes: {
                        orderId,
                        reason,
                        refundType,
                        notes: notes || '',
                        splitPayment: razorpayPayments.length > 1,
                        paymentIndex: razorpayPayments.indexOf(payment) + 1,
                        totalPayments: razorpayPayments.length
                    }
                });

                refundResults.push({
                    paymentId: payment.razorpay_payment_id,
                    refundId: refundData.id,
                    amount: refundForThisPayment,
                    status: refundData.status,
                    created_at: refundData.created_at
                });

                remainingRefund -= refundForThisPayment;
                console.log(`[API /owner/refund] Refund successful: ${refundData.id}, Remaining: ₹${remainingRefund}`);

            } catch (error) {
                console.error(`[API /owner/refund] Failed to refund payment ${payment.razorpay_payment_id}:`, error);
                // Continue with next payment even if one fails
            }
        }

        // Check if all refunds were successful
        if (refundResults.length === 0) {
            return NextResponse.json({
                message: 'All refund attempts failed. Please try again or contact support.'
            }, { status: 500 });
        }

        const totalRefundedFromRazorpay = refundResults.reduce((sum, r) => sum + r.amount, 0);

        console.log(`[API /owner/refund] Razorpay refund successful: ${refundResults.length} payment(s) refunded, Total: ₹${totalRefundedFromRazorpay}`);

        // Update order in Firestore
        const totalRefunded = actuallyAlreadyRefunded + totalRefundedFromRazorpay;
        const isFullyRefunded = totalRefunded >= (orderData.totalAmount || 0);

        const updateData = {
            refundStatus: isFullyRefunded ? 'completed' : 'partial',
            refundAmount: totalRefunded,
            refundReason: reason,
            refundDate: FieldValue.serverTimestamp(),
            refundIds: refundResults.map(r => r.refundId),
            partiallyRefunded: !isFullyRefunded,
            refundedItems: refundType === 'partial' ? FieldValue.arrayUnion(...items) : [],
            updatedAt: FieldValue.serverTimestamp()
        };

        await orderRef.update(updateData);

        // Create refund records for each payment
        for (const result of refundResults) {
            const refundRecord = {
                refundId: result.refundId,
                orderId,
                paymentId: result.paymentId,
                amount: result.amount,
                currency: 'INR',
                status: result.status,
                refundType,
                reason,
                notes: notes || '',
                vendorId: businessId,
                customerId: orderData.customerId || orderData.userId,
                items: refundType === 'partial' ? items : [],
                createdAt: FieldValue.serverTimestamp(),
                processedAt: result.created_at ? new Date(result.created_at * 1000) : FieldValue.serverTimestamp()
            };

            await firestore.collection('refunds').doc(result.refundId).set(refundRecord);
        }

        console.log(`[API /owner/refund] Refund completed successfully: ${refundResults.length} refund(s) created`);

        // 🔍 Audit log: ORDER_REFUND (fire-and-forget)
        // Use actorUid from earlier verifyOwnerWithAudit call

        logAuditEvent({
            actorUid,
            actorRole: 'owner', // Refunds only allowed by owners
            action: AUDIT_ACTIONS.ORDER_REFUND,
            targetUid: orderData.customerId || orderData.userId || null,
            outletId: businessId,
            metadata: {
                orderId,
                refundType, // 'full' or 'partial'
                refundAmount: totalRefundedFromRazorpay,
                reason,
                refundIds: refundResults.map(r => r.refundId),
                itemsRefunded: refundType === 'partial' ? items : 'all',
                customerName: orderData.name || orderData.customerName || 'N/A',
                processedAt: new Date().toISOString()
            },
            source: 'refund_api',
            req
        }).catch(err => console.error('[AUDIT_LOG_FAILED]', err));

        // TODO: Send notification to customer
        // await sendRefundNotification(orderData.customerId, totalRefundedFromRazorpay, refundResults[0].refundId);

        return NextResponse.json({
            success: true,
            message: `Refund of ₹${totalRefundedFromRazorpay.toFixed(2)} processed successfully`,
            refundIds: refundResults.map(r => r.refundId),
            amount: totalRefundedFromRazorpay,
            status: refundResults[0].status,
            expectedCreditDays: '5-7 working days'
        }, { status: 200 });

    } catch (error) {
        console.error('[API /owner/refund] Error:', error);

        // Handle Razorpay specific errors
        if (error.error && error.error.description) {
            return NextResponse.json({
                message: `Refund failed: ${error.error.description}`
            }, { status: 400 });
        }

        return NextResponse.json({
            message: `Backend Error: ${error.message}`
        }, { status: error.status || 500 });
    }
}
