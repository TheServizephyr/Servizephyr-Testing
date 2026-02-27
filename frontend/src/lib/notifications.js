
import { sendSystemMessage, sendWhatsAppMessage } from './whatsapp';
import { getFirestore, FieldValue } from './firebase-admin';

const normalizeIndianPhoneForWhatsApp = (value) => {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return null;
    if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
    if (digits.length > 10) return digits.slice(-10);
    return digits;
};

const normalizeBusinessType = (value) => {
    if (typeof value !== 'string') return 'restaurant';
    const normalized = value.trim().toLowerCase();
    if (normalized === 'street_vendor') return 'street-vendor';
    if (normalized === 'shop' || normalized === 'store') return 'store';
    if (normalized === 'street-vendor' || normalized === 'restaurant') {
        return normalized;
    }
    return 'restaurant';
};

const getBusinessTerms = (businessType = 'restaurant') => {
    const normalizedType = normalizeBusinessType(businessType);
    if (normalizedType === 'store') {
        return {
            supportLabel: 'store',
            preparingMessage: 'Your items are being packed',
            confirmedMessage: 'Your order is confirmed and will be packed shortly',
            deliveredMessage: "Your order has been delivered. Thank you for shopping with us. Just send 'Hi' to place an order next time.",
            postDispatchSignoff: 'Thank you for shopping with us!',
        };
    }
    if (normalizedType === 'street-vendor') {
        return {
            supportLabel: 'stall',
            preparingMessage: 'Your order is being prepared',
            confirmedMessage: 'Your order is confirmed and will be prepared shortly',
            deliveredMessage: "Your order has been delivered. Thank you for ordering with us. Just send 'Hi' to place an order next time.",
            postDispatchSignoff: 'Enjoy your order!',
        };
    }
    return {
        supportLabel: 'restaurant',
        preparingMessage: 'Your food is being prepared',
        confirmedMessage: 'Your order is confirmed and will be prepared shortly',
        deliveredMessage: "Your order has been delivered. Thank you for ordering with us. Just send 'Hi' to place an order next time.",
        postDispatchSignoff: 'Enjoy your meal!',
    };
};

const getStatusLabelForBusiness = (status, businessType = 'restaurant', deliveryType = null) => {
    const normalizedType = normalizeBusinessType(businessType);
    const normalizedStatus = String(status || '').trim().toLowerCase();
    if (!normalizedStatus) return 'Unknown';

    if (normalizedType === 'store') {
        const labels = {
            pending: 'New',
            confirmed: 'Confirmed',
            preparing: 'Processing',
            prepared: 'Ready',
            ready_for_pickup: deliveryType === 'pickup' ? 'Ready for Pickup' : 'Ready to Dispatch',
            dispatched: 'Out for Delivery',
            delivered: 'Delivered',
            picked_up: 'Picked Up',
            rejected: 'Rejected',
            cancelled: 'Cancelled',
            rider_arrived: 'Rider Arrived',
            failed_delivery: 'Delivery Failed',
        };
        return labels[normalizedStatus] || normalizedStatus.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
    }

    return normalizedStatus.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
};

const resolveBusinessByBotPhoneId = async (firestore, botPhoneNumberId) => {
    const restaurants = await firestore
        .collection('restaurants')
        .where('botPhoneNumberId', '==', botPhoneNumberId)
        .limit(1)
        .get();
    if (!restaurants.empty) {
        const doc = restaurants.docs[0];
        return { doc, collectionName: 'restaurants' };
    }

    const shops = await firestore
        .collection('shops')
        .where('botPhoneNumberId', '==', botPhoneNumberId)
        .limit(1)
        .get();
    if (!shops.empty) {
        const doc = shops.docs[0];
        return { doc, collectionName: 'shops' };
    }

    const streetVendors = await firestore
        .collection('street_vendors')
        .where('botPhoneNumberId', '==', botPhoneNumberId)
        .limit(1)
        .get();
    if (!streetVendors.empty) {
        const doc = streetVendors.docs[0];
        return { doc, collectionName: 'street_vendors' };
    }

    return null;
};

export const sendNewOrderToOwner = async ({ ownerPhone, botPhoneNumberId, customerName, totalAmount, orderId, restaurantName }) => {
    console.log(`[Notification Lib] Preparing 'new_order' notification for owner ${ownerPhone}.`);

    if (!ownerPhone || !botPhoneNumberId) {
        console.error(`[Notification Lib] CRITICAL: Cannot send new order notification. Owner phone or Bot ID is missing. Owner Phone: ${ownerPhone}, Bot ID: ${botPhoneNumberId}`);
        return;
    }
    const normalizedOwnerPhone = normalizeIndianPhoneForWhatsApp(ownerPhone);
    if (!normalizedOwnerPhone || normalizedOwnerPhone.length < 10) {
        console.error(`[Notification Lib] Invalid owner phone for notification: ${ownerPhone}`);
        return;
    }
    const ownerPhoneWithCode = '91' + normalizedOwnerPhone;

    console.log(`[Notification Lib] New order details: Customer: ${customerName}, Amount: ${totalAmount}, OrderID: ${orderId}`);

    const notificationPayload = {
        name: "new_order_notification",
        language: { code: "en" },
        components: [
            {
                type: "body",
                parameters: [
                    { type: "text", text: customerName },
                    { type: "text", text: `₹${totalAmount.toFixed(2)}` },
                    { type: "text", text: orderId },
                    { type: "text", text: restaurantName }
                ]
            },
            {
                type: "button",
                sub_type: "quick_reply",
                index: "0",
                parameters: [{ type: "payload", payload: `accept_order_${orderId}` }]
            },
            {
                type: "button",
                sub_type: "quick_reply",
                index: "1",
                parameters: [{ type: "payload", payload: `reject_order_${orderId}` }]
            }
        ]
    };

    console.log(`[Notification Lib] Sending 'new_order_notification' template to owner.`);
    await sendWhatsAppMessage(ownerPhoneWithCode, notificationPayload, botPhoneNumberId);
    console.log(`[Notification Lib] 'new_order_notification' notification sent.`);
};


export const sendOrderStatusUpdateToCustomer = async ({ customerPhone, botPhoneNumberId, customerName, orderId, customerOrderId, restaurantName, status, deliveryBoy = null, businessType = 'restaurant', deliveryType = null, trackingToken = null, amount = 0, orderDate = null, hasCustomerLocation = true }) => {
    console.log(`[Notification Lib] Preparing status update for customer ${customerPhone}. Order: ${orderId}, New Status: ${status}.`);

    if (!customerPhone || !botPhoneNumberId) {
        console.warn(`[Notification Lib] Customer phone or Bot ID not found. Cannot send status update for order ${orderId}.`);
        return;
    }
    const normalizedCustomerPhone = normalizeIndianPhoneForWhatsApp(customerPhone);
    if (!normalizedCustomerPhone || normalizedCustomerPhone.length < 10) {
        console.warn(`[Notification Lib] Invalid customer phone for order ${orderId}: ${customerPhone}`);
        return;
    }
    const customerPhoneWithCode = '91' + normalizedCustomerPhone;
    const safeCustomerName = (typeof customerName === 'string' && customerName.trim())
        ? customerName.trim()
        : 'Customer';
    const safeRestaurantName = (typeof restaurantName === 'string' && restaurantName.trim())
        ? restaurantName.trim()
        : 'ServiZephyr';

    // Use Customer-facing ID if available, else fallback to truncated Firestore ID
    const displayOrderId = customerOrderId ? `#${customerOrderId}` : `#${orderId.substring(0, 8)}`;

    let templateName;
    let components = [];
    let fullMessageText = ""; // Constructed text for persistence

    const resolvedBusinessType = normalizeBusinessType(businessType);
    const businessTerms = getBusinessTerms(resolvedBusinessType);
    const capitalizedStatus = getStatusLabelForBusiness(status, resolvedBusinessType, deliveryType);
    const preparingMessage = businessTerms.preparingMessage;
    const confirmedMessage = businessTerms.confirmedMessage;

    switch (status) {
        case 'rider_arrived':
            templateName = 'rider_arrived';
            const arrivedParams = [
                { type: "text", text: safeCustomerName },
                { type: "text", text: displayOrderId },
                { type: "text", text: safeRestaurantName },
                { type: "text", text: deliveryBoy?.name || 'Delivery Partner' },
                { type: "text", text: deliveryBoy?.phone ? `+91${deliveryBoy.phone}` : 'N/A' }
            ];
            components.push({ type: "body", parameters: arrivedParams });

            fullMessageText = `Hi ${safeCustomerName} 👋\n\nYour order ${displayOrderId} from ${safeRestaurantName} is arriving! 🛵\n\nOur delivery partner, ${deliveryBoy?.name || 'Delivery Partner'}, has reached your location.\nYou can call them on ${deliveryBoy?.phone ? `+91${deliveryBoy.phone}` : 'N/A'} to coordinate.\n\nPlease collect your order!`;

            console.log(`[Notification Lib] Using template '${templateName}' - Rider arrived at location.`);
            break;

        case 'dispatched':
        case 'on_the_way': // Map 'on_the_way' to the dispatch template (with tracking link)
            if (deliveryType === 'delivery' && !hasCustomerLocation) {
                templateName = 'order_status_update';
                const noLocationParams = [
                    { type: "text", text: safeCustomerName },
                    { type: "text", text: displayOrderId },
                    { type: "text", text: safeRestaurantName },
                    { type: "text", text: "Your order is on the way. Please share your delivery location to enable live tracking." },
                ];
                components.push({ type: "body", parameters: noLocationParams });

                fullMessageText = `Hi ${safeCustomerName}! 👋\n\nYour order ${displayOrderId} from ${safeRestaurantName} is on the way.\n\nPlease share your delivery location to enable live tracking.`;
                console.log(`[Notification Lib] Tracking URL suppressed for ${orderId} because customer location is missing.`);
                break;
            }

            templateName = 'order_dispatched_simple';
            // Use passed token (fallback to empty if missing)
            const tokenParam = trackingToken ? `?token=${trackingToken}` : '';
            const trackingUrl = `https://servizephyr.com/track/delivery/${orderId}${tokenParam}`;

            const bodyParams = [
                { type: "text", text: safeCustomerName },
                { type: "text", text: displayOrderId },
                { type: "text", text: safeRestaurantName },
                { type: "text", text: deliveryBoy?.name || 'Our delivery partner' },
                { type: "text", text: deliveryBoy?.phone ? `+91${deliveryBoy.phone}` : 'N/A' },
                { type: "text", text: trackingUrl }
            ];
            components.push({ type: "body", parameters: bodyParams });

            fullMessageText = `Hi ${safeCustomerName}! 👋\n\nYour order ${displayOrderId} from ${safeRestaurantName} is on its way! 🛵\n\nOur delivery partner, ${deliveryBoy?.name || 'Our delivery partner'}, will be arriving at your location shortly.\nYou can call them on ${deliveryBoy?.phone ? `+91${deliveryBoy.phone}` : 'N/A'} if needed.\n\nTrack your order live here:\n${trackingUrl}\n\n${businessTerms.postDispatchSignoff}`;

            console.log(`[Notification Lib] Using template '${templateName}' with secure tracking URL.`);
            break;

        case 'confirmed':
            // FALLBACK TO STANDARD TEMPLATE
            templateName = 'order_status_update';

            const billTokenParam = trackingToken ? `?token=${encodeURIComponent(trackingToken)}` : '';
            const billUrl = `https://www.servizephyr.com/public/bill/${orderId}${billTokenParam}`;
            const finalConfirmedMsg = `${confirmedMessage} View Bill: ${billUrl}`;

            const confirmedParams = [
                { type: "text", text: safeCustomerName },
                { type: "text", text: displayOrderId },
                { type: "text", text: safeRestaurantName },
                { type: "text", text: finalConfirmedMsg },
            ];
            components.push({ type: "body", parameters: confirmedParams });

            fullMessageText = `Hi ${safeCustomerName}, here's an update on your order ${displayOrderId} from ${safeRestaurantName}.\n\nStatus: ${finalConfirmedMsg}\n\nWe'll keep you posted!`;

            console.log(`[Notification Lib] Reverted to standard '${templateName}' for order confirmed.`);
            break;

        case 'preparing':
            templateName = 'order_status_update';
            const preparingParams = [
                { type: "text", text: safeCustomerName },
                { type: "text", text: displayOrderId },
                { type: "text", text: safeRestaurantName },
                { type: "text", text: preparingMessage },
            ];
            components.push({ type: "body", parameters: preparingParams });

            fullMessageText = `Hi ${safeCustomerName}, here's an update on your order ${displayOrderId} from ${safeRestaurantName}.\n\nStatus: ${preparingMessage}\n\nWe'll keep you posted!`;

            console.log(`[Notification Lib] Using template '${templateName}' for 'preparing' status.`);
            break;

        case 'delivered':
            templateName = 'order_status_update';
            const deliveredMessage = businessTerms.deliveredMessage;
            const deliveredParams = [
                { type: "text", text: safeCustomerName },
                { type: "text", text: displayOrderId },
                { type: "text", text: safeRestaurantName },
                { type: "text", text: deliveredMessage },
            ];
            components.push({ type: "body", parameters: deliveredParams });
            fullMessageText = `Hi ${safeCustomerName}, your order ${displayOrderId} from ${safeRestaurantName} has been delivered. ${deliveredMessage}`;
            console.log(`[Notification Lib] Using template '${templateName}' for delivered status.`);
            break;

        case 'ready_for_pickup':
            // Suppress this message for delivery orders (customer should get dispatch/track message instead).
            if (deliveryType === 'delivery') {
                console.log(`[Notification Lib] Suppressing 'ready_for_pickup' notification for delivery order ${orderId}.`);
                return;
            }
        // Fallthrough for takeaway/dine-in or if deliveryType missing
        case 'rejected':
        case 'picked_up':
            console.log(`[Notification Lib] No specific template configured for status: '${status}'. Using default 'order_status_update'.`);
            templateName = 'order_status_update';
            const defaultParams = [
                { type: "text", text: safeCustomerName },
                { type: "text", text: displayOrderId },
                { type: "text", text: safeRestaurantName },
                { type: "text", text: capitalizedStatus },
            ];
            components.push({ type: "body", parameters: defaultParams });

            fullMessageText = `Hi ${safeCustomerName}, here's an update on your order ${displayOrderId} from ${safeRestaurantName}.\n\nStatus: ${capitalizedStatus}\n\nWe'll keep you posted!`;
            break;

        case 'failed_delivery':
        case 'cancelled':
            templateName = 'delivery_failed';
            const failureReason = deliveryBoy?.failureReason || 'Delivery could not be completed';
            const supportPhone = deliveryBoy?.supportPhone || '+91 9999999999';

            const failureParams = [
                { type: "text", text: safeCustomerName },
                { type: "text", text: displayOrderId },
                { type: "text", text: safeRestaurantName },
                { type: "text", text: failureReason },
                { type: "text", text: supportPhone }
            ];
            components.push({ type: "body", parameters: failureParams });

            fullMessageText = `Hi ${safeCustomerName}, we have an update on your order ${displayOrderId} from ${safeRestaurantName}.\n\nStatus: Delivery Failed ❌\nReason: ${failureReason}\n\nPlease contact support at ${supportPhone} for assistance.`;

            console.log(`[Notification Lib] Using template '${templateName}' for failed delivery.`);
            break;

        default:
            console.log(`[Notification Lib] Unknown status: '${status}'. Using default 'order_status_update'.`);
            templateName = 'order_status_update';
            const unknownParams = [
                { type: "text", text: safeCustomerName },
                { type: "text", text: displayOrderId },
                { type: "text", text: safeRestaurantName },
                { type: "text", text: capitalizedStatus },
            ];
            components.push({ type: "body", parameters: unknownParams });

            fullMessageText = `Hi ${safeCustomerName}, here's an update on your order ${displayOrderId} from ${safeRestaurantName}.\n\nStatus: ${capitalizedStatus}\n\nWe'll keep you posted!`;
            break;
    }

    const statusPayload = {
        name: templateName,
        language: { code: "en" }, // Reverted to 'en' based on user screenshot (English vs English US)
        components: components,
    };

    // ... (previous code)
    try {
        console.log(`[Notification Lib] Sending status update to customer.`);
        const response = await sendWhatsAppMessage(customerPhoneWithCode, statusPayload, botPhoneNumberId);
        console.log(`[Notification Lib] Status update sent successfully.`);

        // ✅ PERSISTENCE: Save Status Update to Firestore Chat
        if (response && response.messages && response.messages[0]) {
            try {
                const firestore = await getFirestore();

                // 1. Find Business Context (Restaurant vs Store)
                // We need to know WHICH collection and WHICH document ID to save to.
                // Assuming we can lookup by botPhoneNumberId
                const businessContext = await resolveBusinessByBotPhoneId(firestore, botPhoneNumberId);
                if (businessContext?.doc) {
                    const businessDoc = businessContext.doc;
                    const wamid = response.messages[0].id;
                    const cleanPhone = normalizedCustomerPhone;
                    // const summaryText = `Order Status: ${capitalizedStatus}`; // OLD

                    await businessDoc.ref
                        .collection('conversations')
                        .doc(cleanPhone)
                        .collection('messages')
                        .doc(wamid) // Use WAMID as ID
                        .set({
                            id: wamid,
                            sender: 'system',
                            type: 'template',
                            template_name: templateName,
                            text: fullMessageText, // ✅ NEW: Save the full text
                            timestamp: FieldValue.serverTimestamp(),
                            status: 'sent',
                            isSystem: true
                        });
                    console.log(`[Notification Lib] Status update saved to history for ${cleanPhone}`);
                }
            } catch (dbError) {
                console.error("[Notification Lib] Failed to save status update to history:", dbError);
                // Non-blocking error
            }
        }

    } catch (e) {
        console.error("[Notification Lib] Template status update failed. Trying text fallback.", e);

        try {
            const firestore = await getFirestore();
            const businessContext = await resolveBusinessByBotPhoneId(firestore, botPhoneNumberId);

            if (businessContext?.doc) {
                const businessDoc = businessContext.doc;
                const businessName = businessDoc.data()?.name || restaurantName || 'ServiZephyr';
                await sendSystemMessage(
                    customerPhoneWithCode,
                    fullMessageText || `Order ${displayOrderId} status updated: ${capitalizedStatus}`,
                    botPhoneNumberId,
                    businessDoc.id,
                    businessName,
                    businessContext.collectionName,
                    {
                        customerName: safeCustomerName,
                        conversationPreview: `Order ${displayOrderId}: ${capitalizedStatus}`
                    }
                );
                console.log(`[Notification Lib] Text fallback sent successfully for order ${orderId}.`);
                return;
            }

            console.error("[Notification Lib] Fallback skipped: business lookup by botPhoneNumberId failed.");
            // Last-resort delivery: send plain text without conversation persistence.
            // This keeps customer updates working even if business lookup path changes.
            await sendWhatsAppMessage(
                customerPhoneWithCode,
                fullMessageText || `Order ${displayOrderId} status updated: ${capitalizedStatus}`,
                botPhoneNumberId
            );
            console.log(`[Notification Lib] Last-resort plain-text fallback sent for order ${orderId}.`);
        } catch (fallbackErr) {
            console.error("[Notification Lib] CRITICAL: Text fallback also failed.", fallbackErr);
        }
    }
};

export const sendRestaurantStatusChangeNotification = async ({ ownerPhone, botPhoneNumberId, newStatus, restaurantId }) => {
    console.log(`[Notification Lib] Preparing 'status_change_alert' for owner ${ownerPhone}. New status: ${newStatus}`);

    if (!ownerPhone || !botPhoneNumberId) {
        console.error(`[Notification Lib] Cannot send status change notification. Owner phone or Bot ID is missing.`);
        return;
    }
    const ownerPhoneWithCode = '91' + ownerPhone;

    const isOpen = newStatus;
    const statusText = isOpen ? "OPEN" : "CLOSED";
    const revertPayload = `revert_status_${restaurantId}_${isOpen ? 'closed' : 'open'}`;
    const retainPayload = `retain_status_${restaurantId}_${isOpen ? 'open' : 'closed'}`;

    const payload = {
        name: "restaurant_status_change_alert",
        language: { code: "en" },
        components: [
            {
                type: "body",
                parameters: [
                    { type: "text", text: statusText }
                ]
            },
            {
                type: "button",
                sub_type: "quick_reply",
                index: "0",
                parameters: [{ type: "payload", payload: retainPayload }]
            },
            {
                type: "button",
                sub_type: "quick_reply",
                index: "1",
                parameters: [{ type: "payload", payload: revertPayload }]
            }
        ]
    };

    console.log(`[Notification Lib] Sending 'status_change_alert' template to owner.`);
    await sendWhatsAppMessage(ownerPhoneWithCode, payload, botPhoneNumberId);
    console.log(`[Notification Lib] 'status_change_alert' sent.`);
}

