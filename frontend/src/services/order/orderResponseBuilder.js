/**
 * ORDER RESPONSE BUILDER
 * 
 * CRITICAL: Response contract safety
 * 
 * This ensures V2 returns EXACTLY the same response structure as V1.
 * Any deviation breaks frontend compatibility.
 * 
 * Phase 5 Step 2.6
 */

import { NextResponse } from 'next/server';

/**
 * Build COD/Counter order success response
 * 
 * V1 Contract:
 * {
 *   message: string,
 *   order_id: string,
 *   firestore_order_id: string,
 *   token: string,
 *   dineInTabId?: string,
 *   tableId?: string,
 *   dineInToken?: string
 * }
 */
export function buildCODResponse({ orderId, token, dineInTabId, tableId, dineInToken }) {
    const response = {
        message: 'Order created successfully.',
        order_id: orderId,
        firestore_order_id: orderId,
        token: token
    };

    // Optional fields (dine-in)
    if (dineInTabId) response.dineInTabId = dineInTabId;
    if (tableId) response.tableId = tableId;
    if (dineInToken) response.dineInToken = dineInToken;

    return NextResponse.json(response, { status: 200 });
}

/**
 * Build Razorpay order response
 * 
 * V1 Contract:
 * {
 *   message: string,
 *   razorpay_order_id: string,
 *   firestore_order_id: string,
 *   token: string
 * }
 */
export function buildRazorpayResponse({ razorpayOrderId, orderId, token, dineInToken, dineInTabId }) {
    const response = {
        message: 'Razorpay order created. Awaiting payment confirmation.',
        razorpay_order_id: razorpayOrderId,
        firestore_order_id: orderId,
        token: token
    };

    if (dineInToken) response.dineInToken = dineInToken;
    if (dineInTabId) response.dineInTabId = dineInTabId;

    return NextResponse.json(response, { status: 200 });
}

/**
 * Build PhonePe order response
 * 
 * V1 Contract:
 * {
 *   message: string,
 *   phonepe_order_id: string,
 *   firestore_order_id: string,
 *   token: string,
 *   amount: number
 * }
 */
export function buildPhonePeResponse({ phonePeOrderId, orderId, token, amount, dineInToken, dineInTabId }) {
    const response = {
        message: 'PhonePe order created. Awaiting payment.',
        phonepe_order_id: phonePeOrderId,
        firestore_order_id: orderId,
        token: token,
        amount: amount
    };

    if (dineInToken) response.dineInToken = dineInToken;
    if (dineInTabId) response.dineInTabId = dineInTabId;

    return NextResponse.json(response, { status: 200 });
}

/**
 * Build add-on order success response
 * 
 * V1 Contract:
 * {
 *   message: string,
 *   order_id: string,
 *   firestore_order_id: string,
 *   token: string
 * }
 */
export function buildAddonResponse({ orderId, token }) {
    return NextResponse.json({
        message: 'Items added to your existing order successfully!',
        order_id: orderId,
        firestore_order_id: orderId,
        token: token
    }, { status: 200 });
}

/**
 * Build split bill response
 * 
 * V1 Contract:
 * {
 *   message: string,
 *   firestore_order_id: string,
 *   token: string,
 *   pendingItems?: array,
 *   pendingSubtotal?: number,
 *   ...
 * }
 */
export function buildSplitBillResponse({ orderId, token, pendingData }) {
    const response = {
        message: 'Split bill order initialized.',
        firestore_order_id: orderId,
        token: token
    };

    // Add pending data if exists
    if (pendingData) {
        Object.assign(response, pendingData);
    }

    return NextResponse.json(response, { status: 200 });
}

/**
 * Build error response
 */
export function buildErrorResponse({ message, code, status = 400 }) {
    const response = { message };
    if (code) response.error = code;

    return NextResponse.json(response, { status });
}

/**
 * Build dine-in post-paid response
 * 
 * V1 Contract:
 * {
 *   message: string,
 *   order_id: string,
 *   dineInToken: string,
 *   whatsappNumber: string,
 *   token: string
 * }
 */
export function buildDineInPostPaidResponse({ orderId, dineInToken, whatsappNumber, token }) {
    return NextResponse.json({
        message: 'Order placed successfully!',
        order_id: orderId,
        dineInToken: dineInToken,
        whatsappNumber: whatsappNumber,
        token: token
    }, { status: 200 });
}
