/**
 * RAZORPAY PROVIDER
 * 
 * Handles Razorpay payment gateway integration.
 * Stage 3: V1 parity with servizephyr_payload for webhook compatibility.
 * 
 * Phase 5 Stage 3.2
 */

import Razorpay from 'razorpay';

export class RazorpayProvider {
    constructor() {
        if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
            console.warn('[RazorpayProvider] Credentials not configured');
            this.client = null;
        } else {
            this.client = new Razorpay({
                key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
                key_secret: process.env.RAZORPAY_KEY_SECRET,
            });
        }
    }

    /**
     * Create Razorpay order with V1 parity
     * 
     * CRITICAL: Must include servizephyr_payload in notes for webhook compatibility
     */
    async createOrder({ amount, orderId, metadata = {}, servizephyrPayload = null }) {
        if (!this.client) {
            throw new Error('Razorpay not configured');
        }

        const notes = {
            ...metadata,
            firestore_order_id: orderId
        };

        // CRITICAL: Add servizephyr_payload for webhook (V1 parity)
        if (servizephyrPayload) {
            notes.servizephyr_payload = JSON.stringify(servizephyrPayload);
        }

        const options = {
            amount: Math.round(amount * 100), // Convert to paise
            currency: 'INR',
            receipt: orderId,
            notes
        };

        console.log(`[RazorpayProvider] Creating order for ₹${amount}, orderId: ${orderId}`);
        const razorpayOrder = await this.client.orders.create(options);

        console.log(`[RazorpayProvider] Order created: ${razorpayOrder.id}`);
        return {
            id: razorpayOrder.id,
            amount: razorpayOrder.amount / 100, // Convert back to rupees
            currency: razorpayOrder.currency,
            receipt: razorpayOrder.receipt,
            status: razorpayOrder.status
        };
    }

    /**
     * Verify payment signature
     */
    verifySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature) {
        const crypto = require('crypto');
        const text = `${razorpayOrderId}|${razorpayPaymentId}`;
        const signature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(text)
            .digest('hex');

        return signature === razorpaySignature;
    }
}
