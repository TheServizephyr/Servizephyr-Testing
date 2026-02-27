import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export async function GET(request, { params }) {
    console.log("[API][Dine-In Tab Status] GET request received.");
    try {
        const { tabId } = params;
        const { searchParams } = new URL(request.url);
        const restaurantId = searchParams.get('restaurantId');

        const firestore = await getFirestore();

        if (!tabId || !restaurantId) {
            console.log("[API][Dine-In Tab Status] Error: Tab ID or Restaurant ID missing.");
            return NextResponse.json({ message: 'Tab ID and Restaurant ID are required.' }, { status: 400 });
        }

        console.log(`[API][Dine-In Tab Status] Fetching all orders for tabId: ${tabId}, restaurantId: ${restaurantId}`);

        // Fetch ALL orders with this dineInTabId
        const ordersSnapshot = await firestore
            .collection('orders')
            .where('restaurantId', '==', restaurantId)
            .where('dineInTabId', '==', tabId)
            .where('status', 'in', ['pending', 'accepted', 'preparing', 'ready', 'delivered'])
            .orderBy('orderDate', 'asc')
            .get();

        if (ordersSnapshot.empty) {
            console.log("[API][Dine-In Tab Status] No orders found for this tab.");
            return NextResponse.json({ message: 'No orders found for this tab.' }, { status: 404 });
        }

        // Aggregate all orders
        const orders = [];
        let allItems = [];
        let totalSubtotal = 0;
        let totalCgst = 0;
        let totalSgst = 0;
        let totalAmount = 0;
        let dineInToken = null;
        let tableId = null;
        let tabName = null;
        let paxCount = null;
        let latestStatus = 'pending';

        ordersSnapshot.forEach(doc => {
            const orderData = doc.data();
            orders.push({ id: doc.id, ...orderData });

            // Aggregate items
            if (orderData.items) {
                allItems = allItems.concat(orderData.items);
            }

            // Sum totals
            totalSubtotal += orderData.subtotal || 0;
            totalCgst += orderData.cgst || 0;
            totalSgst += orderData.sgst || 0;
            totalAmount += orderData.totalAmount || 0;

            // Get common fields from first order
            if (!dineInToken) dineInToken = orderData.dineInToken;
            if (!tableId) tableId = orderData.tableId;
            if (!tabName) tabName = orderData.tab_name;
            if (!paxCount) paxCount = orderData.pax_count;

            // Latest status (last order's status)
            latestStatus = orderData.status;
        });

        // Get restaurant info
        const businessDoc = await firestore.collection('restaurants').doc(restaurantId).get();
        if (!businessDoc.exists) {
            return NextResponse.json({ message: 'Restaurant not found.' }, { status: 404 });
        }
        const businessData = businessDoc.data();

        const responsePayload = {
            tab: {
                id: tabId,
                dineInToken,
                tableId,
                tabName,
                paxCount,
                status: latestStatus,
                totalOrders: orders.length,
            },
            aggregated: {
                items: allItems,
                subtotal: totalSubtotal,
                cgst: totalCgst,
                sgst: totalSgst,
                grandTotal: totalAmount,
            },
            orders: orders.map(o => ({
                id: o.id,
                status: o.status,
                items: o.items,
                totalAmount: o.totalAmount,
                orderDate: o.orderDate,
            })),
            restaurant: {
                id: businessDoc.id,
                name: businessData.name,
                address: businessData.address
            }
        };

        console.log("[API][Dine-In Tab Status] Successfully aggregated", orders.length, "orders");
        return NextResponse.json(responsePayload, { status: 200 });

    } catch (error) {
        console.error("[API][Dine-In Tab Status] ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
