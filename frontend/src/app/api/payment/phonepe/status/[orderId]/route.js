import { NextResponse } from 'next/server';
import axios from 'axios';
import { checkIpRateLimit } from '@/lib/rateLimiter';
import { getClientIP } from '@/lib/audit-logger';
import { verifyIdToken, getFirestore } from '@/lib/firebase-admin'; // Standardized Auth

// PhonePe API Configuration
const PHONEPE_BASE_URL = process.env.PHONEPE_BASE_URL;
const CLIENT_ID = process.env.PHONEPE_CLIENT_ID;
const CLIENT_SECRET = process.env.PHONEPE_CLIENT_SECRET;
const CLIENT_VERSION = process.env.PHONEPE_CLIENT_VERSION || "1";
const PHONEPE_AUTH_URL = process.env.PHONEPE_AUTH_URL;

export async function GET(req, { params }) {
    try {
        const ip = getClientIP(req);
        // Fail-closed rate limiting for security
        const rateLimit = await checkIpRateLimit(ip, 30);
        if (!rateLimit.allowed) {
            return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
        }

        const { orderId } = params;

        if (!orderId) {
            return NextResponse.json({ error: "Order ID is required" }, { status: 400 });
        }

        // [SECURITY] Step 0: Fetch Order to Validate Permissions & Token Binding
        const adminDb = await getFirestore();
        const orderRef = adminDb.collection('orders').doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) {
            return NextResponse.json({ error: "Order not found" }, { status: 404 });
        }

        const orderData = orderDoc.data();

        // Auth Logic
        const url = new URL(req.url);
        const queryToken = url.searchParams.get('token');

        let isAuthenticated = false;

        // 1. Check Authorization Header (Standard Bearer Token for Logged-in Users)
        const authHeader = req.headers.get('authorization');
        if (authHeader?.startsWith('Bearer ')) {
            try {
                const idToken = authHeader.split('Bearer ')[1];
                const decodedToken = await verifyIdToken(idToken);
                const uid = decodedToken.uid;

                // [STRICT OWNERSHIP CHECK]
                // 1. Customer Check: Is this the user who placed the order?
                // Support legacy orders using 'customerId' instead of 'userId'
                if (orderData.userId === uid || orderData.customerId === uid) {
                    isAuthenticated = true;
                }
                // 2. Privilege Check: Is this an Admin, Manager, or the Business Owner?
                else {
                    const userDoc = await adminDb.collection('users').doc(uid).get();
                    if (userDoc.exists) {
                        const userData = userDoc.data();

                        // Admin Access
                        if (userData.role === 'admin') {
                            isAuthenticated = true;
                        }
                        // Owner/Manager Access: Check if they are associated with the business
                        else if (['owner', 'restaurant-owner', 'shop-owner', 'street-vendor', 'manager'].includes(userData.role)) {
                            // Fetch business to verify ownership
                            // Optimized: Check specific collections based on order metadata if available, or try all relevant ones
                            if (orderData.restaurantId) {
                                const businessId = orderData.restaurantId;

                                // 1. Check direct ownership in business collections
                                const checkOwnership = async (collectionName) => {
                                    const docRef = adminDb.collection(collectionName).doc(businessId);
                                    const docSnap = await docRef.get();
                                    if (docSnap.exists) {
                                        const data = docSnap.data();
                                        return data.ownerId === uid;
                                    }
                                    return false;
                                };

                                // Check in sequence
                                let isAuthorized = await checkOwnership('restaurants');
                                if (!isAuthorized) isAuthorized = await checkOwnership('shops');
                                if (!isAuthorized) isAuthorized = await checkOwnership('street_vendors');

                                // 2. [NEW] Check employee/manager mapping via linkedOutlets
                                // This handles managers who are not the business owners
                                // Hardened: Added shape checks for linkedOutlets array
                                if (!isAuthorized && Array.isArray(userData.linkedOutlets)) {
                                    const matchingOutlet = userData.linkedOutlets.find(outlet =>
                                        outlet?.outletId === businessId && outlet?.status === 'active'
                                    );
                                    if (matchingOutlet) {
                                        isAuthorized = true;
                                    }
                                }

                                if (isAuthorized) {
                                    isAuthenticated = true;
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn(`[PhonePe Status] Invalid Bearer token or Ownership Check Failed for order ${orderId}: ${e.message}`);
            }
        }

        // 2. Check Query Token (Binding Check)
        // Ensure the provided token matches the one in the order (Secure Guest Access)
        if (!isAuthenticated && queryToken) {
            const validTrackingToken = orderData.trackingToken; // Delivery/Pickup
            const validDineInToken = orderData.dineInToken; // Dine-In

            if (queryToken === validTrackingToken || queryToken === validDineInToken) {
                isAuthenticated = true;
            }
        }

        if (!isAuthenticated) {
            console.warn(`[PhonePe Status] Unauthorized access attempt for ${orderId} from IP ${ip}`);
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Step 1: Generate OAuth Token
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

        // Step 2: Check Order Status
        const statusResponse = await axios.get(
            `${PHONEPE_BASE_URL}/checkout/v2/order/${orderId}/status`,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `O-Bearer ${accessToken}`
                }
            }
        );

        // [SECURITY] REDACT SENSITIVE DATA from Logs
        const responseData = statusResponse.data;
        const redactedLog = {
            ...responseData,
            data: {
                ...responseData.data,
                paymentInstrument: responseData.data?.paymentInstrument ? {
                    type: responseData.data.paymentInstrument.type,
                    // Redact card details/UPI handles if present
                    cardType: responseData.data.paymentInstrument.cardType,
                    pgTransactionId: responseData.data.paymentInstrument.pgTransactionId ? 'REDACTED' : undefined,
                    cardDetails: undefined, // Ensure card details are stripped
                    vpa: undefined // Redact UPI ID
                } : undefined
            }
        };

        // Use the redacted log!
        console.log(`[PhonePe Status] Response for ${orderId}:`, JSON.stringify(redactedLog, null, 2));

        const paymentState = statusResponse.data.state;

        // Update Firestore if payment is successful
        if (paymentState === 'COMPLETED' || paymentState === 'PAYMENT_SUCCESS') {
            if (orderData.paymentStatus !== 'paid') {
                const currentStatus = orderData.status;
                const finalStatuses = ['delivered', 'cancelled', 'out_for_delivery', 'preparing', 'ready'];

                const updateData = {
                    paymentStatus: 'paid',
                    paymentMethod: 'phonepe',
                    phonePeOrderId: orderId,
                    updatedAt: new Date()
                };

                // Only set to pending if it's currently in a pre-processing state - prevent reverting 'delivered' orders
                if (!finalStatuses.includes(currentStatus)) {
                    updateData.status = 'pending';
                }

                await orderRef.update(updateData);
                console.log(`[PhonePe Status] Order ${orderId} updated to PAID`);
            }
        }

        // [SECURITY] Redact PII from Client Response as well if needed?
        // Usually the client needs the data. PhonePe status response is generally safe for the payer to see.
        // We pass it through.

        return NextResponse.json({
            success: true,
            data: statusResponse.data
        });

    } catch (error) {
        console.error(`[PhonePe Status] Error for ${params.orderId}:`, error.message); // Don't log full error object if it contains secrets
        return NextResponse.json({
            success: false,
            error: error.message // Generic error check
        }, { status: 500 });
    }
}
