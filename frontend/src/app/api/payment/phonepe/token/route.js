import { NextResponse } from 'next/server';
import axios from 'axios';

// PhonePe OAuth Credentials
// PhonePe OAuth Credentials
const CLIENT_ID = process.env.PHONEPE_CLIENT_ID;
const CLIENT_SECRET = process.env.PHONEPE_CLIENT_SECRET;
const CLIENT_VERSION = process.env.PHONEPE_CLIENT_VERSION || "1";
const PHONEPE_AUTH_URL = process.env.PHONEPE_AUTH_URL;

// In-memory token cache (simple implementation)
let tokenCache = {
    access_token: null,
    expires_at: null
};

export async function GET(req) {
    try {
        // 🔐 SECURITY LOCKDOWN: Prevents leakage of gateway tokens to client
        // This endpoint should only be accessed by server-side processes
        const internalSecret = req.headers.get('x-internal-secret');
        if (internalSecret !== process.env.INTERNAL_API_SECRET) {
            console.error("[PhonePe Token] Unauthorized access attempt - Secret mismatch");
            return NextResponse.json({ success: false, error: "Unauthorized. Internal access only." }, { status: 403 });
        }

        // Check if cached token is still valid
        const now = Math.floor(Date.now() / 1000);
        if (tokenCache.access_token && tokenCache.expires_at && tokenCache.expires_at > now + 60) {
            console.log("[PhonePe Token] Using cached token");
            return NextResponse.json({
                success: true,
                access_token: tokenCache.access_token,
                expires_at: tokenCache.expires_at
            });
        }

        // Generate new token
        console.log("[PhonePe Token] Generating new token...");

        const requestBody = new URLSearchParams({
            client_id: CLIENT_ID,
            client_version: CLIENT_VERSION,
            client_secret: CLIENT_SECRET,
            grant_type: "client_credentials"
        }).toString();

        const response = await axios.post(PHONEPE_AUTH_URL, requestBody, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        const { access_token, expires_at } = response.data;

        // Cache the token
        tokenCache = {
            access_token,
            expires_at
        };

        console.log("[PhonePe Token] New token generated successfully");

        return NextResponse.json({
            success: true,
            access_token,
            expires_at
        });

    } catch (error) {
        console.error("[PhonePe Token] Error:", error.response?.data || error.message);
        return NextResponse.json({
            success: false,
            error: error.response?.data || error.message
        }, { status: 500 });
    }
}
