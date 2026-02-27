/**
 * PAYMENT SERVICE
 * 
 * Unified payment gateway orchestrator.
 * Handles Razorpay, PhonePe, and other payment methods.
 * 
 * Phase 5 Stage 3.2
 */

import { RazorpayProvider } from './razorpay.provider';
import { PhonePeProvider } from './phonepe.provider';

export class PaymentService {
    constructor() {
        this.razorpay = new RazorpayProvider();
        this.phonepe = new PhonePeProvider();
    }

    /**
     * Create payment order based on gateway
     * 
     * @param {Object} params
     * @param {string} params.gateway - Payment gateway (razorpay/phonepe)
     * @param {number} params.amount - Amount in rupees
     * @param {string} params.orderId - Firestore order ID
     * @param {Object} params.metadata - Additional metadata
     * @param {Object} params.servizephyrPayload - Payload for webhook (V1 parity)
     */
    async createPaymentOrder({ gateway, amount, orderId, metadata = {}, servizephyrPayload = null }) {
        console.log(`[PaymentService] Creating ${gateway} payment for order ${orderId}`);

        switch (gateway) {
            case 'razorpay':
            case 'online': // Default to Razorpay
                return await this.razorpay.createOrder({
                    amount,
                    orderId,
                    metadata,
                    servizephyrPayload
                });

            case 'phonepe':
                return await this.phonepe.createOrder({
                    amount,
                    orderId,
                    metadata
                });

            default:
                throw new Error(`Unknown payment gateway: ${gateway}`);
        }
    }

    /**
     * Determine payment gateway from request
     */
    determineGateway(paymentMethod) {
        if (paymentMethod === 'phonepe') {
            return 'phonepe';
        }

        if (paymentMethod === 'online' || paymentMethod === 'razorpay') {
            return 'razorpay';
        }

        return null; // Non-online payments (COD, counter)
    }
}

// Singleton export
export const paymentService = new PaymentService();
