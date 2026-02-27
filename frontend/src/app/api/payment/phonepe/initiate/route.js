import { NextResponse } from 'next/server';
import axios from 'axios';
import { checkIpRateLimit } from '@/lib/rateLimiter';
import { getClientIP } from '@/lib/audit-logger';

// PhonePe API Configuration - Read from env (NO fallbacks to sandbox)
// Updated: 17-Dec-2024 - Production URLs
const PHONEPE_BASE_URL = process.env.PHONEPE_BASE_URL;
const CLIENT_ID = process.env.PHONEPE_CLIENT_ID;
const CLIENT_SECRET = process.env.PHONEPE_CLIENT_SECRET;
const CLIENT_VERSION = process.env.PHONEPE_CLIENT_VERSION || "1";
const PHONEPE_AUTH_URL = process.env.PHONEPE_AUTH_URL;

export async function POST(req) {
    try {
        const ip = getClientIP(req);
        const rateLimit = await checkIpRateLimit(ip, 10); // 10 requests per minute
        if (!rateLimit.allowed) {
            return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
        }

        const { amount, orderId, customerPhone } = await req.json();

        // Debug: Log which config is being used
        console.log("[PhonePe Initiate] Config:", {
            BASE_URL: PHONEPE_BASE_URL,
            AUTH_URL: PHONEPE_AUTH_URL,
            CLIENT_ID: CLIENT_ID ? `${CLIENT_ID.substring(0, 10)}...` : 'NOT SET',
            CLIENT_SECRET: CLIENT_SECRET ? 'SET' : 'NOT SET'
        });

        if (!PHONEPE_BASE_URL || !CLIENT_ID || !CLIENT_SECRET || !PHONEPE_AUTH_URL) {
            console.error("[PhonePe Initiate] Missing PhonePe credentials in env!");
            return NextResponse.json({ error: "PhonePe not configured" }, { status: 500 });
        }

        if (!amount || !orderId) {
            return NextResponse.json({ error: "Amount and Order ID are required" }, { status: 400 });
        }

        // Step 1: Generate OAuth Token
        console.log("[PhonePe Initiate] Generating OAuth token...");
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
        console.log("[PhonePe Initiate] OAuth token generated successfully");

        // Step 2: Create Payment Request (as per PhonePe v2 documentation)
        const amountInPaise = Math.round(amount * 100);
        // Redirect URL for fallback mode (if IFrame fails) - use tracking page
        const redirectUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'https://www.servizephyr.com'}/track/${orderId}?payment_status=success`;

        const paymentPayload = {
            merchantOrderId: orderId,
            amount: amountInPaise,
            expireAfter: 1200, // 20 minutes
            paymentFlow: {
                type: "PG_CHECKOUT",
                message: "Payment for your order",
                merchantUrls: {
                    redirectUrl: redirectUrl
                }
            }
        };

        console.log("[PhonePe Initiate] Payment payload:", JSON.stringify(paymentPayload, null, 2));

        // Step 3: Call PhonePe Payment API (v2 checkout endpoint)
        const paymentResponse = await axios.post(
            `${PHONEPE_BASE_URL}/checkout/v2/pay`,
            paymentPayload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `O-Bearer ${accessToken}`
                }
            }
        );

        console.log("[PhonePe Initiate] Payment response:", JSON.stringify(paymentResponse.data, null, 2));

        // Step 4: Return redirect URL
        if (paymentResponse.data.redirectUrl) {
            return NextResponse.json({
                success: true,
                url: paymentResponse.data.redirectUrl,
                orderId: paymentResponse.data.orderId,
                state: paymentResponse.data.state
            });
        } else {
            throw new Error("No redirect URL in response");
        }

    } catch (error) {
        console.error("[PhonePe Initiate] Error:", error.response?.data || error.message);
        return NextResponse.json({
            success: false,
            error: error.response?.data || error.message
        }, { status: 500 });
    }
}
