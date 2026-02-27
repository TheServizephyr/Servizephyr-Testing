
import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

async function getBusinessRef(firestore, restaurantId) {
    let businessRef = firestore.collection('restaurants').doc(restaurantId);
    let businessSnap = await businessRef.get();

    if (businessSnap.exists) {
        return businessRef;
    }

    businessRef = firestore.collection('shops').doc(restaurantId);
    businessSnap = await businessRef.get();

    if (businessSnap.exists) {
        return businessRef;
    }

    return null;
}

export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const restaurantId = searchParams.get('restaurantId');
        const tableId = searchParams.get('tableId');

        if (!restaurantId || !tableId) {
            return NextResponse.json({ message: 'Restaurant ID and Table ID are required.' }, { status: 400 });
        }

        const firestore = await getFirestore();
        const businessInfo = await getBusinessRef(firestore, restaurantId);

        if (!businessInfo) {
            return NextResponse.json({ message: 'Business not found.' }, { status: 404 });
        }

        // Case-insensitive table lookup
        const tablesSnap = await businessInfo.collection('tables').get();

        let matchedTable = null;
        let actualTableId = null;

        tablesSnap.forEach(doc => {
            const data = doc.data();
            if (data.isDeleted) return; // Skip deleted tables
            if (doc.id.toLowerCase() === tableId.toLowerCase()) {
                matchedTable = data;
                actualTableId = doc.id;
            }
        });

        if (!matchedTable) {
            return NextResponse.json({ message: 'Table configuration not found.' }, { status: 404 });
        }

        const tableData = matchedTable;
        const maxCapacity = Number(tableData.max_capacity || 0);
        const dbCurrentPax = Math.max(0, Number(tableData.current_pax || 0));

        // Fetch joinable tabs for this table.
        // We keep both `active` and `inactive` sessions (inactive means party seated but no order yet).
        // Closed/completed tabs are excluded.
        const tabsSnap = await businessInfo.collection('dineInTabs')
            .where('tableId', '==', actualTableId)
            .get();
        const joinableTabsRaw = tabsSnap.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter((tab) => {
                const status = String(tab?.status || 'inactive').toLowerCase();
                return status !== 'closed' && status !== 'completed';
            });

        const activeOrdersQuery = await firestore.collection('orders')
            .where('restaurantId', '==', businessInfo.id)
            .where('deliveryType', '==', 'dine-in')
            .where('tableId', '==', actualTableId)
            .where('status', 'in', ['pending', 'accepted', 'confirmed', 'preparing', 'ready', 'ready_for_pickup', 'pay_at_counter'])
            .get();

        const activePartyPaxMap = new Map();
        const activeTabIdsFromOrders = new Set();
        activeOrdersQuery.docs.forEach((doc) => {
            const orderData = doc.data() || {};
            if (orderData.cleaned === true) return;
            const partyKey = orderData.dineInTabId
                || orderData.tabId
                || orderData.dineInToken
                || `${actualTableId}:${String(orderData.tab_name || orderData.customerName || doc.id).toLowerCase()}`;
            if (!activePartyPaxMap.has(partyKey)) {
                activePartyPaxMap.set(partyKey, Number(orderData.pax_count) || 1);
            }

            if (orderData.dineInTabId) activeTabIdsFromOrders.add(String(orderData.dineInTabId));
            if (orderData.tabId) activeTabIdsFromOrders.add(String(orderData.tabId));
        });

        // Use table doc pax as primary source for occupancy to stay consistent with owner dashboard.
        // Fallback to live orders only when table doc is still zero.
        const liveCurrentPax = Array.from(activePartyPaxMap.values()).reduce((sum, pax) => sum + pax, 0);
        const tableState = String(tableData.state || '').toLowerCase();
        const shouldTrustDbOnly = tableState === 'needs_cleaning';
        const current_pax = shouldTrustDbOnly
            ? Math.min(maxCapacity || dbCurrentPax, dbCurrentPax)
            : Math.min(maxCapacity || liveCurrentPax, dbCurrentPax > 0 ? dbCurrentPax : liveCurrentPax);

        let validActiveTabs = [];
        if (activeTabIdsFromOrders.size > 0) {
            validActiveTabs = joinableTabsRaw.filter(tab => activeTabIdsFromOrders.has(String(tab.id)));
            // If order records are legacy/inconsistent, still show joinable tabs when table has occupants.
            if (validActiveTabs.length === 0 && current_pax > 0) {
                validActiveTabs = joinableTabsRaw;
            }
        } else if (current_pax > 0) {
            // No active order-tab mapping found, but seats are occupied - show joinable tabs from tab docs.
            validActiveTabs = joinableTabsRaw;
        }

        // NEW: Check for uncleaned orders (delivered but not cleaned)
        const uncleanedOrdersQuery = await firestore.collection('orders')
            .where('restaurantId', '==', businessInfo.id)
            .where('deliveryType', '==', 'dine-in')
            .where('tableId', '==', actualTableId)
            .where('status', '==', 'delivered')
            .get();

        // Filter for orders that are NOT cleaned (cleaned field is missing or false)
        const uncleanedOrders = uncleanedOrdersQuery.docs.filter(doc => {
            const orderData = doc.data();
            return orderData.cleaned !== true;
        });

        const uncleanedOrdersCount = uncleanedOrders.length;
        const hasUncleanedOrders = uncleanedOrdersCount > 0 || tableState === 'needs_cleaning';

        // Calculate pax from uncleaned orders by UNIQUE party.
        // Multiple delivered orders from the same party should not multiply occupied dirty seats.
        const uncleanedPartyPaxMap = new Map();
        uncleanedOrders.forEach((doc) => {
            const orderData = doc.data() || {};
            const partyKey = orderData.dineInTabId
                || orderData.tabId
                || orderData.dineInToken
                || `${actualTableId}:${String(orderData.tab_name || orderData.customerName || doc.id).toLowerCase()}`;
            if (!uncleanedPartyPaxMap.has(partyKey)) {
                uncleanedPartyPaxMap.set(partyKey, Number(orderData.pax_count) || 1);
            }
        });
        const uncleanedPax = Array.from(uncleanedPartyPaxMap.values()).reduce((sum, pax) => sum + pax, 0);

        // Availability should reflect currently occupied seats, not historical uncleaned records.
        // Cleaning state is still returned separately via hasUncleanedOrders/uncleanedOrdersCount.
        const availableSeats = Math.max(0, maxCapacity - current_pax);

        console.log(`[API tables] Table ${actualTableId}: dbPax=${dbCurrentPax}, livePax=${liveCurrentPax}, finalPax=${current_pax}, uncleaned=${uncleanedOrdersCount} (${uncleanedPax} pax), available=${availableSeats}/${maxCapacity}`);

        return NextResponse.json({
            tableId: actualTableId, // Return actual table ID from database
            max_capacity: maxCapacity,
            current_pax,
            activeTabs: validActiveTabs,
            // Determine state based on the calculated pax count.
            state: tableState === 'needs_cleaning'
                ? 'needs_cleaning'
                : (current_pax >= maxCapacity ? 'full' : (current_pax > 0 ? 'occupied' : 'available')),
            // NEW: Cleaning status for customer-facing blocking
            hasUncleanedOrders,
            uncleanedOrdersCount,
            availableSeats
        }, { status: 200 });

    } catch (error) {
        console.error("GET TABLE STATUS ERROR:", error);
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
}

// POST: Public endpoint for customers to create a new tab (no auth required)
export async function POST(req) {
    try {
        const firestore = await getFirestore();
        const { action, tableId, restaurantId, pax_count, tab_name } = await req.json();

        if (action !== 'create_tab') {
            return NextResponse.json({ message: 'Invalid action.' }, { status: 400 });
        }

        if (!tableId || !restaurantId || !pax_count || !tab_name) {
            return NextResponse.json({ message: 'Table ID, Restaurant ID, pax count, and tab name are required.' }, { status: 400 });
        }

        const businessRef = await getBusinessRef(firestore, restaurantId);
        if (!businessRef) {
            return NextResponse.json({ message: 'Business not found.' }, { status: 404 });
        }

        // Case-insensitive table lookup
        const tablesSnap = await businessRef.collection('tables').get();

        let actualTableId = null;
        tablesSnap.forEach(doc => {
            const data = doc.data();
            if (data.isDeleted) return;
            if (doc.id.toLowerCase() === tableId.toLowerCase()) {
                actualTableId = doc.id;
            }
        });

        if (!actualTableId) {
            return NextResponse.json({ message: 'Table not found.' }, { status: 404 });
        }

        const tableRef = businessRef.collection('tables').doc(actualTableId);
        const newTabId = `tab_${Date.now()}`;

        try {
            await firestore.runTransaction(async (transaction) => {
                const tableDoc = await transaction.get(tableRef);
                if (!tableDoc.exists) throw new Error("Table not found.");

                const tableData = tableDoc.data();
                const maxCapacity = Number(tableData.max_capacity || 0);
                const dbCurrentPax = Math.max(0, Number(tableData.current_pax || 0));
                const requestedPax = Number(pax_count);

                if (!Number.isFinite(requestedPax) || requestedPax < 1) {
                    throw new Error('Invalid party size.');
                }

                // ✅ GROUND TRUTH: Calculate occupied pax from actual open dineInTabs (not stale table doc)
                const openTabsSnap = await transaction.get(
                    businessRef.collection('dineInTabs')
                        .where('tableId', '==', actualTableId)
                        .where('status', 'in', ['active', 'inactive'])
                );
                const tabBasedPax = openTabsSnap.docs.reduce((sum, doc) => {
                    return sum + Math.max(0, Number(doc.data()?.pax_count || 0));
                }, 0);

                // Use tab-based pax as the primary source; fallback to dbCurrentPax only if no tabs exist
                // and there are active orders (legacy case)
                let effectiveOccupiedPax = tabBasedPax;
                if (tabBasedPax === 0 && dbCurrentPax === 0) {
                    // Also check live orders as a safety net for legacy data
                    const activeOrdersQuery = firestore.collection('orders')
                        .where('restaurantId', '==', businessRef.id)
                        .where('deliveryType', '==', 'dine-in')
                        .where('tableId', '==', actualTableId)
                        .where('status', 'in', ['pending', 'accepted', 'confirmed', 'preparing', 'ready', 'ready_for_pickup', 'pay_at_counter']);
                    const activeOrdersSnap = await transaction.get(activeOrdersQuery);
                    const activePartyPaxMap = new Map();
                    activeOrdersSnap.docs.forEach((doc) => {
                        const orderData = doc.data() || {};
                        const partyKey = orderData.dineInTabId || orderData.tabId || doc.id;
                        if (!activePartyPaxMap.has(partyKey)) {
                            activePartyPaxMap.set(partyKey, Number(orderData.pax_count) || 1);
                        }
                    });
                    effectiveOccupiedPax = Array.from(activePartyPaxMap.values()).reduce((sum, pax) => sum + pax, 0);
                }

                const availableCapacity = Math.max(0, maxCapacity - effectiveOccupiedPax);
                console.log(`[API tables] create_tab capacity check ${actualTableId}: max=${maxCapacity}, dbPax=${dbCurrentPax}, tabPax=${tabBasedPax}, occupied=${effectiveOccupiedPax}, requested=${requestedPax}, available=${availableCapacity}`);

                if (requestedPax > availableCapacity) {
                    throw new Error(`Capacity exceeded. Only ${availableCapacity} seats available.`);
                }

                const newTabRef = businessRef.collection('dineInTabs').doc(newTabId);
                const newTabData = {
                    id: newTabId,
                    tableId: actualTableId, // Use actual table ID from database
                    restaurantId: businessRef.id,
                    status: 'inactive', // Tab starts as inactive until first order
                    tab_name,
                    pax_count: requestedPax,
                    createdAt: FieldValue.serverTimestamp(),
                    totalBill: 0,
                    orders: {}
                };
                transaction.set(newTabRef, newTabData);

                const nextPax = Math.min(maxCapacity || (effectiveOccupiedPax + requestedPax), effectiveOccupiedPax + requestedPax);
                transaction.update(tableRef, {
                    current_pax: nextPax,
                    state: nextPax >= maxCapacity ? 'full' : 'occupied'
                });
            });
            return NextResponse.json({ message: 'Tab created successfully!', tabId: newTabId }, { status: 201 });
        } catch (txError) {
            console.error("[API tables] Transaction Error (create_tab):", txError);
            return NextResponse.json({ message: txError.message }, { status: 400 });
        }

    } catch (error) {
        console.error("POST TABLE/TAB ERROR:", error);
        return NextResponse.json({ message: 'Internal Server Error: ' + error.message }, { status: 500 });
    }
}

// PATCH: Public endpoint for customer dine-in session actions
export async function PATCH(req) {
    try {
        const firestore = await getFirestore();
        const {
            restaurantId,
            tableId,
            tabId,
            action,
            trackingToken,
            pax_count,
            tab_name
        } = await req.json();

        if (!['customer_done', 'customer_exit', 'update_pax'].includes(action)) {
            return NextResponse.json({ message: 'Invalid action.' }, { status: 400 });
        }

        if (!restaurantId || !tableId) {
            return NextResponse.json({ message: 'Restaurant ID and Table ID are required.' }, { status: 400 });
        }

        const businessRef = await getBusinessRef(firestore, restaurantId);
        if (!businessRef) {
            return NextResponse.json({ message: 'Business not found.' }, { status: 404 });
        }

        // Case-insensitive table lookup
        const tablesSnap = await businessRef.collection('tables').get();

        let actualTableId = null;
        tablesSnap.forEach(doc => {
            const data = doc.data();
            if (data.isDeleted) return; // Skip deleted tables
            if (doc.id.toLowerCase() === tableId.toLowerCase()) {
                actualTableId = doc.id;
            }
        });

        if (!actualTableId) {
            return NextResponse.json({ message: 'Table not found.' }, { status: 404 });
        }

        const tableRef = businessRef.collection('tables').doc(actualTableId);

        // ✅ UPDATE PAX: Atomically update tab pax_count and recalculate table current_pax
        if (action === 'update_pax') {
            if (!tabId) {
                return NextResponse.json({ message: 'Tab ID is required to update pax.' }, { status: 400 });
            }
            const newPax = Number(pax_count);
            if (!Number.isFinite(newPax) || newPax < 1) {
                return NextResponse.json({ message: 'Invalid pax count.' }, { status: 400 });
            }

            const result = await firestore.runTransaction(async (transaction) => {
                const tableDoc = await transaction.get(tableRef);
                if (!tableDoc.exists) throw new Error('Table not found.');

                const tabRef = businessRef.collection('dineInTabs').doc(String(tabId));
                const tabSnap = await transaction.get(tabRef);
                if (!tabSnap.exists) throw new Error('Tab not found.');

                const oldPax = Number(tabSnap.data()?.pax_count || 0);
                const maxCapacity = Number(tableDoc.data()?.max_capacity || 0);

                // Recalculate total pax from all open tabs
                const openTabsSnap = await transaction.get(
                    businessRef.collection('dineInTabs')
                        .where('tableId', '==', actualTableId)
                        .where('status', 'in', ['active', 'inactive'])
                );

                let totalPax = 0;
                openTabsSnap.docs.forEach(doc => {
                    if (doc.id === String(tabId)) {
                        totalPax += newPax; // Use new value for this tab
                    } else {
                        totalPax += Math.max(0, Number(doc.data()?.pax_count || 0));
                    }
                });

                if (totalPax > maxCapacity) {
                    throw new Error(`Cannot update: total pax (${totalPax}) would exceed table capacity (${maxCapacity}).`);
                }

                // Update tab
                const tabUpdate = { pax_count: newPax, updatedAt: FieldValue.serverTimestamp() };
                if (tab_name) tabUpdate.tab_name = tab_name;
                transaction.update(tabRef, tabUpdate);

                // Update table
                transaction.update(tableRef, {
                    current_pax: totalPax,
                    state: totalPax >= maxCapacity ? 'full' : (totalPax > 0 ? 'occupied' : 'available')
                });

                return { oldPax, newPax, totalPax };
            });

            console.log(`[API tables] update_pax ${tabId}: ${result.oldPax} → ${result.newPax}, table total: ${result.totalPax}`);
            return NextResponse.json({ message: 'Pax updated successfully.', ...result }, { status: 200 });
        }

        // Legacy notify-only action (no seat release) kept for backward compatibility.
        if (action === 'customer_done' && !tabId) {
            await tableRef.update({
                state: 'needs_cleaning',
                customerMarkedDoneAt: FieldValue.serverTimestamp()
            });
            return NextResponse.json({ message: 'Table marked for cleaning. Thank you!' }, { status: 200 });
        }

        if (!tabId) {
            return NextResponse.json({ message: 'Tab ID is required to exit table.' }, { status: 400 });
        }

        // Optional token guard for customer-side calls.
        if (trackingToken) {
            const tokenOrdersSnap = await firestore.collection('orders')
                .where('trackingToken', '==', trackingToken)
                .limit(20)
                .get();

            const hasMatchingTokenOrder = tokenOrdersSnap.docs.some((doc) => {
                const data = doc.data() || {};
                const orderTabId = String(data.dineInTabId || data.tabId || '');
                const orderTableId = String(data.tableId || data.table || '').toLowerCase();
                return data.restaurantId === businessRef.id
                    && String(data.deliveryType || '').toLowerCase() === 'dine-in'
                    && orderTabId === String(tabId)
                    && orderTableId === String(actualTableId).toLowerCase();
            });

            if (!hasMatchingTokenOrder) {
                return NextResponse.json({ message: 'Invalid session token for this table tab.' }, { status: 403 });
            }
        }

        const result = await firestore.runTransaction(async (transaction) => {
            // ── ALL READS FIRST ──
            const tableDoc = await transaction.get(tableRef);
            if (!tableDoc.exists) {
                const err = new Error('Table not found.');
                err.status = 404;
                throw err;
            }

            const tabRef = businessRef.collection('dineInTabs').doc(String(tabId));
            const tabSnap = await transaction.get(tabRef);
            console.log(`[customer_exit] tabId="${tabId}", tabSnap.exists=${tabSnap.exists}`);

            const tabOrdersByPrimaryIdSnap = await transaction.get(
                firestore.collection('orders')
                    .where('restaurantId', '==', businessRef.id)
                    .where('deliveryType', '==', 'dine-in')
                    .where('tableId', '==', actualTableId)
                    .where('dineInTabId', '==', String(tabId))
            );

            let tabOrderDocs = tabOrdersByPrimaryIdSnap.docs;
            if (tabOrderDocs.length === 0) {
                const tabOrdersByLegacyIdSnap = await transaction.get(
                    firestore.collection('orders')
                        .where('restaurantId', '==', businessRef.id)
                        .where('deliveryType', '==', 'dine-in')
                        .where('tableId', '==', actualTableId)
                        .where('tabId', '==', String(tabId))
                );
                tabOrderDocs = tabOrdersByLegacyIdSnap.docs;
            }
            console.log(`[customer_exit] tabOrderDocs.length=${tabOrderDocs.length}`);

            // ✅ MOVED: Read openTabs BEFORE any writes (Firestore requirement)
            const openTabsSnap = await transaction.get(
                businessRef.collection('dineInTabs')
                    .where('tableId', '==', actualTableId)
                    .where('status', 'in', ['active', 'inactive'])
            );
            console.log(`[customer_exit] openTabsSnap: ${openTabsSnap.size} docs, actualTableId="${actualTableId}"`);
            openTabsSnap.docs.forEach(d => console.log(`  openTab: id="${d.id}" status="${d.data()?.status}" pax=${d.data()?.pax_count} tableId="${d.data()?.tableId}"`));

            if (!tabSnap.exists && tabOrderDocs.length === 0) {
                const err = new Error('Tab session not found.');
                err.status = 404;
                throw err;
            }

            // ── ALL WRITES BELOW ──
            const finalStatuses = new Set(['delivered', 'cancelled', 'rejected', 'picked_up', 'paid']);
            const activeOrders = tabOrderDocs.filter((doc) => {
                const status = String(doc.data()?.status || '').toLowerCase();
                return status && !finalStatuses.has(status);
            });
            const hasRunningOrders = activeOrders.length > 0;

            let paxToRelease = 0;
            if (tabSnap.exists) {
                const tabData = tabSnap.data() || {};
                paxToRelease = Math.max(0, Number(tabData.pax_count || 0));
                transaction.set(tabRef, {
                    status: 'closed',
                    closedAt: FieldValue.serverTimestamp(),
                    closedBy: 'customer',
                    exitReason: action
                }, { merge: true });
            }

            if (paxToRelease <= 0) {
                paxToRelease = Math.max(0, Number(tabOrderDocs[0]?.data()?.pax_count || 0));
            }
            console.log(`[customer_exit] paxToRelease=${paxToRelease}`);

            // Mark tab orders as cleaned so they move to history
            tabOrderDocs.forEach((doc) => {
                const orderUpdate = {
                    tableExitRequestedAt: FieldValue.serverTimestamp(),
                    tableExitRequestedBy: 'customer'
                };
                if (!hasRunningOrders) {
                    orderUpdate.cleaned = true;
                    orderUpdate.cleanedAt = FieldValue.serverTimestamp();
                }
                transaction.set(doc.ref, orderUpdate, { merge: true });
            });

            // Recalculate pax from pre-read openTabs data
            let recalculatedPax = openTabsSnap.docs.reduce((sum, doc) => {
                return sum + Math.max(0, Number(doc.data()?.pax_count || 0));
            }, 0);

            const tabFoundInOpen = openTabsSnap.docs.some((doc) => doc.id === String(tabId));
            console.log(`[customer_exit] recalculatedPax(before)=${recalculatedPax}, tabFoundInOpen=${tabFoundInOpen}`);

            if (tabFoundInOpen) {
                recalculatedPax = Math.max(0, recalculatedPax - paxToRelease);
            }

            const dbCurrentPax = Math.max(0, Number(tableDoc.data()?.current_pax || 0));
            const nextPax = openTabsSnap.empty
                ? Math.max(0, dbCurrentPax - paxToRelease)
                : Math.max(0, recalculatedPax);

            console.log(`[customer_exit] FINAL: dbCurrentPax=${dbCurrentPax}, nextPax=${nextPax}, openTabsSnap.empty=${openTabsSnap.empty}`);

            // When customer self-releases with no active orders → table is available immediately
            // When active orders remain → needs_cleaning (staff needs to handle those orders)
            let nextState = 'available';
            if (nextPax > 0) nextState = 'occupied';
            else if (hasRunningOrders) nextState = 'needs_cleaning';

            transaction.set(tableRef, {
                current_pax: nextPax,
                state: nextState,
                customerMarkedDoneAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });

            return { nextPax, paxToRelease, hasRunningOrders };
        });

        return NextResponse.json({
            message: result.hasRunningOrders
                ? 'Table session released. Active orders remain visible for staff.'
                : 'Table session closed successfully.',
            releasedSeats: result.paxToRelease,
            currentPax: result.nextPax,
            activeOrdersPreserved: result.hasRunningOrders
        }, { status: 200 });

    } catch (error) {
        console.error("PATCH TABLE ERROR:", error);
        const status = Number(error?.status) || 500;
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status });
    }
}
