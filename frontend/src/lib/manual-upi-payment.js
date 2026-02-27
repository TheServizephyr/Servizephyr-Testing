import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { generateUpiQrCardPngBuffer } from '@/lib/upi-qr-card-image';
import { getStorage } from 'firebase-admin/storage';
import { firebaseConfig } from '@/firebase/config';
import { randomUUID } from 'crypto';

const DEFAULT_PAYMENT_BASE_URL = 'https://www.servizephyr.com';
const TUNNEL_HOST_RE = /(ngrok|ngrok-free\.app|trycloudflare|loca\.lt|localtunnel|serveo)/i;
const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i;

function normalizeBaseUrl(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    return trimmed.replace(/\/+$/g, '');
}

function parseHttpUrl(value) {
    const normalized = normalizeBaseUrl(value);
    if (!normalized) return null;
    try {
        const parsed = new URL(normalized);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        return parsed;
    } catch {
        return null;
    }
}

function isLocalHost(hostname = '') {
    return LOCAL_HOST_RE.test(String(hostname || '').trim());
}

function isTunnelHost(hostname = '') {
    return TUNNEL_HOST_RE.test(String(hostname || '').trim());
}

export function resolvePaymentPublicBaseUrl(explicitBaseUrl = '') {
    const candidates = [
        process.env.WHATSAPP_CTA_BASE_URL,
        process.env.NEXT_PUBLIC_BASE_URL,
        process.env.NEXT_PUBLIC_APP_URL,
        explicitBaseUrl
    ];

    for (const candidate of candidates) {
        const parsed = parseHttpUrl(candidate);
        if (!parsed) continue;

        const host = parsed.hostname || '';
        const isLocal = isLocalHost(host);
        const isTunnel = isTunnelHost(host);

        // Allow localhost in dev, never use random tunnel hosts.
        if (isTunnel) continue;
        if (isLocal) return normalizeBaseUrl(parsed.toString());

        // Prefer canonical production domain when available.
        if (host.endsWith('servizephyr.com')) {
            return normalizeBaseUrl(parsed.toString());
        }

        return normalizeBaseUrl(parsed.toString());
    }

    return DEFAULT_PAYMENT_BASE_URL;
}

export function sanitizeUpiId(value) {
    return String(value || '').trim();
}

function sanitizePayeeName(value) {
    const cleaned = String(value || 'ServiZephyr')
        .replace(/[^a-zA-Z0-9 .,&()/-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || 'ServiZephyr';
}

function buildUpiQuery(params = {}) {
    return Object.entries(params)
        .filter(([, value]) => String(value || '').trim())
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value).trim())}`)
        .join('&');
}

export function parseMaybeJson(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    if (typeof value !== 'string') return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

export function normalizeIndianPhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return null;
    if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
    return digits.length >= 10 ? digits.slice(-10) : digits;
}

export function resolveCustomerPhoneForNotification(orderData = {}) {
    const directCandidates = [
        orderData.customerPhone,
        orderData.phone,
        orderData.customer?.phone,
        orderData.customerDetails?.phone
    ];
    for (const candidate of directCandidates) {
        const normalized = normalizeIndianPhone(candidate);
        if (normalized && normalized.length >= 10) return normalized;
    }

    const legacyCustomerDetails = parseMaybeJson(orderData.customer_details) || parseMaybeJson(orderData.customerDetails);
    if (legacyCustomerDetails?.phone) {
        const normalizedLegacy = normalizeIndianPhone(legacyCustomerDetails.phone);
        if (normalizedLegacy && normalizedLegacy.length >= 10) return normalizedLegacy;
    }

    return null;
}

export function resolveCustomerNameForNotification(orderData = {}) {
    const directCandidates = [
        orderData.customerName,
        orderData.name,
        orderData.customer?.name,
        orderData.customerDetails?.name
    ];

    for (const candidate of directCandidates) {
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }

    const legacyCustomerDetails = parseMaybeJson(orderData.customer_details) || parseMaybeJson(orderData.customerDetails);
    if (legacyCustomerDetails?.name && String(legacyCustomerDetails.name).trim()) {
        return String(legacyCustomerDetails.name).trim();
    }

    return 'Customer';
}

export function getOrderDisplayId(orderData = {}, orderId = '') {
    if (orderData.customerOrderId) return `#${orderData.customerOrderId}`;
    const normalizedId = String(orderId || '').trim();
    return normalizedId ? `#${normalizedId.slice(0, 8)}` : '#ORDER';
}

export function getAmountFixed(amount) {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        throw new Error('Order amount is invalid for payment request.');
    }
    return numericAmount.toFixed(2);
}

export function getPaymentOrderReference(orderData = {}, orderId = '') {
    const rawReference = String(orderData.customerOrderId || orderId || '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase();
    return rawReference ? rawReference.slice(-18) : 'ORDER';
}

function buildTransactionRef(orderReference) {
    const cleanRef = String(orderReference || 'ORDER')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase()
        .slice(-14);
    const timeSuffix = Date.now().toString().slice(-6);
    return `SZ${cleanRef}${timeSuffix}`.slice(0, 35);
}

export function buildManualUpiDeepLink({ upiId, payeeName, amount, orderReference }) {
    const cleanedUpiId = sanitizeUpiId(upiId);
    if (!cleanedUpiId || !cleanedUpiId.includes('@')) {
        throw new Error('Valid UPI ID is required in settings.');
    }

    const amountFixed = getAmountFixed(amount);
    const safeOrderReference = String(orderReference || 'ORDER')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase()
        .slice(-18) || 'ORDER';
    const upiQuery = buildUpiQuery({
        pa: cleanedUpiId,
        pn: sanitizePayeeName(payeeName).slice(0, 50),
        am: amountFixed,
        cu: 'INR',
        tn: `Order ${safeOrderReference}`.slice(0, 40),
        tr: buildTransactionRef(safeOrderReference)
    });

    return `upi://pay?${upiQuery}`;
}

export function buildPaymentRequestMessage(orderData = {}, orderDisplayId, amountFixed) {
    const status = String(orderData.status || '').toLowerCase();
    const isPreAcceptStatus = ['pending', 'placed', 'awaiting_payment'].includes(status);
    const screenshotLine = 'After payment, please send the payment screenshot here.';

    if (isPreAcceptStatus) {
        return `To complete your order ${orderDisplayId}, please make the payment first. We will accept your order once payment is received.\n\nAmount: INR ${amountFixed}\n\nScan the QR above or tap Pay Now.\n${screenshotLine}`;
    }

    return `Your order ${orderDisplayId} is already confirmed. Please complete the payment now to avoid any delivery delay.\n\nAmount: INR ${amountFixed}\n\nScan the QR above or tap Pay Now.\n${screenshotLine}`;
}

export function buildPaymentQrCardUrl({
    baseUrl,
    upiLink,
    amountFixed,
    upiId,
    payeeName,
    restaurantName,
    orderDisplayId
}) {
    const resolvedBaseUrl = resolvePaymentPublicBaseUrl(baseUrl);
    const upiQueryIndex = String(upiLink || '').indexOf('?');
    const upiParams = upiQueryIndex >= 0
        ? new URLSearchParams(String(upiLink).slice(upiQueryIndex + 1))
        : new URLSearchParams();
    const params = new URLSearchParams({
        am: String(amountFixed || '').trim(),
        upi: sanitizeUpiId(upiId),
        pn: String(payeeName || '').trim(),
        rn: String(restaurantName || '').trim(),
        oid: String(orderDisplayId || '').trim(),
        tn: String(upiParams.get('tn') || '').trim(),
        tr: String(upiParams.get('tr') || '').trim()
    });
    return `${resolvedBaseUrl}/api/payment/upi-qr-card?${params.toString()}`;
}

function sanitizeStoragePathSegment(value, fallback = 'na') {
    const normalized = String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
    return normalized || fallback;
}

function getConfiguredStorageBucketName() {
    return String(
        process.env.FIREBASE_STORAGE_BUCKET
        || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
        || firebaseConfig?.storageBucket
        || `${process.env.FIREBASE_PROJECT_ID || ''}.firebasestorage.app`
    ).trim();
}

async function uploadQrPngAndGetReadableUrl({ buffer, businessId, orderId }) {
    const bucketName = getConfiguredStorageBucketName();
    if (!bucketName) throw new Error('Storage bucket is not configured.');

    const bucket = getStorage().bucket(bucketName);
    const businessSegment = sanitizeStoragePathSegment(businessId, 'business');
    const orderSegment = sanitizeStoragePathSegment(orderId, 'order');
    const filePath = `payment_qr_dynamic/${businessSegment}/${orderSegment}_${Date.now()}.png`;
    const file = bucket.file(filePath);
    const downloadToken = randomUUID();

    await file.save(buffer, {
        metadata: {
            contentType: 'image/png',
            cacheControl: 'public, max-age=31536000, immutable',
            metadata: {
                firebaseStorageDownloadTokens: downloadToken
            }
        }
    });

    const encodedPath = encodeURIComponent(filePath);
    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${downloadToken}`;
}

export async function sendManualPaymentRequestToCustomer({
    orderData,
    orderId,
    businessData,
    businessId,
    collectionName = 'restaurants',
    baseUrl = ''
}) {
    const botPhoneNumberId = businessData?.botPhoneNumberId;
    if (!botPhoneNumberId) {
        throw new Error('WhatsApp bot is not configured for this business.');
    }

    const customerPhone = resolveCustomerPhoneForNotification(orderData);
    if (!customerPhone || customerPhone.length < 10) {
        throw new Error('Customer phone is not available for WhatsApp payment request.');
    }

    const customerPhoneWithCode = customerPhone.startsWith('91') ? customerPhone : `91${customerPhone}`;
    const amount = Number(orderData.totalAmount || orderData.amount || 0);
    const amountFixed = getAmountFixed(amount);
    const orderDisplayId = getOrderDisplayId(orderData, orderId);
    const orderReference = getPaymentOrderReference(orderData, orderId);
    const upiId = sanitizeUpiId(businessData?.upiId);
    const payeeName = String(businessData?.upiPayeeName || businessData?.name || 'ServiZephyr').trim();

    const upiLink = buildManualUpiDeepLink({
        upiId,
        payeeName,
        amount,
        orderReference
    });
    const paymentMessage = buildPaymentRequestMessage(orderData, orderDisplayId, amountFixed);
    const qrCardUrl = buildPaymentQrCardUrl({
        baseUrl,
        upiLink,
        amountFixed,
        upiId,
        payeeName,
        restaurantName: businessData?.name || 'ServiZephyr',
        orderDisplayId
    });
    const upiParams = new URLSearchParams(String(upiLink).split('?')[1] || '');
    const note = String(upiParams.get('tn') || `Order ${orderDisplayId}`).trim();
    const transactionRef = String(upiParams.get('tr') || '').trim();

    let qrBuffer = null;
    let uploadedQrImageUrl = '';
    try {
        qrBuffer = await generateUpiQrCardPngBuffer({
            upiId,
            payeeName,
            restaurantName: businessData?.name || payeeName || 'Restaurant',
            amountFixed,
            orderDisplayId,
            note,
            transactionRef
        });
        uploadedQrImageUrl = await uploadQrPngAndGetReadableUrl({
            buffer: qrBuffer,
            businessId,
            orderId
        });
        console.log(`[Manual UPI] Using storage-hosted QR image URL for order ${orderDisplayId}.`);
    } catch (uploadQrError) {
        console.warn('[Manual UPI] Storage QR upload failed, will try route-based image URL:', uploadQrError?.message || uploadQrError);
    }

    const finalQrImageUrl = uploadedQrImageUrl || qrCardUrl;
    try {
        const finalImageHost = new URL(finalQrImageUrl).hostname;
        console.log(`[Manual UPI] Final QR image host for ${orderDisplayId}: ${finalImageHost}`);
    } catch {
        console.log(`[Manual UPI] Final QR image URL prepared for ${orderDisplayId}.`);
    }

    const ctaPayloadWithImageByUrl = {
        type: 'interactive',
        interactive: {
            type: 'cta_url',
            header: {
                type: 'image',
                image: {
                    link: finalQrImageUrl
                }
            },
            body: {
                text: paymentMessage
            },
            footer: {
                text: 'Powered by ServiZephyr'
            },
            action: {
                name: 'cta_url',
                parameters: {
                    display_text: 'Pay Now',
                    url: upiLink
                }
            }
        }
    };

    try {
        await sendWhatsAppMessage(customerPhoneWithCode, ctaPayloadWithImageByUrl, botPhoneNumberId);
        console.log(`[Manual UPI] Sent combined QR + Pay Now card for order ${orderDisplayId}.`);
    } catch (combinedCardErr) {
        console.warn('[Manual UPI] Combined QR+CTA card failed. Not sending split fallback to avoid multi-message confusion.', combinedCardErr?.message || combinedCardErr);
        throw new Error('Combined payment card (QR + Pay Now) failed to send. Please verify WHATSAPP_CTA_BASE_URL and QR image URL accessibility.');
    }

    return {
        customerPhone,
        customerPhoneWithCode,
        upiLink,
        amount,
        amountFixed,
        orderDisplayId,
        qrCardUrl: finalQrImageUrl
    };
}
