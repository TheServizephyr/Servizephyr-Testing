import { NextResponse } from 'next/server';
import axios from 'axios';
import { getFirestore } from '@/lib/firebase-admin';

// PhonePe API Configuration
// PhonePe API Configuration
const PHONEPE_BASE_URL = process.env.PHONEPE_BASE_URL;
const CLIENT_ID = process.env.PHONEPE_CLIENT_ID;
const CLIENT_SECRET = process.env.PHONEPE_CLIENT_SECRET;
const CLIENT_VERSION = process.env.PHONEPE_CLIENT_VERSION || "1";
const PHONEPE_AUTH_URL = process.env.PHONEPE_AUTH_URL;

export async function POST(req) {
    try {
        const { verifyAdmin } = await import('@/lib/verify-admin');
        await verifyAdmin(req);

        const adminDb = await getFirestore();
        const { orderId, amount, reason } = await req.json();

        if (!orderId || !amount) {
            return NextResponse.json({ error: "Order ID and amount are required" }, { status: 400 });
        }

        // Step 1: Generate OAuth Token
        console.log("[PhonePe Refund] Generating OAuth token...");
        const tokenRequestBody = new URLSearchParams({
            client_id: CLIENT_ID,
            client_version: CLIENT_VERSION,
            client_secret: CLIENT_SECRET,
            grant_type: "client_credentials"
        }).toString();

        const tokenResponse = await axios.post(PHONEPE_AUTH_URL, tokenRequestBody, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        const accessToken = tokenResponse.data.access_token;
        console.log("[PhonePe Refund] OAuth token generated");

        // Step 2: Create Refund Request
        const refundId = `REFUND_${orderId}_${Date.now()}`;
        const amountInPaise = Math.round(amount * 100);

        const refundPayload = {
            merchantRefundId: refundId,
            merchantOrderId: orderId,
            amount: amountInPaise,
            reason: reason || "Customer requested refund"
        };

        console.log("[PhonePe Refund] Refund payload:", JSON.stringify(refundPayload, null, 2));

        const refundResponse = await axios.post(
            `${PHONEPE_BASE_URL}/payments/v2/refund`,
            refundPayload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `O-Bearer ${accessToken}`
                }
            }
        );

        console.log("[PhonePe Refund] Refund response:", JSON.stringify(refundResponse.data, null, 2));

        // Step 3: Update order in Firestore
        const orderRef = adminDb.collection('orders').doc(orderId);
        await orderRef.update({
            refundStatus: 'initiated',
            refundId: refundId,
            refundAmount: amount,
            refundReason: reason || "Customer requested refund",
            refundInitiatedAt: new Date(),
            updatedAt: new Date()
        });

        return NextResponse.json({
            success: true,
            refundId: refundId,
            data: refundResponse.data
        });

    } catch (error) {
        console.error("[PhonePe Refund] Error:", error.response?.data || error.message);
        return NextResponse.json({
            success: false,
            error: error.response?.data || error.message
        }, { status: 500 });
    }
}
