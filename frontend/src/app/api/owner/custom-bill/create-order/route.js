import { NextResponse } from 'next/server';
import { createHash, randomBytes } from 'crypto';

import { getFirestore } from '@/lib/firebase-admin';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';
import { PERMISSIONS } from '@/lib/permissions';
import { sendSystemMessage, sendSystemTemplateMessage, sendWhatsAppMessage } from '@/lib/whatsapp';
import { getOrCreateGuestProfile, obfuscateGuestId } from '@/lib/guest-utils';
import { createOrderV2 } from '@/services/order/createOrder.service';

const SHORT_LINK_COLLECTION = 'short_links';
const SHORT_LINK_LENGTH = 8;
const SHORT_LINK_MAX_ATTEMPTS = 5;
const SHORT_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const ADD_ADDRESS_TEMPLATE_NAME = (process.env.WHATSAPP_ADD_ADDRESS_TEMPLATE_NAME || '').trim();
const ADD_ADDRESS_TEMPLATE_LANGUAGE = (process.env.WHATSAPP_ADD_ADDRESS_TEMPLATE_LANGUAGE || 'en').trim();

function normalizePhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length >= 10) return digits.slice(-10);
    return null;
}

function toPositiveNumber(value, fallback = 0) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return n;
}

function normalizeItem(item, index) {
    const qty = Math.max(1, parseInt(item?.quantity, 10) || 1);
    const unitPrice = toPositiveNumber(item?.price ?? item?.portion?.price, 0);
    const totalPrice = toPositiveNumber(item?.totalPrice, unitPrice * qty);

    return {
        id: item?.id || `manual-item-${index}`,
        name: item?.name || 'Custom Item',
        categoryId: item?.categoryId || 'manual',
        isVeg: !!item?.isVeg,
        quantity: qty,
        price: unitPrice,
        totalPrice,
        cartItemId: item?.cartItemId || `${item?.id || 'item'}-${index}`,
        ...(item?.portion?.name
            ? {
                portion: {
                    name: item.portion.name,
                    price: toPositiveNumber(item.portion.price, unitPrice),
                },
            }
            : {}),
        selectedAddOns: Array.isArray(item?.selectedAddOns)
            ? item.selectedAddOns.map((addOn) => ({
                name: addOn?.name || 'Addon',
                price: toPositiveNumber(addOn?.price, 0),
                quantity: Math.max(1, parseInt(addOn?.quantity, 10) || 1),
            }))
            : [],
    };
}

function buildManualOrderIdempotencyKey({ businessId, phone, items, subtotal, deliveryCharge = 0 }) {
    const minuteBucket = Math.floor(Date.now() / 60000);
    const normalizedItems = (items || [])
        .map((item) => {
            const id = String(item?.id || 'na');
            const qty = Number(item?.quantity || 1);
            const price = Number(item?.price || item?.totalPrice || 0);
            return `${id}:${qty}:${price}`;
        })
        .sort()
        .join('|');

    const signature = `${businessId}|${phone}|${normalizedItems}|${Number(subtotal || 0).toFixed(2)}|${Number(deliveryCharge || 0).toFixed(2)}|${minuteBucket}`;
    const digest = createHash('sha256').update(signature).digest('hex').slice(0, 24);
    return `manual_call_${digest}`;
}

function getBusinessTypeFromCollection(collectionName) {
    if (collectionName === 'shops') return 'store';
    if (collectionName === 'street_vendors') return 'street-vendor';
    return 'restaurant';
}

function resolvePublicBaseUrl(req) {
    const PROD_BASE_URL = 'https://www.servizephyr.com';
    const envBase =
        process.env.NEXT_PUBLIC_BASE_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        '';

    const requestOrigin = (() => {
        try {
            return new URL(req.url).origin;
        } catch {
            return '';
        }
    })();

    const rawBase = (envBase || requestOrigin || PROD_BASE_URL).trim();
    const isTunnelOrLocal = /localhost|127\.0\.0\.1|ngrok|trycloudflare|loca\.lt|localtunnel/i.test(rawBase);

    return isTunnelOrLocal ? PROD_BASE_URL : rawBase;
}

function generateShortCode(length = SHORT_LINK_LENGTH) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const bytes = randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i += 1) {
        out += alphabet[bytes[i] % alphabet.length];
    }
    return out;
}

function normalizeAddAddressPath(fullUrl) {
    try {
        const parsed = new URL(fullUrl);
        if (!parsed.pathname.startsWith('/add-address')) {
            return null;
        }
        return `${parsed.pathname}${parsed.search || ''}`;
    } catch {
        return null;
    }
}

async function createShortAddAddressCode({
    firestore,
    addAddressLink,
    businessId,
    orderId,
    customerPhone,
    customerName,
}) {
    const targetPath = normalizeAddAddressPath(addAddressLink);
    if (!targetPath) {
        throw new Error('Invalid add-address target path for short link.');
    }

    for (let attempt = 0; attempt < SHORT_LINK_MAX_ATTEMPTS; attempt += 1) {
        const code = generateShortCode();
        const docRef = firestore.collection(SHORT_LINK_COLLECTION).doc(code);
        try {
            await docRef.create({
                code,
                targetPath,
                purpose: 'manual_call_add_address',
                businessId,
                orderId,
                customerPhone,
                customerName: customerName || 'Guest',
                accessCount: 0,
                status: 'active',
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + SHORT_LINK_TTL_MS),
            });
            return code;
        } catch (error) {
            const alreadyExists =
                error?.code === 6 || // gRPC already exists
                /already exists/i.test(String(error?.message || ''));
            if (!alreadyExists) {
                throw error;
            }
        }
    }

    throw new Error('Unable to generate short link code. Please retry.');
}

function buildAddAddressTemplatePayload({ restaurantName, customerName, orderId, shortCode }) {
    if (!ADD_ADDRESS_TEMPLATE_NAME) {
        return null;
    }

    const orderPreview = String(orderId || '').slice(0, 8).toUpperCase();
    const safeCustomer = String(customerName || 'Customer').slice(0, 30);
    const safeRestaurant = String(restaurantName || 'ServiZephyr').slice(0, 60);

    return {
        name: ADD_ADDRESS_TEMPLATE_NAME,
        language: { code: ADD_ADDRESS_TEMPLATE_LANGUAGE || 'en' },
        components: [
            {
                type: 'header',
                parameters: [{ type: 'text', text: safeRestaurant }],
            },
            {
                type: 'body',
                parameters: [
                    { type: 'text', text: safeCustomer || 'Customer' },
                    { type: 'text', text: orderPreview || 'ORDER' },
                ],
            },
            {
                type: 'button',
                sub_type: 'url',
                index: '0',
                parameters: [{ type: 'text', text: shortCode }],
            },
        ],
    };
}

export async function POST(req) {
    try {
        const context = await verifyOwnerWithAudit(
            req,
            'custom_bill_create_order',
            {},
            false,
            [PERMISSIONS.CREATE_ORDER]
        );

        const { businessId, businessSnap, collectionName } = context;
        const body = await req.json();

        const customerDetails = body?.customerDetails || {};
        const rawItems = Array.isArray(body?.items) ? body.items : [];
        const notes = body?.notes || '';

        const customerName = String(customerDetails?.name || 'Guest').trim() || 'Guest';
        const phone = normalizePhone(customerDetails?.phone);
        const addressText = String(customerDetails?.address || '').trim();

        if (!phone) {
            return NextResponse.json({ message: 'Valid customer phone is required.' }, { status: 400 });
        }
        if (!rawItems.length) {
            return NextResponse.json({ message: 'At least one item is required.' }, { status: 400 });
        }

        const items = rawItems.map(normalizeItem);
        const subtotal = items.reduce((sum, item) => sum + toPositiveNumber(item.totalPrice, 0), 0);
        const deliveryCharge = toPositiveNumber(body?.deliveryCharge, 0);
        const hasOwnerDeliveryChargeOverride = deliveryCharge > 0;
        const grandTotal = subtotal + deliveryCharge;

        const hasProvidedAddress = !!addressText;
        // Owner-entered address is treated as bill-only placeholder.
        // Customer still shares live location later through add-address link.
        const ownerEnteredAddress = hasProvidedAddress ? { full: addressText } : null;

        const firestore = await getFirestore();
        const profileResult = await getOrCreateGuestProfile(firestore, phone);
        const guestRef = await obfuscateGuestId(profileResult.userId);

        const createOrderPayload = {
            name: customerName,
            phone,
            address: ownerEnteredAddress,
            restaurantId: businessId,
            items,
            notes,
            paymentMethod: 'cod',
            businessType: getBusinessTypeFromCollection(collectionName),
            deliveryType: 'delivery',
            subtotal,
            cgst: 0,
            sgst: 0,
            grandTotal,
            deliveryCharge,
            skipAddressValidation: true,
            initialStatus: 'confirmed',
            idempotencyKey: buildManualOrderIdempotencyKey({
                businessId,
                phone,
                items,
                subtotal,
                deliveryCharge
            }),
            guestRef,
        };

        const createOrderReq = { json: async () => createOrderPayload };
        const createOrderRes = await createOrderV2(createOrderReq, {
            allowInitialStatusOverride: true
        });
        const createOrderData = await createOrderRes.json();

        if (!createOrderRes.ok) {
            return NextResponse.json(createOrderData, { status: createOrderRes.status });
        }

        const duplicateOrderRequest = createOrderData?.message === 'Order already exists';
        const orderId = createOrderData?.order_id || createOrderData?.firestore_order_id;
        const token = createOrderData?.token;
        if (!orderId || !token) {
            return NextResponse.json(
                { message: 'Order created but tracking token missing.' },
                { status: 500 }
            );
        }

        try {
            await firestore.collection('orders').doc(orderId).set({
                orderSource: 'manual_call',
                isManualCallOrder: true,
                ownerDeliveryChargeProvided: hasOwnerDeliveryChargeOverride,
                deliveryChargeLocked: hasOwnerDeliveryChargeOverride,
                manualDeliveryChargeLocked: hasOwnerDeliveryChargeOverride,
                manualDeliveryCharge: hasOwnerDeliveryChargeOverride ? deliveryCharge : 0,
                addressCaptureRequired: true,
                addAddressLinkRequired: true,
                addAddressRequestedAt: new Date(),
                manualCallUpdatedAt: new Date(),
            }, { merge: true });
        } catch (tagError) {
            console.warn('[Custom Bill Create Order] Failed to tag manual-call metadata:', tagError?.message || tagError);
        }

        const baseUrl = resolvePublicBaseUrl(req);
        const encodedGuestRef = encodeURIComponent(guestRef);
        const encodedOrderId = encodeURIComponent(orderId);
        const encodedToken = encodeURIComponent(token);
        const encodedPhone = encodeURIComponent(phone);
        const encodedCustomerName = encodeURIComponent(customerName);

        const trackingUrl = `${baseUrl}/track/delivery/${orderId}?token=${token}&ref=${encodedGuestRef}&phone=${encodedPhone}&activeOrderId=${orderId}`;
        const returnTrackingPath = `/track/delivery/${orderId}?token=${encodedToken}&ref=${encodedGuestRef}&phone=${encodedPhone}&activeOrderId=${encodedOrderId}`;
        const addAddressPath = `/add-address?token=${encodedToken}&ref=${encodedGuestRef}&phone=${encodedPhone}&name=${encodedCustomerName}&activeOrderId=${encodedOrderId}&useCurrent=true&currentLocation=true&returnUrl=${encodeURIComponent(returnTrackingPath)}`;
        const addAddressLink = `${baseUrl}${addAddressPath}`;

        let addAddressShortCode = null;
        let addAddressShortLink = null;
        try {
            addAddressShortCode = await createShortAddAddressCode({
                firestore,
                addAddressLink,
                businessId,
                orderId,
                customerPhone: phone,
                customerName,
            });
            addAddressShortLink = `${baseUrl}/a/${addAddressShortCode}`;
        } catch (shortErr) {
            console.warn('[Custom Bill Create Order] Failed to create short add-address link:', shortErr?.message || shortErr);
        }

        const businessData = businessSnap.data() || {};
        const botPhoneNumberId = businessData.botPhoneNumberId;
        let whatsappSent = false;
        let whatsappError = null;
        let whatsappMode = 'none';

        if (duplicateOrderRequest) {
            whatsappSent = false;
            whatsappError = 'Duplicate create-order request ignored (existing order reused).';
        } else if (botPhoneNumberId) {
            const customerFacingLink = addAddressShortLink || addAddressLink;
            const fallbackMessage = `Your order has been created successfully.\n\nTo enable live tracking, please add your current delivery location:\n${customerFacingLink}`;
            const ctaBodyMessage = 'Your order has been created successfully.\n\nPlease add your current delivery location to enable live tracking.';
            const interactiveCtaPayload = {
                type: 'interactive',
                interactive: {
                    type: 'cta_url',
                    header: {
                        type: 'text',
                        text: 'Address Required',
                    },
                    body: {
                        text: ctaBodyMessage,
                    },
                    footer: {
                        text: 'Powered by ServiZephyr',
                    },
                    action: {
                        name: 'cta_url',
                        parameters: {
                            display_text: 'Add Address',
                            url: customerFacingLink,
                        },
                    },
                },
            };

            // PRIMARY METHOD: Template message (works without 24-hour session window)
            if (ADD_ADDRESS_TEMPLATE_NAME && addAddressShortCode) {
                try {
                    const templatePayload = buildAddAddressTemplatePayload({
                        restaurantName: businessData.name || 'ServiZephyr',
                        customerName,
                        orderId,
                        shortCode: addAddressShortCode,
                    });
                    if (!templatePayload) {
                        throw new Error('Template payload not available.');
                    }

                    console.log('[Custom Bill Create Order] 📤 Sending template message...');
                    const waResponse = await sendSystemTemplateMessage(
                        `91${phone}`,
                        templatePayload,
                        fallbackMessage,
                        botPhoneNumberId,
                        businessId,
                        businessData.name || 'ServiZephyr',
                        collectionName,
                        {
                            customerName,
                            conversationPreview: 'Your order has been created successfully. Please add your delivery location for live tracking.',
                        }
                    );
                    if (waResponse?.messages?.[0]?.id) {
                        whatsappSent = true;
                        whatsappMode = 'template';
                        console.log('[Custom Bill Create Order] ✅ Template sent:', waResponse.messages[0].id);
                    } else {
                        throw new Error('WhatsApp API did not return a message id for template.');
                    }
                } catch (templateErr) {
                    console.warn('[Custom Bill Create Order] ⚠️ Template send failed. Falling back to text message:', templateErr?.message || templateErr);
                    whatsappMode = 'text_fallback';
                }
            }

            // PRIMARY METHOD DISABLED: Interactive CTA button causes Error 131042 on restricted numbers
            // CTA buttons fail when phone number display name is "In Review"
            // Using plain text message with link instead
            /*
            console.log('[Custom Bill Create Order] 📤 Sending interactive CTA button...');
            try {
                const waResponse = await sendWhatsAppMessage(
                    `91${phone}`,
                    interactiveCtaPayload,
                    botPhoneNumberId
                );

                if (waResponse?.messages?.[0]?.id) {
                    whatsappSent = true;
                    whatsappMode = 'interactive_cta';
                    const wamid = waResponse.messages[0].id;
                    console.log('[Custom Bill Create Order] ✅ Interactive CTA sent:', wamid);

                    // Store in conversation history
                    try {
                        const firestore = await getFirestore();
                        const cleanPhone = phone;

                        await firestore
                            .collection(collectionName)
                            .doc(businessId)
                            .collection('conversations')
                            .doc(cleanPhone)
                            .collection('messages')
                            .doc(wamid)
                            .set({
                                id: wamid,
                                wamid: wamid,
                                sender: 'system',
                                type: 'interactive',
                                text: `${ctaBodyMessage}\\n\\n${customerFacingLink}`,
                                body: ctaBodyMessage,
                                timestamp: new Date(),
                                status: 'sent',
                                isSystem: true,
                                messageFormat: 'interactive_cta',
                            });

                        await firestore
                            .collection(collectionName)
                            .doc(businessId)
                            .collection('conversations')
                            .doc(cleanPhone)
                            .set({
                                customerPhone: cleanPhone,
                                customerName: customerName,
                                lastMessage: ctaBodyMessage,
                                lastMessageType: 'interactive',
                                lastMessageTimestamp: new Date(),
                            }, { merge: true });

                        console.log('[Custom Bill Create Order] 💾 CTA stored in conversation');
                    } catch (dbErr) {
                        console.warn('[Custom Bill Create Order] ⚠️  Failed to store:', dbErr?.message);
                    }
                } else {
                    throw new Error('WhatsApp API did not return message ID for CTA');
                }
            } catch (interactiveErr) {
                console.error('[Custom Bill Create Order] ❌ CTA failed:', interactiveErr?.message || interactiveErr);
                whatsappMode = 'text_fallback';
                whatsappSent = false;
            }
            */

            // FALLBACK METHOD: Plain text message with link
            // Only runs if template was not sent (ADD_ADDRESS_TEMPLATE_NAME missing or shortCode failed)
            if (!whatsappSent) {
                console.log('[Custom Bill Create Order] 📝 Sending plain text fallback message with link...');
                try {
                    const waResponse = await sendSystemMessage(
                        `91${phone}`,
                        fallbackMessage,
                        botPhoneNumberId,
                        businessId,
                        businessData.name || 'ServiZephyr',
                        collectionName,
                        {
                            customerName,
                            conversationPreview: 'Order created. Add delivery location for tracking.',
                        }
                    );
                    if (waResponse?.messages?.[0]?.id) {
                        whatsappSent = true;
                        whatsappMode = 'text_fallback';
                        console.log('[Custom Bill Create Order] ✅ Text fallback sent:', waResponse.messages[0].id);
                    } else {
                        whatsappSent = false;
                        whatsappError = 'WhatsApp API did not return message ID.';
                        console.error('[Custom Bill Create Order] ❌ Text fallback returned no message ID');
                    }
                } catch (err) {
                    whatsappError = err?.message || 'Failed to send WhatsApp message.';
                    console.error('[Custom Bill Create Order] ❌ All WhatsApp attempts failed:', err);
                }
            }
        } else {
            whatsappError = 'Business botPhoneNumberId is not configured.';
        }

        return NextResponse.json({
            message: 'Order created successfully.',
            orderId,
            token,
            guestRef,
            trackingUrl,
            addAddressLink,
            addAddressShortLink,
            addressPending: true,
            duplicateRequest: duplicateOrderRequest,
            whatsappSent,
            whatsappMode,
            whatsappError,
        });
    } catch (error) {
        console.error('[Custom Bill Create Order] Error:', error);
        return NextResponse.json(
            { message: `Backend Error: ${error.message}` },
            { status: error.status || 500 }
        );
    }
}
