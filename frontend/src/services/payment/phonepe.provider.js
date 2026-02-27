/**
 * PHONEPE PROVIDER
 * 
 * Handles PhonePe payment gateway integration.
 * 
 * Phase 5 Step 2.5
 */

export class PhonePeProvider {
    constructor() {
        this.enabled = process.env.PHONEPE_ENABLED === 'true';
    }

    /**
     * Create PhonePe order
     */
    async createOrder({ amount, orderId, metadata = {} }) {
        if (!this.enabled) {
            throw new Error('PhonePe not enabled');
        }

        const phonePeOrderId = `phonepe_${orderId}_${Date.now()}`;

        console.log(`[PhonePeProvider] Creating order for ₹${amount}`);

        return {
            id: phonePeOrderId,
            amount,
            orderId,
            metadata
        };
    }

    /**
     * Verify PhonePe signature
     */
    verifySignature(payload, signature) {
        const crypto = require('crypto');
        const hash = crypto
            .createHash('sha256')
            .update(JSON.stringify(payload))
            .digest('hex');

        return hash === signature;
    }
}
