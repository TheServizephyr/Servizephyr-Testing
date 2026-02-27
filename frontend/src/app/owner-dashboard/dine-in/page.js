
'use client';

import React, { useState, useEffect, useMemo, useRef, Suspense, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Printer, CheckCircle, IndianRupee, Users, Clock, ShoppingBag, Bell, MoreVertical, Trash2, QrCode, Download, Save, Wind, Edit, Table as TableIcon, History, Search, Salad, UtensilsCrossed, Droplet, PlusCircle, AlertTriangle, X, Wallet, Check, CookingPot, Bike, Home, Loader2, RotateCcw, Plus, Car } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { auth, db } from '@/lib/firebase';
import { collection, query, where, onSnapshot, doc } from 'firebase/firestore';
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow, isAfter, subDays } from 'date-fns';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import QRCode from 'qrcode.react';
import { useReactToPrint } from 'react-to-print';
import { toPng } from 'html-to-image';
import InfoDialog from '@/components/InfoDialog';
import { Checkbox } from '@/components/ui/checkbox';


import { usePolling } from '@/lib/usePolling';

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const ManageTablesModal = ({ isOpen, onClose, allTables, onEdit, onDelete, loading, onCreateNew, onShowQr }) => {
    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-background border-border text-foreground max-w-4xl">
                <DialogHeader className="flex flex-row justify-between items-center">
                    <div>
                        <DialogTitle>Manage All Tables</DialogTitle>
                        <DialogDescription>
                            View, edit, or delete all the tables you have created for your establishment.
                        </DialogDescription>
                    </div>
                    <Button onClick={onCreateNew}><PlusCircle size={16} className="mr-2" /> Create New Table</Button>
                </DialogHeader>
                <div className="max-h-[60vh] overflow-y-auto mt-4 pr-4">
                    <table className="w-full">
                        <thead className="bg-muted/50 sticky top-0">
                            <tr>
                                <th className="p-4 text-left font-semibold text-muted-foreground"><TableIcon size={16} className="inline mr-2" />Table Name</th>
                                <th className="p-4 text-left font-semibold text-muted-foreground"><Users size={16} className="inline mr-2" />Max Capacity</th>
                                <th className="p-4 text-left font-semibold text-muted-foreground"><Users size={16} className="inline mr-2" />Currently Occupied</th>
                                <th className="p-4 text-right font-semibold text-muted-foreground">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                [...Array(3)].map((_, i) => (
                                    <tr key={i} className="border-t border-border animate-pulse">
                                        <td className="p-4" colSpan={4}><div className="h-8 bg-muted rounded-md"></div></td>
                                    </tr>
                                ))
                            ) : allTables.length > 0 ? (
                                allTables.map(table => (
                                    <tr key={table.id} className="border-t border-border hover:bg-muted/50">
                                        <td className="p-4 font-semibold">{table.id}</td>
                                        <td className="p-4">{table.max_capacity}</td>
                                        <td className="p-4">{table.current_pax || 0}</td>
                                        <td className="p-4 flex justify-end gap-2">
                                            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => onShowQr(table)}>
                                                <QrCode size={16} />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => onEdit(table)}>
                                                <Edit size={16} />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive hover:bg-destructive/10" onClick={() => onDelete(table.id)}>
                                                <Trash2 size={16} />
                                            </Button>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan="4" className="text-center p-8 text-muted-foreground">No tables created yet.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </DialogContent>
        </Dialog>
    );
}

const DineInHistoryModal = ({ isOpen, onClose, closedTabs }) => {
    const [searchTerm, setSearchTerm] = useState('');

    const filteredTabs = useMemo(() => {
        if (!searchTerm) return closedTabs;
        return closedTabs.filter(tab =>
            tab.tableId.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (tab.tab_name && tab.tab_name.toLowerCase().includes(searchTerm.toLowerCase()))
        );
    }, [closedTabs, searchTerm]);

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-background border-border text-foreground max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Dine-In History (Last 30 Days)</DialogTitle>
                    <DialogDescription>A log of all closed tabs from the past 30 days.</DialogDescription>
                </DialogHeader>
                <div className="relative my-4">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search by table or tab name..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10"
                    />
                </div>
                <div className="max-h-[60vh] overflow-y-auto p-1 pr-4 space-y-3">
                    {filteredTabs.length > 0 ? (
                        filteredTabs.map(tab => (
                            <div key={tab.id} className="p-3 bg-muted rounded-lg flex justify-between items-center">
                                <div>
                                    <p className="font-semibold text-foreground">Table {tab.tableId} - {tab.tab_name}</p>
                                    <p className="text-xs text-muted-foreground">
                                        Closed {tab.closedAt ? formatDistanceToNow(new Date(tab.closedAt), { addSuffix: true }) : 'Recently'}
                                    </p>
                                </div>
                                <div className="text-right">
                                    <p className="font-bold text-lg text-primary">{formatCurrency(tab.totalBill)}</p>
                                    <p className="text-xs text-muted-foreground">via {tab.paymentMethod || 'Pay at Counter'}</p>
                                </div>
                            </div>
                        ))
                    ) : (
                        <p className="text-center py-10 text-muted-foreground">No history found for the last 30 days.</p>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};

const HistoryModal = ({ tableHistory, onClose }) => {
    if (!tableHistory) return null;

    const { tableId, events } = tableHistory;

    return (
        <Dialog open={true} onOpenChange={onClose}>
            <DialogContent className="bg-background border-border text-foreground">
                <DialogHeader>
                    <DialogTitle>Activity History for Table {tableId}</DialogTitle>
                    <DialogDescription>A log of all events that occurred at this table.</DialogDescription>
                </DialogHeader>
                <div className="max-h-[60vh] overflow-y-auto p-4 space-y-4">
                    {events.length > 0 ? (
                        events.map((event, index) => (
                            <div key={index} className="flex items-start gap-4">
                                <div className="bg-muted p-2 rounded-full mt-1">
                                    {event.type === 'order' ? <ShoppingBag size={16} className="text-primary" /> : <Bell size={16} className="text-yellow-500" />}
                                </div>
                                <div>
                                    <p className="font-semibold">{event.type === 'order' ? `Order Placed by ${event.customerName}` : 'Service Request'}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                                    </p>
                                    {event.type === 'order' && (
                                        <ul className="text-xs list-disc pl-4 mt-1 text-muted-foreground">
                                            {event.items.map((item, i) => <li key={i}>{item.qty}x {item.name}</li>)}
                                        </ul>
                                    )}
                                </div>
                                {event.type === 'order' && <p className="ml-auto font-semibold text-sm">{formatCurrency(event.totalAmount)}</p>}
                            </div>
                        ))
                    ) : (
                        <p className="text-center text-muted-foreground py-8">No activity recorded for this table yet.</p>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};


const BillModal = ({ order, restaurant, onClose, onPrint, printRef }) => {
    const allItems = useMemo(() => {
        return Object.values(order?.orders || {});
    }, [order?.orders]);

    const totalBill = useMemo(() => Object.values(order?.orders || {}).reduce((sum, o) => sum + (o.totalAmount || 0), 0), [order?.orders]);

    if (!order || !restaurant) return null;


    return (
        <Dialog open={true} onOpenChange={onClose}>
            <DialogContent className="bg-background border-border text-foreground max-w-md p-0">
                <div ref={printRef} className="font-mono text-black bg-white p-6">
                    <div className="text-center mb-6 border-b-2 border-dashed border-black pb-4">
                        <h1 className="text-xl font-bold uppercase">{restaurant.name}</h1>
                        <p className="text-xs">{
                            typeof restaurant.address === 'string'
                                ? restaurant.address
                                : `${restaurant.address?.street || ''}, ${restaurant.address?.city || ''}`
                        }</p>
                        {restaurant.gstin && <p className="text-xs mt-1">GSTIN: {restaurant.gstin}</p>}
                    </div>
                    <div className="mb-4 text-xs">
                        <p><strong>Table:</strong> {order.tableId}</p>
                        <p><strong>Date:</strong> {new Date().toLocaleDateString('en-IN')} - {new Date().toLocaleTimeString('en-IN')}</p>
                    </div>

                    <table className="w-full text-xs mb-4">
                        <thead className="border-y-2 border-dashed border-black">
                            <tr>
                                <th className="text-left font-bold py-1">ITEM</th>
                                <th className="text-center font-bold py-1">QTY</th>
                                <th className="text-right font-bold py-1">TOTAL</th>
                            </tr>
                        </thead>
                        <tbody>
                            {allItems.flatMap(o => o.items).map((item, index) => (
                                <tr key={index} className="border-b border-dotted border-black">
                                    <td className="py-1">{item.name}</td>
                                    <td className="text-center py-1">{item.quantity}</td>
                                    <td className="text-right py-1">{formatCurrency((item.totalPrice || item.price))}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    <div className="flex justify-between font-bold text-lg pt-1 mt-1 border-t-2 border-black">
                        <span>GRAND TOTAL</span>
                        <span>{formatCurrency(totalBill)}</span>
                    </div>

                    <div className="text-center mt-6 pt-4 border-t border-dashed border-black">
                        <p className="text-xs italic">Thank you for dining with us!</p>
                        <p className="text-xs font-bold mt-1">Powered by ServiZephyr</p>
                        <p className="text-xs italic mt-1">For exclusive offers and faster ordering, visit the ServiZephyr Customer Hub!</p>
                    </div>
                </div>
                <div className="p-4 bg-muted border-t border-border flex justify-end no-print">
                    <Button onClick={onPrint} className="bg-primary hover:bg-primary/90">
                        <Printer className="mr-2 h-4 w-4" /> Print Bill
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

const ConfirmationModal = ({ isOpen, onClose, onConfirm, title, description, confirmText, paymentMethod, setPaymentMethod, isDestructive = false }) => {
    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-background border-border text-foreground">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    {description && <DialogDescription>{description}</DialogDescription>}
                </DialogHeader>
                {paymentMethod && (
                    <div className="py-4">
                        <Label htmlFor="payment-method">Select Payment Method</Label>
                        <select
                            id="payment-method"
                            value={paymentMethod}
                            onChange={(e) => setPaymentMethod(e.target.value)}
                            className="mt-1 w-full p-2 border rounded-md bg-input border-border"
                        >
                            <option value="cod">Cash</option>
                            <option value="upi">UPI</option>
                            <option value="card">Card</option>
                            <option value="other">Other</option>
                        </select>
                    </div>
                )}
                <DialogFooter>
                    <Button variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button onClick={onConfirm} variant={isDestructive ? "destructive" : "default"}>
                        {confirmText}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


const actionConfig = {
    'confirmed': { text: 'Start Preparing', icon: CookingPot, next: 'preparing' },
    'preparing': { text: 'Ready to Serve', icon: ShoppingBag, next: 'ready_for_pickup' },
    'ready_for_pickup': { text: 'Mark as Served', icon: Home, next: 'delivered' },
};


const TableCard = ({ tableData, onMarkAsPaid, onPrintBill, onMarkAsCleaned, onConfirmOrder, onRejectOrder, onClearTab, onUpdateStatus, onMarkForCleaning, buttonLoading, lastBulkAction, setLastBulkAction, setConfirmationState, userRole, canPerformAction }) => {
    const state = tableData.state;
    const stateConfig = {
        available: { title: "Available", bg: "bg-card", border: "border-border", icon: <CheckCircle size={16} className="text-green-500" /> },
        occupied: { title: `Occupied (${tableData.current_pax || 0}/${tableData.max_capacity})`, bg: "bg-yellow-500/10", border: "border-yellow-500", icon: <Users size={16} className="text-yellow-500" /> },
        needs_cleaning: { title: "Needs Cleaning", bg: "bg-red-500/10", border: "border-red-500", icon: <Wind size={16} className="text-red-500" /> },
        // ✅ NEW: Car Order override config (Indigo/Blue theme)
        car_occupied: { title: `Spot: ${tableData.carSpot || 'N/A'}`, bg: "bg-indigo-50 dark:bg-indigo-900/20", border: "border-indigo-500", icon: <Car size={16} className="text-indigo-600 dark:text-indigo-400" /> }
    };

    // Determine config: Check if it's a car order
    const isCarOrder = tableData.type === 'car-order';
    const effectiveState = isCarOrder ? 'car_occupied' : state;
    const currentConfig = stateConfig[effectiveState] || stateConfig.available;

    // Combine pending orders and active tabs into one list for rendering
    const allGroups = [...(tableData.pendingOrders || []), ...Object.values(tableData.tabs || {})];

    // SORT BY TIME: Newest orders/tabs first (Latest on Top)
    allGroups.sort((a, b) => {
        const parseTime = (val) => {
            if (!val) return 0;
            if (typeof val === 'object' && val._seconds) return val._seconds * 1000;
            const d = new Date(val);
            return isNaN(d.getTime()) ? 0 : d.getTime();
        };

        const getLatestTime = (group) => {
            let time = parseTime(group.createdAt);

            // Also check internal orders for latest activity
            if (group.orders) {
                const orderTimes = Object.values(group.orders).map(o => parseTime(o.createdAt));
                if (orderTimes.length > 0) {
                    const maxOrderTime = Math.max(...orderTimes);
                    if (maxOrderTime > time) time = maxOrderTime;
                }
            }
            // Also check orderBatches if structured that way
            if (group.orderBatches) {
                const batchTimes = group.orderBatches.map(b => parseTime(b.createdAt || b.orderDate));
                if (batchTimes.length > 0) {
                    const maxBatchTime = Math.max(...batchTimes);
                    if (maxBatchTime > time) time = maxBatchTime;
                }
            }
            return time;
        };

        const timeA = getLatestTime(a);
        const timeB = getLatestTime(b);
        return timeB - timeA; // Descending = Newest first
    });

    // Color palette for multi-tab visual distinction
    const TAB_COLORS = [
        { border: 'border-l-4 border-l-yellow-500', bg: 'bg-yellow-500/5', badge: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
        { border: 'border-l-4 border-l-blue-500', bg: 'bg-blue-500/5', badge: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
        { border: 'border-l-4 border-l-green-500', bg: 'bg-green-500/5', badge: 'bg-green-500/20 text-green-400 border-green-500/30' },
        { border: 'border-l-4 border-l-purple-500', bg: 'bg-purple-500/5', badge: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
        { border: 'border-l-4 border-l-pink-500', bg: 'bg-pink-500/5', badge: 'bg-pink-500/20 text-pink-400 border-pink-500/30' },
    ];

    // 🚨 CRITICAL FIX: Pre-filter groups to remove tabs where ALL orders are cancelled/rejected
    // This prevents empty table cards from showing as "Occupied" with ghost "Active Tabs"
    const activeGroups = allGroups.filter(group => {
        const allOrders = Object.values(group.orders || {});
        const activeOrders = allOrders.filter(o => o.status !== 'cancelled' && o.status !== 'rejected');
        return activeOrders.length > 0; // Only keep groups with at least 1 active order
    });

    // Count tabs for same table to enable multi-tab features - ONLY active groups
    const tabCount = activeGroups.length; // Count ONLY groups with active orders
    const hasMultipleTabs = tabCount > 1;

    return (
        <motion.div layout initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}>
            <Card className={cn("flex flex-col h-full shadow-lg hover:shadow-primary/20 transition-shadow duration-300 border-2", currentConfig.border)}>
                <CardHeader className={cn("flex-row items-center justify-between space-y-0 pb-2", currentConfig.bg)}>
                    <CardTitle className="text-2xl font-bold">
                        {isCarOrder ? (
                            <div className="flex flex-col">
                                <span className="text-lg">Car Order</span>
                                <span className="text-xs font-normal text-muted-foreground">{tableData.carDetails || 'No details'}</span>
                            </div>
                        ) : tableData.id}
                    </CardTitle>
                    <div className="flex items-center gap-2 text-sm font-semibold">{currentConfig.icon} {currentConfig.title}</div>
                </CardHeader>

                <CardContent className="flex-grow p-2 sm:p-3">
                    {activeGroups.length > 0 ? (
                        <div className="space-y-2">
                            {/* Multi-tab header - show when multiple active tabs exist */}
                            {hasMultipleTabs && (
                                <div className="px-3 py-2 bg-muted/30 rounded-lg border border-border/50">
                                    <p className="text-xs font-semibold text-muted-foreground flex items-center gap-2">
                                        <Users size={14} />
                                        <span>{tabCount} Active Tabs on this table</span>
                                    </p>
                                </div>
                            )}

                            {activeGroups.map((group, groupIndex) => {
                                // Robust Tab ID extraction to persist across status changes
                                const effectiveTabId = group.dineInTabId || group.tabId || (group.orders && Object.values(group.orders)[0]?.tabId) || group.id;

                                // New logic: use group.status and group.mainStatus from API
                                const isPending = group.status === 'pending' || group.hasPending;
                                const isActiveTab = group.status === 'active' && !group.hasPending;

                                // Get ALL orders in this group
                                const allOrders = Object.values(group.orders || {});

                                // ✅ FIX: Filter out cancelled/rejected orders from active display
                                const activeOrders = allOrders.filter(o => o.status !== 'cancelled' && o.status !== 'rejected');

                                // 🚨 CRITICAL FIX: If ALL orders are cancelled/rejected, skip this tab entirely
                                // Don't show it in active view - it should only appear in history
                                if (activeOrders.length === 0) {
                                    return null; // Skip rendering this tab
                                }

                                const firstOrder = activeOrders[0] || group;

                                // Use mainStatus for determining which action button to show - ONLY from active orders
                                const mainStatus = group.mainStatus || firstOrder?.status || 'pending';

                                // Calculate totals from API or compute - ONLY from active orders
                                const totalBill = group.totalAmount || activeOrders.reduce((sum, o) => sum + (o.totalAmount || o.grandTotal || 0), 0);
                                const allItems = group.items || activeOrders.flatMap(o => o.items || []);

                                // Payment status - dine-in is POSTPAID by default
                                // isPaid = true ONLY if: (1) paid online via razorpay, OR (2) paymentStatus explicitly set to 'paid'
                                const isOnlinePayment = group.paymentDetails?.method === 'razorpay' || firstOrder?.paymentDetails?.method === 'razorpay';
                                const isPaidStatus = group.paymentStatus === 'paid' || activeOrders.some(o => o.paymentStatus === 'paid');
                                const isPaid = isOnlinePayment || isPaidStatus;

                                // Check if customer chose "Pay at Counter"
                                const isPayAtCounter = group.paymentStatus === 'pay_at_counter' || activeOrders.some(o => o.paymentStatus === 'pay_at_counter');

                                // Status checks
                                const isServed = mainStatus === 'delivered';

                                // Action button config based on mainStatus
                                const actionDetails = actionConfig[mainStatus];
                                const ActionIcon = actionDetails ? actionDetails.icon : null;

                                // For pending orders, find the pending order IDs to confirm - ONLY from active orders
                                const pendingOrderIds = activeOrders.filter(o => o.status === 'pending').map(o => o.id);
                                const firstPendingOrderId = pendingOrderIds[0];

                                // For active orders, find the first non-delivered order to update - ONLY from active orders
                                const activeOrderToUpdate = activeOrders.find(o => o.status !== 'delivered' && o.status !== 'pending');
                                const orderIdToUpdate = activeOrderToUpdate?.id;

                                // Color coding for multi-tab tables - apply to ALL tabs (pending or active)
                                const tabColor = hasMultipleTabs ? TAB_COLORS[groupIndex % TAB_COLORS.length] : null;
                                const activeTabIndex = groupIndex + 1; // Simple 1-based index

                                // VISUAL PRIORITY: Red urgency for pending orders >15 mins
                                // Use orderDate field (Firebase Timestamp with _seconds)
                                const orderTimestamp = firstOrder?.orderDate || group.orderDate;
                                const orderCreatedAt = orderTimestamp?._seconds ? orderTimestamp._seconds * 1000 : null;

                                const minutesSinceOrder = orderCreatedAt ? Math.floor((Date.now() - orderCreatedAt) / 60000) : 0;
                                const isUrgent = mainStatus === 'pending' && minutesSinceOrder > 15;
                                const urgencyText = isUrgent ? `URGENT - ${minutesSinceOrder}m ago` : null;

                                return (
                                    <div key={group.id} className={cn("relative p-3 rounded-lg border",
                                        isUrgent ? "bg-red-500/10 border-red-500 border-2" : (
                                            isPending ? "bg-yellow-500/10 border-yellow-500/30" : "bg-muted/50 border-border"
                                        ),
                                        tabColor && !isUrgent ? `${tabColor.border} ${tabColor.bg}` : ""
                                    )}>
                                        {/* Tab Badge for multi-tab tables */}
                                        {tabColor && hasMultipleTabs && (
                                            <div className={cn("absolute -top-2 -right-2 px-2 py-0.5 rounded-full text-xs font-bold border", tabColor.badge)}>
                                                Tab {activeTabIndex}/{tabCount}
                                            </div>
                                        )}

                                        {/* URGENCY BADGE for old pending orders - positioned at BOTTOM LEFT to avoid Tab badge */}
                                        {isUrgent && (
                                            <div className="absolute -bottom-2 -left-2 px-2 py-0.5 rounded-full text-xs font-bold bg-red-500 text-white border border-red-600 animate-pulse">
                                                {urgencyText}
                                            </div>
                                        )}

                                        {/* Header */}
                                        <div className="flex justify-between items-center mb-2">
                                            <div>
                                                <h4 className="font-semibold text-foreground">
                                                    {group.tab_name || group.customerName || 'Guest'}
                                                    {/* ✅ HIDE Pax Count for Car Orders */}
                                                    {!isCarOrder && <span className="text-xs text-muted-foreground"> ({group.pax_count || 1} guests)</span>}
                                                </h4>
                                                {/* ORDER TIME - Show how long ago order was placed */}
                                                {orderCreatedAt && (
                                                    <p className={cn("text-xs font-medium mt-0.5",
                                                        isUrgent ? "text-red-400" : "text-muted-foreground"
                                                    )}>
                                                        <Clock size={12} className="inline mr-1" />
                                                        {minutesSinceOrder < 60
                                                            ? `${minutesSinceOrder}m ago`
                                                            : `${Math.floor(minutesSinceOrder / 60)}h ${minutesSinceOrder % 60}m ago`
                                                        }
                                                    </p>
                                                )}
                                            </div>
                                            <div className="text-right">
                                                {group.dineInToken && <p className="text-xs font-bold text-yellow-600 dark:text-yellow-400">TOKEN: {group.dineInToken}</p>}
                                                {(group.ordered_by || firstOrder?.ordered_by) && (
                                                    <p className={cn("text-xs font-medium",
                                                        (group.ordered_by || firstOrder?.ordered_by)?.startsWith('waiter')
                                                            ? "text-blue-500 dark:text-blue-400" : "text-green-600 dark:text-green-400"
                                                    )}>
                                                        {(group.ordered_by || firstOrder?.ordered_by)?.startsWith('waiter')
                                                            ? `📱 ${group.ordered_by_name || 'Waiter'}` : '📲 Via QR'}
                                                    </p>
                                                )}
                                            </div>
                                        </div>

                                        {/* Order Batches - Display individual orders with timestamps */}
                                        {group.orderBatches && group.orderBatches.length > 0 ? (
                                            <div className="space-y-3 my-2">
                                                {group.orderBatches.map((b, i) => ({ ...b, _originalIndex: i + 1 })).sort((a, b) => {
                                                    const getT = (v) => v?._seconds ? v._seconds * 1000 : new Date(v || 0).getTime();
                                                    return getT(b.orderDate) - getT(a.orderDate);
                                                }).map((orderBatch) => {
                                                    // Calculate time ago for this order
                                                    const orderTime = orderBatch.orderDate?._seconds
                                                        ? new Date(orderBatch.orderDate._seconds * 1000)
                                                        : null;
                                                    const now = new Date();
                                                    const minutesAgo = orderTime
                                                        ? Math.floor((now - orderTime) / (1000 * 60))
                                                        : null;

                                                    // Check if this is a recent order (< 5 minutes)
                                                    const isRecent = minutesAgo !== null && minutesAgo < 5;

                                                    // Status color mapping
                                                    const statusColors = {
                                                        'pending': 'border-blue-500/50 bg-blue-500/5',
                                                        'confirmed': 'border-yellow-500/50 bg-yellow-500/5',
                                                        'preparing': 'border-orange-500/50 bg-orange-500/5',
                                                        'ready_for_pickup': 'border-green-500/50 bg-green-500/5',
                                                        'delivered': 'border-green-600/50 bg-green-600/5',
                                                        'cancelled': 'border-red-500/50 bg-red-500/5 opacity-70',
                                                        'rejected': 'border-red-500/50 bg-red-500/5 opacity-70',
                                                    };

                                                    const statusBadgeColors = {
                                                        'pending': 'bg-blue-500 text-white',
                                                        'confirmed': 'bg-yellow-500 text-black',
                                                        'preparing': 'bg-orange-500 text-white',
                                                        'ready_for_pickup': 'bg-green-500 text-white',
                                                        'delivered': 'bg-green-600 text-white',
                                                        'cancelled': 'bg-red-500 text-white',
                                                        'rejected': 'bg-red-500 text-white',
                                                    };

                                                    return (
                                                        <div
                                                            key={orderBatch.id}
                                                            className={cn(
                                                                "border-2 rounded-lg p-2 relative",
                                                                statusColors[orderBatch.status] || 'border-border/50 bg-muted/5'
                                                            )}
                                                        >

                                                            {/* Order Header with Batch Number, Time, and Status */}
                                                            <div className="flex justify-between items-center mb-1.5">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-xs font-semibold text-muted-foreground">
                                                                        📦 Order #{orderBatch._originalIndex}
                                                                    </span>
                                                                    {minutesAgo !== null && (
                                                                        <span className="text-xs text-muted-foreground flex items-center">
                                                                            <Clock size={10} className="mr-1" />
                                                                            {minutesAgo < 60
                                                                                ? `${minutesAgo}m ago`
                                                                                : `${Math.floor(minutesAgo / 60)}h ${minutesAgo % 60}m ago`
                                                                            }
                                                                        </span>
                                                                    )}
                                                                    {/* NEW Badge for recent orders */}
                                                                    {isRecent && (
                                                                        <span className="bg-blue-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                                                                            NEW
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                {/* Status Badge */}
                                                                <span className={cn(
                                                                    "text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase",
                                                                    statusBadgeColors[orderBatch.status] || 'bg-gray-500 text-white'
                                                                )}>
                                                                    {orderBatch.status === 'ready_for_pickup' ? 'Ready' : orderBatch.status}
                                                                </span>
                                                            </div>

                                                            {/* Items in this order batch with ADDONS */}
                                                            <div className={cn("space-y-0.5 text-xs", (orderBatch.status === 'cancelled' || orderBatch.status === 'rejected') && "line-through text-muted-foreground")}>
                                                                {orderBatch.items && orderBatch.items.map((item, itemIdx) => {
                                                                    // Calculate addon total
                                                                    const addonTotal = item.selectedAddOns?.reduce((sum, addon) =>
                                                                        sum + (addon.price * (addon.quantity || 1)), 0) || 0;

                                                                    // Base price = totalPrice - addons (since totalPrice includes addons)
                                                                    const itemTotalPrice = item.totalPrice || item.price || 0;
                                                                    const basePrice = itemTotalPrice - addonTotal;

                                                                    return (
                                                                        <div key={itemIdx}>
                                                                            <div className="flex justify-between items-center text-muted-foreground">
                                                                                <span>{item.quantity || item.qty} × {item.name}</span>
                                                                                <span>{formatCurrency(basePrice)}</span>
                                                                            </div>
                                                                            {/* ✅ Show Addons */}
                                                                            {item.selectedAddOns && item.selectedAddOns.length > 0 && (
                                                                                <div className="ml-3 mt-0.5 space-y-0.5">
                                                                                    {item.selectedAddOns.map((addon, addonIdx) => (
                                                                                        <div key={addonIdx} className="flex justify-between text-[10px] text-muted-foreground/70">
                                                                                            <span>+ {addon.name} {addon.quantity > 1 ? `(x${addon.quantity})` : ''}</span>
                                                                                            <span>₹{addon.price * (addon.quantity || 1)}</span>
                                                                                        </div>
                                                                                    ))}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                            {/* Order Total */}
                                                            <div className="flex justify-between items-center text-xs font-semibold mt-1.5 pt-1.5 border-t border-border/30">
                                                                <span className="text-muted-foreground">Order Total:</span>
                                                                <span className="text-foreground">{formatCurrency(orderBatch.totalAmount)}</span>
                                                            </div>

                                                            {/* Action Buttons - Compact row layout */}
                                                            <div className="mt-1.5 flex gap-1">
                                                                {/* Main progression button - RBAC PROTECTED */}
                                                                {(() => {
                                                                    const batchActionConfig = {
                                                                        'confirmed': { label: 'Start Preparing', next: 'preparing', className: 'bg-orange-500 hover:bg-orange-600', icon: CookingPot },
                                                                        'preparing': { label: 'Mark Ready', next: 'ready_for_pickup', className: 'bg-green-500 hover:bg-green-600', icon: ShoppingBag },
                                                                        'ready_for_pickup': { label: 'Mark Served', next: 'delivered', className: 'bg-emerald-600 hover:bg-emerald-700', icon: Home }
                                                                    };
                                                                    const batchAction = batchActionConfig[orderBatch.status];
                                                                    const ActionIcon = batchAction?.icon;

                                                                    // 🔐 RBAC: Check if user has permission to perform this action
                                                                    if (!batchAction) return null;
                                                                    if (userRole && !canPerformAction(orderBatch.status, batchAction.next, userRole)) {
                                                                        return null; // User doesn't have permission
                                                                    }

                                                                    return (
                                                                        <Button
                                                                            size="sm"
                                                                            className={batchAction.className + " flex-1 text-white text-xs h-7"}
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                onUpdateStatus(orderBatch.id, batchAction.next);
                                                                            }}
                                                                            disabled={buttonLoading === `status_${orderBatch.id}`}
                                                                        >
                                                                            {buttonLoading === `status_${orderBatch.id}` && ActionIcon && <ActionIcon size={12} className="mr-1" />}
                                                                            {batchAction.label}
                                                                        </Button>
                                                                    );
                                                                })()}

                                                                {/* Undo button - Separated to show even when main action is hidden (e.g., delivered) */}
                                                                {(() => {
                                                                    const undoMap = {
                                                                        'confirmed': 'pending',
                                                                        'preparing': 'confirmed',
                                                                        'ready_for_pickup': 'preparing',
                                                                        'delivered': 'ready_for_pickup'
                                                                    };
                                                                    const undoPrev = undoMap[orderBatch.status];

                                                                    return undoPrev && (
                                                                        <Button
                                                                            size="sm"
                                                                            variant="outline"
                                                                            className="w-9 h-7 p-0 border-orange-400 text-orange-500 hover:bg-orange-500/10"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                setConfirmationState({
                                                                                    isOpen: true,
                                                                                    title: "Undo",
                                                                                    description: `Undo back to ${undoPrev}?`,
                                                                                    confirmText: "Undo",
                                                                                    paymentMethod: null,
                                                                                    onConfirm: async () => {
                                                                                        onUpdateStatus(orderBatch.id, undoPrev);
                                                                                        setConfirmationState({ isOpen: false });
                                                                                    }
                                                                                });
                                                                            }}
                                                                            disabled={buttonLoading === `status_${orderBatch.id}`}
                                                                            title="Undo"
                                                                        >
                                                                            <RotateCcw size={14} />
                                                                        </Button>
                                                                    );
                                                                })()}

                                                                {/* Cancel button only for truly pre-confirmation states */}
                                                                {orderBatch.canCancel && ['pending', 'placed', 'accepted'].includes(String(orderBatch.status || '').toLowerCase()) && (
                                                                    <Button
                                                                        size="sm"
                                                                        variant="ghost"
                                                                        className="flex-1 text-red-500 hover:text-red-600 hover:bg-red-500/10 text-xs h-7"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setConfirmationState({
                                                                                isOpen: true,
                                                                                title: "Cancel Order",
                                                                                description: `Cancel Order #${orderBatch._originalIndex}?`,
                                                                                confirmText: "Cancel",
                                                                                isDestructive: true,
                                                                                paymentMethod: null,
                                                                                onConfirm: async () => {
                                                                                    onRejectOrder(orderBatch.id);
                                                                                    setConfirmationState({ isOpen: false });
                                                                                }
                                                                            });
                                                                        }}
                                                                        disabled={buttonLoading === `status_${orderBatch.id}`}
                                                                    >
                                                                        <X size={11} className="mr-0.5" />
                                                                        Cancel
                                                                    </Button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            // Fallback to legacy merged items display if orderBatches not available
                                            allItems.length > 0 && (
                                                <div className="space-y-1 text-sm max-h-32 overflow-y-auto pr-2 my-2">
                                                    {allItems.map((item, i) => (
                                                        <div key={i} className="flex justify-between items-center text-muted-foreground">
                                                            <span>{item.quantity || item.qty} x {item.name}</span>
                                                            <span>{formatCurrency((item.totalPrice || item.price))}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )
                                        )}

                                        {/* Bill & Payment Status */}
                                        {totalBill > 0 && (
                                            <div className="mt-3 pt-3 border-t border-dashed border-border/50">
                                                <div className="flex justify-between items-center font-bold">
                                                    <span>Total Bill:</span>
                                                    <span className="text-lg text-emerald-700 dark:text-yellow-400">{formatCurrency(totalBill)}</span>
                                                </div>
                                                <div className="flex justify-between items-center text-xs mt-1">
                                                    <span>Payment Status:</span>
                                                    <span className={cn('font-semibold',
                                                        isPaid ? 'text-green-500' :
                                                            isPayAtCounter ? 'text-orange-500' :
                                                                isServed ? 'text-yellow-500' : 'text-muted-foreground'
                                                    )}>
                                                        {isPaid ? 'PAID ✓' :
                                                            isPayAtCounter ? '🏪 Pay at Counter Pending' :
                                                                isServed ? 'Payment Due' : 'Not Served Yet'}
                                                    </span>
                                                </div>
                                            </div>
                                        )}

                                        {/* Action Buttons based on status */}
                                        <div className="mt-4 space-y-2">
                                            {isPending ? (
                                                /* PENDING: Bulk Confirm All + Individual Reject per batch */
                                                <>
                                                    {/* Bulk Confirm All Pending Orders */}
                                                    {(() => {
                                                        const pendingBatches = group.orderBatches?.filter(b => ['pending', 'confirmed'].includes(b.status)) || [];
                                                        const pendingOrderIds = pendingBatches.map(b => b.id);

                                                        return pendingBatches.length > 0 && (
                                                            <Button
                                                                size="sm"
                                                                className="w-full bg-yellow-500 hover:bg-yellow-600 text-black font-semibold"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    // Track this bulk action for global undo
                                                                    setLastBulkAction({
                                                                        type: 'confirm_all',
                                                                        orderIds: pendingOrderIds,
                                                                        prevStatus: 'pending',
                                                                        tableId: tableData.id,
                                                                        tabId: group.dineInTabId,
                                                                        timestamp: Date.now()
                                                                    });
                                                                    // Confirm all pending orders at once
                                                                    pendingOrderIds.forEach(orderId => onConfirmOrder(orderId));
                                                                }}
                                                                disabled={buttonLoading !== null && pendingOrderIds.some(id => buttonLoading === `status_${id}`)}
                                                            >
                                                                {(buttonLoading !== null && pendingOrderIds.some(id => buttonLoading === `status_${id}`)) ? (
                                                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                                ) : (
                                                                    <Check className="mr-2 h-4 w-4" />
                                                                )}
                                                                Confirm All Pending ({pendingBatches.length} order{pendingBatches.length > 1 ? 's' : ''})
                                                            </Button>
                                                        );
                                                    })()}

                                                    {/* Global Undo Button (appears after bulk action on this table) */}
                                                    {lastBulkAction && lastBulkAction.tableId === tableData.id && (
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            className="w-full border-orange-500 text-orange-500 hover:bg-orange-500/10 font-semibold"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setConfirmationState({
                                                                    isOpen: true,
                                                                    title: "Undo Bulk Action",
                                                                    description: `Undo last bulk action? ${lastBulkAction.orderIds.length} orders will revert to ${lastBulkAction.prevStatus} status.`,
                                                                    confirmText: "Undo All",
                                                                    onConfirm: async () => {
                                                                        // Revert all orders to previous status
                                                                        lastBulkAction.orderIds.forEach(orderId => {
                                                                            handleUpdateStatus(orderId, lastBulkAction.prevStatus);
                                                                        });
                                                                        // Clear the bulk action
                                                                        setLastBulkAction(null);
                                                                        setConfirmationState({ isOpen: false });
                                                                    }
                                                                });
                                                            }}
                                                            disabled={buttonLoading !== null}
                                                        >
                                                            <History className="mr-2 h-4 w-4" />
                                                            Undo Last Bulk Action ({lastBulkAction.orderIds.length})
                                                        </Button>
                                                    )}

                                                    {/* Reject All Pending (Optional) */}
                                                    {(() => {
                                                        const pendingBatches = group.orderBatches?.filter(b => b.status === 'pending') || [];
                                                        const pendingOrderIds = pendingBatches.map(b => b.id);

                                                        return pendingBatches.length > 1 && (
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                className="w-full border-red-500/50 text-red-500 hover:bg-red-500/10"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    if (confirm(`Reject all ${pendingBatches.length} pending orders?`)) {
                                                                        pendingOrderIds.forEach(orderId => onRejectOrder(orderId));
                                                                    }
                                                                }}
                                                                disabled={buttonLoading !== null}
                                                            >
                                                                <X className="mr-2 h-4 w-4" />
                                                                Reject All Pending ({pendingBatches.length})
                                                            </Button>
                                                        );
                                                    })()}
                                                </>
                                            ) : (
                                                /* NON-PENDING: Show bulk progression buttons + individual actions */
                                                <>
                                                    {/* BULK PROGRESSION BUTTONS */}
                                                    <div className="mt-2 flex gap-1">
                                                        {/* BULK PROGRESSION BUTTON */}
                                                        {(() => {
                                                            const bulkProgressionConfig = {
                                                                'confirmed': {
                                                                    label: 'Start Preparing All',
                                                                    next: 'preparing',
                                                                    className: 'bg-orange-500 hover:bg-orange-600',
                                                                    icon: CookingPot
                                                                },
                                                                'preparing': {
                                                                    label: 'Mark All Ready',
                                                                    next: 'ready_for_pickup',
                                                                    className: 'bg-green-500 hover:bg-green-600',
                                                                    icon: ShoppingBag
                                                                },
                                                                'ready_for_pickup': {
                                                                    label: 'Mark All Served',
                                                                    next: 'delivered',
                                                                    className: 'bg-emerald-600 hover:bg-emerald-700',
                                                                    icon: Home
                                                                }
                                                            };

                                                            // Find all orders with current mainStatus
                                                            const statusBatches = group.orderBatches?.filter(b => b.status === mainStatus) || [];
                                                            const statusOrderIds = statusBatches.map(b => b.id);
                                                            const bulkAction = bulkProgressionConfig[mainStatus];
                                                            const BulkIcon = bulkAction?.icon;

                                                            if (!bulkAction || statusBatches.length <= 1) return null;

                                                            return (
                                                                <Button
                                                                    size="sm"
                                                                    className={bulkAction.className + " flex-1 text-white font-semibold h-auto py-1.5 whitespace-normal leading-tight"}
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        // Track bulk action for undo
                                                                        setLastBulkAction({
                                                                            type: 'bulk_progress',
                                                                            orderIds: statusOrderIds,
                                                                            prevStatus: mainStatus,
                                                                            tableId: tableData.id,
                                                                            tabId: effectiveTabId,
                                                                            timestamp: Date.now()
                                                                        });
                                                                        // Update all orders at once
                                                                        statusOrderIds.forEach(orderId => onUpdateStatus(orderId, bulkAction.next));
                                                                    }}
                                                                    disabled={buttonLoading !== null}
                                                                >
                                                                    {buttonLoading ? (
                                                                        <Loader2 className="mr-2 h-4 w-4 animate-spin shrink-0" />
                                                                    ) : (
                                                                        BulkIcon && <BulkIcon className="mr-2 h-4 w-4 shrink-0" />
                                                                    )}
                                                                    <span>{bulkAction.label} ({statusBatches.length})</span>
                                                                </Button>
                                                            );
                                                        })()}

                                                        {/* PERSISTENT BULK REVERT BUTTON (Always visible for valid states) */}
                                                        {(() => {
                                                            const reverseConfig = {
                                                                'preparing': 'confirmed',
                                                                'ready_for_pickup': 'preparing',
                                                                'delivered': 'ready_for_pickup'
                                                            };
                                                            const prevStatus = reverseConfig[mainStatus];

                                                            // Recalculate batches for this scope
                                                            const statusBatches = group.orderBatches?.filter(b => b.status === mainStatus) || [];

                                                            // Show if previous status exists AND (more than 1 item OR status is delivered where main button is hidden)
                                                            if (!prevStatus || statusBatches.length === 0) return null;
                                                            if (statusBatches.length <= 1 && mainStatus !== 'delivered') return null;

                                                            const orderIds = statusBatches.map(b => b.id);

                                                            return (
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="border-orange-500 text-orange-500 hover:bg-orange-500/10 h-auto px-3"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setConfirmationState({
                                                                            isOpen: true,
                                                                            title: "Revert Bulk Action",
                                                                            description: `Revert ${orderIds.length} orders back to ${prevStatus}?`,
                                                                            confirmText: "Revert",
                                                                            paymentMethod: null,
                                                                            onConfirm: async () => {
                                                                                orderIds.forEach(id => onUpdateStatus(id, prevStatus));
                                                                                setConfirmationState({ isOpen: false });
                                                                            }
                                                                        });
                                                                    }}
                                                                    title={`Revert All to ${prevStatus}`}
                                                                >
                                                                    <RotateCcw className="h-4 w-4" />
                                                                </Button>
                                                            );
                                                        })()}
                                                    </div>

                                                    {/* Status Display */}
                                                    {mainStatus && mainStatus !== 'pending' && (
                                                        <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground mt-2">
                                                            <span>STATUS:</span>
                                                            <span className={cn(
                                                                mainStatus === 'delivered' ? 'text-green-500' :
                                                                    mainStatus === 'ready_for_pickup' ? 'text-green-400' :
                                                                        mainStatus === 'preparing' ? 'text-orange-500' :
                                                                            'text-yellow-500'
                                                            )}>
                                                                {mainStatus === 'ready_for_pickup' ? 'Ready' :
                                                                    mainStatus.charAt(0).toUpperCase() + mainStatus.slice(1)}
                                                            </span>
                                                        </div>
                                                    )}

                                                    {/* Pay at Counter Action or Served & Unpaid - RBAC PROTECTED */}
                                                    {(isPayAtCounter || (isServed && !isPaid)) && (
                                                        (userRole === 'owner' || userRole === 'manager' || userRole === 'cashier') ? (
                                                            <Button
                                                                size="sm"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    onMarkAsPaid(tableData.id, group.id);
                                                                }}
                                                                className="w-full bg-green-500 hover:bg-green-600 animate-pulse mt-2 shadow-sm"
                                                            >
                                                                <Wallet className="mr-2 h-4 w-4" />
                                                                Mark as Paid
                                                            </Button>
                                                        ) : (
                                                            <Button
                                                                size="sm"
                                                                disabled={true}
                                                                className="w-full mt-2 cursor-not-allowed opacity-50"
                                                                title="Ask owner, manager, or cashier to mark this payment"
                                                            >
                                                                <Wallet className="mr-2 h-4 w-4" />
                                                                Ask Cashier to Mark Paid
                                                            </Button>
                                                        )
                                                    )}

                                                    {/* Payment Received -> Clean Table Button - RBAC PROTECTED */}
                                                    {/* This consolidated button appears when tab is Paid, replacing the 2-step Need Cleaning -> Clear process */}
                                                    {(isPaid || group.needsCleaning) && (
                                                        (userRole === 'waiter' || userRole === 'owner' || userRole === 'manager') ? (
                                                            <Button
                                                                variant="default" // Changed to default (primary) for positive action
                                                                size="sm"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    // Use clear tab directly as "Clean Table" implies finishing the session
                                                                    onClearTab(group.dineInTabId || group.id, tableData.id, group.pax_count);
                                                                }}
                                                                className="w-full mt-2 bg-blue-600 hover:bg-blue-700"
                                                            >
                                                                <Wind className="mr-2 h-4 w-4" />
                                                                Clean Table
                                                            </Button>
                                                        ) : (
                                                            <Button
                                                                size="sm"
                                                                disabled={true}
                                                                className="w-full mt-2 cursor-not-allowed opacity-50"
                                                                title="Call waiter to clean this table"
                                                            >
                                                                <Wind className="mr-2 h-4 w-4" />
                                                                Ask Waiter to Clean
                                                            </Button>
                                                        )
                                                    )}

                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="w-full mt-2"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onPrintBill({ tableId: tableData.id, ...group });
                                                        }}
                                                    >
                                                        <Printer className="mr-2 h-4 w-4" />
                                                        Print Bill
                                                    </Button>
                                                </>
                                            )}
                                        </div>

                                        {/* Clear tab X button (only for empty/no-bill tabs) */}
                                        {!isPending && totalBill === 0 && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onClearTab(group.dineInTabId || group.id, tableData.id, group.pax_count);
                                                }}
                                                className="absolute top-2 right-2 p-1.5 bg-background/50 text-destructive rounded-full hover:bg-destructive hover:text-destructive-foreground"
                                            >
                                                <X size={14} />
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="flex-grow p-4 flex flex-col items-center justify-center text-center">
                            <p className="text-muted-foreground">{state === 'needs_cleaning' ? "Ready to be cleaned." : "This table is available."}</p>
                        </div>
                    )}
                </CardContent>

                {
                    (state === 'needs_cleaning') && (
                        <CardFooter className="p-4 mt-auto">
                            <Button className="w-full bg-green-500 hover:bg-green-600" onClick={() => onMarkAsCleaned(tableData.id)}>
                                <CheckCircle size={16} className="mr-2" /> Mark as Cleaned
                            </Button>
                        </CardFooter>
                    )
                }
            </Card >
        </motion.div >
    );
};


const QrCodeDisplay = ({ text, tableName, innerRef, qrType = 'table', restaurantName = '' }) => {
    const isCarSpotTheme = qrType === 'car-spot';
    const qrStyle = { shapeRendering: 'crispEdges' };

    const handleDownload = async () => {
        const printableNode = innerRef?.current;
        if (!printableNode) return;

        try {
            const pngUrl = await toPng(printableNode, {
                cacheBust: true,
                pixelRatio: 4,
                backgroundColor: '#ffffff'
            });

            const downloadLink = document.createElement("a");
            downloadLink.href = pngUrl;
            downloadLink.download = `${tableName}-qrcode-card.png`;
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
            return;
        } catch (error) {
            console.warn('[QR Download] Card image download failed, falling back to raw QR canvas.', error);
        }

        const canvas = printableNode.querySelector('canvas');
        if (!canvas) {
            const svg = printableNode.querySelector('svg');
            if (!svg) return;

            // Secondary fallback: download raw SVG when PNG conversion is unavailable.
            const serialized = new XMLSerializer().serializeToString(svg);
            const blob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
            const objectUrl = URL.createObjectURL(blob);
            const downloadLink = document.createElement("a");
            downloadLink.href = objectUrl;
            downloadLink.download = `${tableName}-qrcode.svg`;
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
            URL.revokeObjectURL(objectUrl);
            return;
        }

        const pngUrl = canvas.toDataURL("image/png").replace("image/png", "image/octet-stream");
        const downloadLink = document.createElement("a");
        downloadLink.href = pngUrl;
        downloadLink.download = `${tableName}-qrcode.png`;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
    };

    const handlePrint = useReactToPrint({
        content: () => innerRef.current,
        documentTitle: `QR_Code_${tableName}`,
    });

    return (
        <div className="mt-6 flex flex-col items-center gap-4">
            {isCarSpotTheme ? (
                <div ref={innerRef} className="bg-white rounded-[28px] border-4 border-yellow-400 shadow-2xl overflow-hidden w-full max-w-[360px]">
                    <div className="bg-gradient-to-br from-yellow-300 via-yellow-200 to-white px-5 py-5 text-center border-b border-yellow-200">
                        <p className="text-[10px] font-bold tracking-[0.3em] text-yellow-900 uppercase">ServiZephyr</p>
                        <h3 className="mt-2 text-2xl leading-tight font-black text-black uppercase break-words">
                            {restaurantName || 'Restaurant'}
                        </h3>
                        <p className="mt-3 text-2xl font-extrabold text-yellow-700 tracking-wide">ORDER HERE 👇</p>
                    </div>

                    <div className="px-5 pt-5 pb-4 text-center bg-white">
                        <div className="inline-flex items-center justify-center p-3 rounded-2xl border-2 border-yellow-300 shadow-md bg-white">
                            <QRCode
                                value={text}
                                size={230}
                                level="H"
                                includeMargin={true}
                                renderAs="svg"
                                style={qrStyle}
                                imageSettings={{
                                    src: '/logo.png',
                                    height: 48,
                                    width: 48,
                                    excavate: true
                                }}
                            />
                        </div>

                        <p className="mt-4 text-sm font-bold text-black">
                            {tableName}
                        </p>
                        <p className="mt-1 text-xs text-gray-700">
                            Scan this QR to place your car order instantly.
                        </p>
                        <p className="mt-1 text-xs text-yellow-700 font-semibold">
                            Sit tight, we will bring your order to your spot.
                        </p>

                        <div className="mt-4 pt-3 border-t border-yellow-200">
                            <p className="text-[11px] font-bold text-black uppercase tracking-wide">
                                Powered by ServiZephyr
                            </p>
                        </div>
                    </div>
                </div>
            ) : (
                <div ref={innerRef} className="bg-white p-4 rounded-lg border border-border flex flex-col items-center">
                    <QRCode
                        value={text}
                        size={1024}
                        level={"M"}
                        includeMargin={true}
                        renderAs="svg"
                        style={qrStyle}
                    />
                    <p className="text-center font-bold text-lg mt-2 text-black">Scan to Order: {tableName}</p>
                </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-sm">
                <Button onClick={handlePrint} variant="outline"><Printer className="mr-2 h-4 w-4" /> Print</Button>
                <Button onClick={handleDownload} variant="outline"><Download className="mr-2 h-4 w-4" /> Download PNG</Button>
            </div>
        </div>
    );
};

const QrGeneratorModal = ({ isOpen, onClose, onSaveTable, restaurantId, initialTable, onEditTable, onDeleteTable, showInfoDialog }) => {
    const [tableName, setTableName] = useState('');
    const [maxCapacity, setMaxCapacity] = useState(4);
    const [qrValue, setQrValue] = useState('');
    const printRef = useRef();

    useEffect(() => {
        if (isOpen) {
            if (initialTable) {
                setTableName(initialTable.id);
                setMaxCapacity(initialTable.max_capacity || 4);
                if (restaurantId && initialTable.id) {
                    const url = `${window.location.origin}/order/${restaurantId}?table=${initialTable.id}`;
                    setQrValue(url);
                } else {
                    setQrValue('');
                }
            } else {
                setTableName('');
                setMaxCapacity(4);
                setQrValue('');
            }
        }
    }, [isOpen, initialTable, restaurantId]);

    const handleGenerate = () => {
        if (!tableName.trim()) {
            showInfoDialog({ isOpen: true, title: 'Input Error', message: "Please enter a table name or number." });
            return;
        }
        if (!restaurantId) {
            showInfoDialog({ isOpen: true, title: 'Error', message: "Restaurant ID is missing. Cannot generate QR code." });
            return;
        }
        const url = `${window.location.origin}/order/${restaurantId}?table=${tableName.trim()}`;
        setQrValue(url);
    };

    const handleSave = async () => {
        if (!tableName.trim() || !maxCapacity || maxCapacity < 1) {
            showInfoDialog({ isOpen: true, title: 'Input Error', message: 'Please enter a valid table name and capacity.' });
            return;
        }
        try {
            if (initialTable) {
                await onEditTable(initialTable.id, tableName.trim(), maxCapacity);
            } else {
                await onSaveTable(tableName.trim(), maxCapacity);
            }
            handleGenerate();
        } catch (error) {
            // error is handled by parent
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-background border-border text-foreground">
                <DialogHeader>
                    <DialogTitle>{initialTable ? `Manage Table: ${initialTable.id}` : 'Create a New Table'}</DialogTitle>
                    <DialogDescription>
                        {initialTable ? 'Edit table details. The QR code will update automatically.' : 'Create a new table. A unique QR code will be generated upon saving.'}
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                        <div className="col-span-2">
                            <Label htmlFor="table-name">Table Name / Number</Label>
                            <Input
                                id="table-name"
                                value={tableName}
                                onChange={(e) => setTableName(e.target.value)}
                                placeholder="e.g., T1, Rooftop 2"
                            />
                        </div>
                        <div>
                            <Label htmlFor="max-capacity">Max Capacity</Label>
                            <Input
                                id="max-capacity"
                                type="number"
                                value={maxCapacity}
                                onChange={(e) => setMaxCapacity(parseInt(e.target.value, 10))}
                                placeholder="e.g., 4"
                                min="1"
                            />
                        </div>
                    </div>
                    <Button onClick={handleSave} className="w-full bg-primary hover:bg-primary/90">
                        <Save className="mr-2 h-4 w-4" /> {initialTable ? 'Save Changes' : 'Save Table & Generate QR'}
                    </Button>

                    {qrValue && <QrCodeDisplay text={qrValue} tableName={tableName} innerRef={printRef} />}

                    {initialTable && (
                        <div className="pt-4 border-t border-dashed">
                            <Button onClick={() => { onDeleteTable(initialTable.id); onClose(); }} variant="destructive" className="w-full">
                                <Trash2 className="mr-2 h-4 w-4" /> Delete This Table
                            </Button>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};

const QrCodeDisplayModal = ({ isOpen, onClose, restaurant, table }) => {
    const printRef = useRef();

    if (!table || !restaurant?.id) return null;
    const qrValue = `${window.location.origin}/order/${restaurant.id}?table=${table.id}`;

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-background border-border text-foreground">
                <DialogHeader>
                    <DialogTitle>QR Code for Table: {table.id}</DialogTitle>
                    <DialogDescription>
                        Customers can scan this code with their phone camera to open the menu and order directly from this table.
                    </DialogDescription>
                </DialogHeader>
                <QrCodeDisplay text={qrValue} tableName={table.id} innerRef={printRef} />
            </DialogContent>
        </Dialog>
    );
};

// ✅ NEW: Car Spot QR Generator + Saved List Modal
const CarSpotQrModal = ({ isOpen, onClose, restaurant, handleApiCall, showInfoDialog }) => {
    const [spotLabel, setSpotLabel] = useState('');
    const [qrValue, setQrValue] = useState('');
    const [savedSpots, setSavedSpots] = useState([]);
    const [loadingSpots, setLoadingSpots] = useState(false);
    const [savingSpot, setSavingSpot] = useState(false);
    const [deletingSpotId, setDeletingSpotId] = useState(null);
    const printRef = useRef();

    const buildCarSpotUrl = (label) => {
        const safeLabel = String(label || '').trim();
        if (!safeLabel || !restaurant?.id || typeof window === 'undefined') return '';
        return `${window.location.origin}/order/${restaurant.id}?orderType=car&spot=${encodeURIComponent(safeLabel)}`;
    };

    const loadSavedSpots = async () => {
        if (!restaurant?.id || !handleApiCall) return;

        setLoadingSpots(true);
        try {
            const data = await handleApiCall('GET', null, '/api/owner/car-spots');
            setSavedSpots(Array.isArray(data?.spots) ? data.spots : []);
        } catch (error) {
            console.error('[Car Spot QR] Failed to load spots:', error);
            showInfoDialog?.({ isOpen: true, title: 'Error', message: `Could not load saved car spots: ${error.message}` });
        } finally {
            setLoadingSpots(false);
        }
    };

    useEffect(() => {
        if (!isOpen) {
            setSpotLabel('');
            setQrValue('');
            return;
        }
        loadSavedSpots();
    }, [isOpen]);

    const handleGenerate = () => {
        const trimmedSpot = String(spotLabel || '').trim();
        if (!trimmedSpot || !restaurant?.id) return;
        setQrValue(buildCarSpotUrl(trimmedSpot));
    };

    const handleSaveSpot = async () => {
        const trimmedSpot = String(spotLabel || '').trim();
        if (!trimmedSpot) {
            showInfoDialog?.({ isOpen: true, title: 'Missing Spot', message: 'Please enter a spot label first.' });
            return;
        }

        setSavingSpot(true);
        try {
            const data = await handleApiCall('POST', { spotLabel: trimmedSpot }, '/api/owner/car-spots');
            const savedSpot = data?.spot;
            if (savedSpot?.id) {
                setSavedSpots((prev) => [savedSpot, ...prev.filter((spot) => spot.id !== savedSpot.id)]);
            } else {
                await loadSavedSpots();
            }
            setQrValue(buildCarSpotUrl(trimmedSpot));
            showInfoDialog?.({ isOpen: true, title: 'Saved', message: `Car spot "${trimmedSpot}" saved successfully.` });
        } catch (error) {
            showInfoDialog?.({ isOpen: true, title: 'Error', message: `Could not save car spot: ${error.message}` });
        } finally {
            setSavingSpot(false);
        }
    };

    const handleSelectSpot = (spot) => {
        const selectedSpot = String(spot?.spotLabel || '').trim();
        if (!selectedSpot) return;
        setSpotLabel(selectedSpot);
        setQrValue(buildCarSpotUrl(selectedSpot));
    };

    const handleCopySpotUrl = async (spot) => {
        const url = buildCarSpotUrl(spot?.spotLabel);
        if (!url) return;
        try {
            await navigator.clipboard.writeText(url);
            showInfoDialog?.({ isOpen: true, title: 'Copied', message: `Link copied for spot "${spot.spotLabel}".` });
        } catch (error) {
            showInfoDialog?.({ isOpen: true, title: 'Copy Failed', message: 'Could not copy link.' });
        }
    };

    const handleDeleteSpot = async (spot) => {
        if (!spot?.id) return;
        setDeletingSpotId(spot.id);
        try {
            await handleApiCall('DELETE', { spotId: spot.id }, '/api/owner/car-spots');
            setSavedSpots((prev) => prev.filter((savedSpot) => savedSpot.id !== spot.id));
            showInfoDialog?.({ isOpen: true, title: 'Deleted', message: `Removed car spot "${spot.spotLabel}".` });
        } catch (error) {
            showInfoDialog?.({ isOpen: true, title: 'Error', message: `Could not delete car spot: ${error.message}` });
        } finally {
            setDeletingSpotId(null);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-background border-border text-foreground max-w-2xl w-full max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>🚗 Car Spot QR Manager</DialogTitle>
                    <DialogDescription>
                        Generate and save car spot QR links. Saved spots will remain available here.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2 items-end">
                        <div>
                            <Label htmlFor="spot-label">Car Spot Label</Label>
                            <Input
                                id="spot-label"
                                value={spotLabel}
                                onChange={(e) => setSpotLabel(e.target.value)}
                                placeholder="e.g., A1, B2, P-01"
                                className="mt-1"
                            />
                            <p className="text-xs text-muted-foreground mt-1">This label appears on QR and in order cards.</p>
                        </div>
                        <Button onClick={handleGenerate} className="w-full md:w-auto bg-indigo-600 hover:bg-indigo-700 text-white">
                            <QrCode className="mr-2 h-4 w-4" /> Preview
                        </Button>
                        <Button onClick={handleSaveSpot} disabled={savingSpot} className="w-full md:w-auto">
                            <Save className="mr-2 h-4 w-4" /> {savingSpot ? 'Saving...' : 'Save Spot'}
                        </Button>
                    </div>

                    {qrValue && (
                        <div className="flex flex-col items-center border border-border rounded-lg p-4 bg-muted/20">
                            <QrCodeDisplay
                                text={qrValue}
                                tableName={`Car Spot ${spotLabel}`}
                                innerRef={printRef}
                                qrType="car-spot"
                                restaurantName={restaurant?.name}
                            />
                        </div>
                    )}

                    <div className="pt-2 border-t border-dashed border-border">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="font-semibold text-sm">Saved Car Spot QRs</h3>
                            <Button variant="outline" size="sm" onClick={loadSavedSpots} disabled={loadingSpots}>
                                <RefreshCw className={cn("mr-2 h-3.5 w-3.5", loadingSpots && "animate-spin")} />
                                Refresh
                            </Button>
                        </div>

                        {loadingSpots ? (
                            <div className="text-sm text-muted-foreground py-3">Loading saved spots...</div>
                        ) : savedSpots.length === 0 ? (
                            <div className="text-sm text-muted-foreground py-3 border border-dashed border-border rounded-lg px-3">
                                No saved car spots yet. Click &quot;Save Spot&quot; after entering label.
                            </div>
                        ) : (
                            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                                {savedSpots.map((spot) => {
                                    const spotUrl = buildCarSpotUrl(spot.spotLabel);
                                    const updatedAtLabel = spot.updatedAt
                                        ? formatDistanceToNow(new Date(spot.updatedAt), { addSuffix: true })
                                        : null;

                                    return (
                                        <div key={spot.id} className="border border-border rounded-lg p-3 bg-card">
                                            <div className="flex flex-col sm:flex-row gap-3">
                                                <div className="shrink-0">
                                                    <QRCode
                                                        value={spotUrl || 'about:blank'}
                                                        size={72}
                                                        level="H"
                                                        bgColor="#FFFFFF"
                                                        fgColor="#111111"
                                                        renderAs="svg"
                                                        style={{ shapeRendering: 'crispEdges' }}
                                                    />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-semibold text-sm">{spot.spotLabel}</p>
                                                    <p className="text-xs text-muted-foreground break-all mt-1">{spotUrl}</p>
                                                    {updatedAtLabel && (
                                                        <p className="text-[11px] text-muted-foreground mt-1">Updated {updatedAtLabel}</p>
                                                    )}
                                                    <div className="flex flex-wrap gap-2 mt-3">
                                                        <Button variant="outline" size="sm" onClick={() => handleSelectSpot(spot)}>
                                                            Use
                                                        </Button>
                                                        <Button variant="outline" size="sm" onClick={() => handleCopySpotUrl(spot)}>
                                                            Copy Link
                                                        </Button>
                                                        <Button
                                                            variant="destructive"
                                                            size="sm"
                                                            onClick={() => handleDeleteSpot(spot)}
                                                            disabled={deletingSpotId === spot.id}
                                                        >
                                                            {deletingSpotId === spot.id ? 'Deleting...' : 'Delete'}
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

const LiveServiceRequests = ({ impersonatedOwnerId, employeeOfOwnerId }) => {
    const [requests, setRequests] = useState([]);
    const [isExpanded, setIsExpanded] = useState(true);

    const handleAcknowledge = async (requestId) => {
        try {
            const user = auth.currentUser;
            if (!user) throw new Error("Authentication required.");
            const idToken = await user.getIdToken();
            let url = '/api/owner/service-requests';
            if (impersonatedOwnerId) url += `?impersonate_owner_id=${impersonatedOwnerId}`;
            else if (employeeOfOwnerId) url += `?employee_of=${employeeOfOwnerId}`;

            await fetch(url, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify({ requestId: requestId, status: 'acknowledged' }),
            });
        } catch (error) {
            console.error("Failed to acknowledge request", error);
        }
    };

    useEffect(() => {
        const user = auth.currentUser;
        if (!user) return;

        const fetchRequests = async () => {
            const idToken = await user.getIdToken();
            let url = new URL('/api/owner/service-requests', window.location.origin);
            if (impersonatedOwnerId) {
                url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
            } else if (employeeOfOwnerId) {
                url.searchParams.append('employee_of', employeeOfOwnerId);
            }
            const res = await fetch(url.toString(), { headers: { 'Authorization': `Bearer ${idToken}` } });
            if (res.ok) {
                const data = await res.json();
                setRequests(data.requests || []);
            }
        };

        fetchRequests();
        const interval = setInterval(fetchRequests, 15000);
        return () => clearInterval(interval);
    }, [impersonatedOwnerId, employeeOfOwnerId]);


    if (requests.length === 0 && !isExpanded) return null;

    return (
        <AnimatePresence>
            {isExpanded && (
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className="relative overflow-hidden backdrop-blur-xl bg-gradient-to-br from-amber-100 via-orange-100 to-yellow-100 dark:from-amber-500/20 dark:via-orange-500/15 dark:to-yellow-500/20 border border-amber-300 dark:border-amber-400/30 shadow-2xl shadow-amber-500/20 rounded-2xl p-6 mb-6"
                >
                    {/* Animated background gradient orbs */}
                    <div className="absolute top-0 right-0 w-32 h-32 bg-amber-300/30 dark:bg-amber-400/20 rounded-full blur-3xl"></div>
                    <div className="absolute bottom-0 left-0 w-24 h-24 bg-orange-300/30 dark:bg-orange-400/20 rounded-full blur-3xl"></div>

                    {/* Header with animated bell icon */}
                    <div className="relative z-10">
                        <div className="flex items-center gap-3 mb-4">
                            <motion.div
                                animate={{
                                    rotate: [0, -15, 15, -15, 15, 0],
                                    scale: [1, 1.1, 1.1, 1.1, 1.1, 1]
                                }}
                                transition={{
                                    duration: 0.6,
                                    repeat: Infinity,
                                    repeatDelay: 3
                                }}
                                className="bg-gradient-to-br from-amber-400 to-orange-500 p-3 rounded-xl shadow-lg"
                            >
                                <Bell size={20} className="text-white" />
                            </motion.div>
                            <div>
                                <h3 className="font-bold text-xl bg-gradient-to-r from-amber-700 via-orange-600 to-amber-700 dark:from-amber-200 dark:via-yellow-200 dark:to-orange-200 bg-clip-text text-transparent">
                                    Live Service Requests
                                </h3>
                                <p className="text-xs text-amber-700 dark:text-amber-200/70">Customer needs assistance</p>
                            </div>
                            {requests.length > 0 && (
                                <motion.span
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    className="ml-auto bg-gradient-to-r from-red-500 to-orange-500 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-lg"
                                >
                                    {requests.length} Active
                                </motion.span>
                            )}
                        </div>

                        {/* Request cards */}
                        {requests.length > 0 ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                {requests.map((req, index) => (
                                    <motion.div
                                        key={req.id}
                                        initial={{ opacity: 0, scale: 0.9, y: 20 }}
                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.9, x: 100 }}
                                        transition={{ delay: index * 0.1 }}
                                        whileHover={{ scale: 1.02, y: -2 }}
                                        className="group relative backdrop-blur-lg bg-gradient-to-br from-white/90 to-amber-50/80 dark:from-white/10 dark:to-white/5 border border-amber-300 dark:border-white/20 rounded-xl p-4 shadow-xl hover:shadow-2xl hover:shadow-amber-500/30 transition-all duration-300"
                                    >
                                        {/* Shimmer effect on hover */}
                                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-200/20 dark:via-white/10 to-transparent opacity-0 group-hover:opacity-100 group-hover:animate-shimmer rounded-xl"></div>

                                        <div className="relative z-10 flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="bg-gradient-to-br from-amber-400 to-orange-500 p-2 rounded-lg">
                                                    <span className="text-white font-bold text-sm">T{req.tableId}</span>
                                                </div>
                                                <div>
                                                    <p className="font-semibold text-amber-900 dark:text-amber-100 text-sm">Table {req.tableId}</p>
                                                    <p className="text-xs text-amber-700 dark:text-amber-200/70">Needs assistance!</p>
                                                </div>
                                            </div>
                                            <motion.button
                                                whileHover={{ scale: 1.1, rotate: 15 }}
                                                whileTap={{ scale: 0.95 }}
                                                onClick={() => handleAcknowledge(req.id)}
                                                className="bg-gradient-to-r from-green-400 to-emerald-500 hover:from-green-500 hover:to-emerald-600 p-2 rounded-lg shadow-lg hover:shadow-green-500/50 transition-all"
                                            >
                                                <CheckCircle size={18} className="text-white" />
                                            </motion.button>
                                        </div>

                                        {/* Pulse ring animation */}
                                        <motion.div
                                            animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
                                            transition={{ duration: 2, repeat: Infinity }}
                                            className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full"
                                        ></motion.div>
                                    </motion.div>
                                ))}
                            </div>
                        ) : (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="text-center py-8"
                            >
                                <div className="inline-block bg-green-100 dark:bg-green-500/20 border border-green-300 dark:border-green-400/30 rounded-full p-4 mb-3">
                                    <CheckCircle size={32} className="text-green-600 dark:text-green-300" />
                                </div>
                                <p className="text-sm text-amber-800 dark:text-amber-200/90 font-medium">All clear! No active service requests.</p>
                                <p className="text-xs text-amber-600 dark:text-amber-200/60 mt-1">Your team is doing great! 🎉</p>
                            </motion.div>
                        )}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

const getOrderPaymentMethod = (order) => {
    const paymentDetails = Array.isArray(order?.paymentDetails)
        ? order.paymentDetails[0]
        : order?.paymentDetails;
    return order?.paymentMethod || paymentDetails?.method || null;
};

const resolveCarOrderTokenKey = (order) => {
    return String(
        order?.dineInToken ||
        order?.token ||
        order?.trackingToken ||
        order?.customerPhone ||
        order?.id
    ).trim();
};

const buildCarTabGroupId = (carSpot, tokenKey) => {
    const safeSpot = String(carSpot || '').replace(/\s+/g, '_');
    const safeToken = String(tokenKey || '').replace(/\s+/g, '_');
    return `car_${safeSpot}_${safeToken}`;
};

const buildCarVirtualTables = (carOrders = []) => {
    const carOrdersBySpot = {};
    (carOrders || []).forEach((order) => {
        const rawSpot = String(order?.carSpot || '').trim();
        const spotKey = rawSpot || `Unassigned-${order.id}`;
        if (!carOrdersBySpot[spotKey]) {
            carOrdersBySpot[spotKey] = [];
        }
        carOrdersBySpot[spotKey].push(order);
    });

    return Object.entries(carOrdersBySpot).map(([spot, spotOrders]) => {
        const firstOrder = spotOrders[0] || {};
        const ordersByToken = {};

        spotOrders.forEach((order) => {
            const tokenKey = resolveCarOrderTokenKey(order);
            if (!ordersByToken[tokenKey]) {
                ordersByToken[tokenKey] = [];
            }
            ordersByToken[tokenKey].push(order);
        });

        const tabs = {};
        Object.entries(ordersByToken).forEach(([tokenKey, tokenOrders]) => {
            const statuses = tokenOrders.map((o) => o.status);
            let groupStatus = 'delivered';
            if (statuses.includes('pending')) groupStatus = 'pending';
            else if (statuses.includes('confirmed')) groupStatus = 'confirmed';
            else if (statuses.includes('preparing')) groupStatus = 'preparing';
            else if (statuses.includes('ready_for_pickup')) groupStatus = 'ready_for_pickup';

            const mainOrder = tokenOrders[0] || {};
            const ordersMap = {};
            let totalAmount = 0;
            let isPaid = true;

            tokenOrders.forEach((order) => {
                ordersMap[order.id] = order;
                totalAmount += Number(order.totalAmount || order.grandTotal || 0);
                const paymentMethod = getOrderPaymentMethod(order);
                const isOnline = paymentMethod === 'razorpay' || paymentMethod === 'phonepe';
                const paidStatus = order.paymentStatus === 'paid';
                if (!isOnline && !paidStatus) {
                    isPaid = false;
                }
            });

            const groupId = buildCarTabGroupId(spot, tokenKey);
            const orderBatches = tokenOrders
                .map((order) => ({
                    id: order.id,
                    items: order.items || [],
                    status: order.status,
                    totalAmount: Number(order.totalAmount || order.grandTotal || 0),
                    orderDate: order.orderDate || order.createdAt || null,
                    paymentStatus: order.paymentStatus,
                    paymentMethod: getOrderPaymentMethod(order),
                    canCancel: ['pending', 'confirmed'].includes(String(order.status || '').toLowerCase())
                }))
                .sort((a, b) => {
                    const getT = (v) => v?._seconds ? v._seconds * 1000 : new Date(v || 0).getTime();
                    return getT(a.orderDate) - getT(b.orderDate);
                });

            tabs[groupId] = {
                id: groupId,
                dineInTabId: String(mainOrder.dineInTabId || groupId),
                tab_name: mainOrder.tab_name || mainOrder.customerName || 'Guest',
                status: groupStatus,
                mainStatus: groupStatus,
                orders: ordersMap,
                orderBatches,
                totalAmount,
                paymentStatus: isPaid ? 'paid' : 'pending',
                paymentDetails: Array.isArray(mainOrder.paymentDetails) ? mainOrder.paymentDetails[0] : mainOrder.paymentDetails,
                isPaid,
                dineInToken: mainOrder.dineInToken || mainOrder.token || mainOrder.trackingToken || tokenKey,
                ordered_by: mainOrder.ordered_by,
                ordered_by_name: mainOrder.ordered_by_name,
                pax_count: 1,
                orderDate: mainOrder.orderDate || mainOrder.createdAt || null,
                hasPending: statuses.includes('pending')
            };
        });

        return {
            id: `Car Spot ${spot}`,
            _realId: `car_spot_${String(spot).replace(/\s+/g, '_')}`,
            type: 'car-order',
            state: 'occupied',
            current_pax: spotOrders.length,
            max_capacity: 0,
            carSpot: spot,
            carDetails: firstOrder.carDetails || null,
            tabs,
            pendingOrders: []
        };
    });
};

const DineInPageContent = () => {
    const [allData, setAllData] = useState({ tables: [], serviceRequests: [], closedTabs: [], carOrders: [] });
    const [loading, setLoading] = useState(true);
    const [buttonLoading, setButtonLoading] = useState(null); // Track which button is loading
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = searchParams.get('employee_of');
    const [isManageTablesModalOpen, setIsManageTablesModalOpen] = useState(false);
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [editingTable, setEditingTable] = useState(null);
    const [displayTable, setDisplayTable] = useState(null);
    const [isQrDisplayModalOpen, setIsQrDisplayModalOpen] = useState(false);
    const [isQrGeneratorModalOpen, setIsQrGeneratorModalOpen] = useState(false);
    const [isCarSpotQrModalOpen, setIsCarSpotQrModalOpen] = useState(false); // ✅ Car Spot QR
    const [restaurantDetails, setRestaurantDetails] = useState(null);
    const [businessType, setBusinessType] = useState('restaurant');
    const [isBusinessTypeResolved, setIsBusinessTypeResolved] = useState(false);
    const [billData, setBillData] = useState(null);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const [confirmationState, setConfirmationState] = useState({ isOpen: false, onConfirm: () => { }, title: '', description: '', confirmText: '', paymentMethod: 'cod' });
    const [activeStatusFilter, setActiveStatusFilter] = useState('Pending'); // Status filter tabs
    const [selectedCards, setSelectedCards] = useState(new Set()); // Batch selection
    const [batchLoading, setBatchLoading] = useState(false); // Batch operation loading

    // Global undo state - tracks last bulk action for reversing
    const [lastBulkAction, setLastBulkAction] = useState(null);
    // Structure: { type: 'confirm_all' | 'reject_all', orderIds: [], prevStatus: 'pending', tableId: 'T1', tabId: 'xxx' }

    // 🔐 RBAC: Role detection for tab and action filtering
    const [userRole, setUserRole] = useState(null);
    const [isOwner, setIsOwner] = useState(false);

    // Detect user role (owner vs employee)
    useEffect(() => {
        const storedRole = localStorage.getItem('employeeRole');

        // If no employee_of param and no stored role, user is owner
        if (!employeeOfOwnerId && !impersonatedOwnerId) {
            setIsOwner(true);
            setUserRole('owner');
        } else {
            // Employee accessing through impersonation
            setUserRole(storedRole || 'waiter'); // Default to waiter if unknown (most restrictive)
        }
    }, [employeeOfOwnerId, impersonatedOwnerId]);

    // Get allowed tabs based on role
    const getAllowedTabs = (role) => {
        const tabConfig = {
            // Chef sees 3 separate tabs for better kitchen workflow
            // Confirmed: New orders from manager to start cooking
            // Preparing: Currently cooking orders
            // Ready: Finished dishes ready for waiter
            'chef': ['Confirmed', 'Preparing', 'Ready'],
            // Waiter sees Ready (orders to serve), Served (served orders), and Needs Cleaning (tables to clean)
            'waiter': ['Ready', 'Served', 'Needs Cleaning'],
            // Cashier sees Delivered (to mark paid) and Needs Cleaning (to track paid orders)
            'cashier': ['Delivered', 'Needs Cleaning'],
            'manager': ['All', 'Pending', 'In Progress', 'Ready', 'Delivered'], // Manager sees all
            'owner': ['All', 'Pending', 'In Progress', 'Ready', 'Delivered'],   // Owner sees all
        };

        return tabConfig[role] || ['All']; // Default to 'All' if role unknown
    };

    // Check if user can perform a status change action
    const canPerformAction = (currentStatus, nextStatus, role) => {
        const actionPermissions = {
            'chef': {
                'confirmed': ['preparing'],          // Chef can mark confirmed → preparing
                'preparing': ['ready_for_pickup']    // Chef can mark preparing → ready
            },
            'waiter': {
                'ready_for_pickup': ['delivered']    // Waiter can mark ready → served
            },
            'cashier': {
                'pending': ['confirmed'],
                'ready_for_pickup': ['delivered']
            },
            'manager': {
                // Manager can do all actions
                'pending': ['confirmed'],
                'confirmed': ['preparing'],
                'preparing': ['ready_for_pickup'],
                'ready_for_pickup': ['delivered']
            },
            'owner': {
                // Owner can do all actions
                'pending': ['confirmed'],
                'confirmed': ['preparing'],
                'preparing': ['ready_for_pickup'],
                'ready_for_pickup': ['delivered']
            }
        };

        const allowedActions = actionPermissions[role]?.[currentStatus] || [];
        return allowedActions.includes(nextStatus);
    };

    // Auto-select first allowed tab if current tab is not accessible by role
    useEffect(() => {
        if (!userRole) return;

        const allowedTabs = getAllowedTabs(userRole);
        // If current filter is not in allowed tabs, switch to first allowed tab
        if (!allowedTabs.includes(activeStatusFilter)) {
            setActiveStatusFilter(allowedTabs[0] || 'All');
        }
    }, [userRole]);

    // Reset selection when filter changes (prevent cross-status batch updates)
    useEffect(() => {
        setSelectedCards(new Set());
    }, [activeStatusFilter]);

    const billPrintRef = useRef();

    const handlePrint = useReactToPrint({
        content: () => billPrintRef.current,
    });

    const handleApiCall = async (method, body, endpoint) => {
        const user = auth.currentUser;
        if (!user) throw new Error("Authentication required.");
        const idToken = await user.getIdToken();

        let url = new URL(endpoint, window.location.origin);
        const finalImpersonatedId = impersonatedOwnerId || searchParams.get('impersonate_owner_id');
        if (finalImpersonatedId) {
            url.searchParams.append('impersonate_owner_id', finalImpersonatedId);
        } else if (employeeOfOwnerId) {
            url.searchParams.append('employee_of', employeeOfOwnerId);
        }

        const fetchOptions = {
            method,
            headers: { 'Authorization': `Bearer ${idToken}` },
        };

        if (method !== 'GET') {
            fetchOptions.headers['Content-Type'] = 'application/json';
            fetchOptions.body = JSON.stringify(body);
        } else if (body) {
            Object.keys(body).forEach(key => url.searchParams.append(key, body[key]));
        }

        const res = await fetch(url.toString(), fetchOptions);

        if (res.status === 204 || (res.ok && res.headers.get('content-length') === '0')) {
            return null;
        }

        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'API call failed');
        return data;
    };

    const fetchData = useCallback(async (isManualRefresh = false) => {
        if (businessType !== 'restaurant') {
            setAllData({ tables: [], serviceRequests: [], closedTabs: [], carOrders: [] });
            setLoading(false);
            return;
        }

        if (!isManualRefresh) setLoading(true);
        try {
            const data = await handleApiCall('GET', null, '/api/owner/dine-in-tables');
            setAllData(data || { tables: [], serviceRequests: [], closedTabs: [], carOrders: [] });
        } catch (error) {
            console.error("[Dine-In Dashboard] Fetch data error:", error);
            setInfoDialog({ isOpen: true, title: "Error", message: `Could not load dine-in data: ${error.message}` });
        } finally {
            if (!isManualRefresh) setLoading(false);
        }
    }, [handleApiCall, businessType]);

    // Adaptive Polling for data
    usePolling(fetchData, {
        interval: 15000,
        enabled: businessType === 'restaurant' && !!(impersonatedOwnerId || employeeOfOwnerId),
        deps: [impersonatedOwnerId, employeeOfOwnerId, businessType]
    });

    // 🔄 SYNC LOGIC: Handle data drift detected by GET Endpoint
    useEffect(() => {
        if (allData?.driftedTableIds?.length > 0) {
            console.warn("⚠️ Data drift detected by server. Triggering sync for tables:", allData.driftedTableIds);

            const syncTables = async () => {
                try {
                    await handleApiCall('PATCH', {
                        action: 'sync_tables',
                        tableIds: allData.driftedTableIds
                    }, '/api/owner/dine-in-tables');

                    // Refresh data after sync
                    fetchData(true);
                } catch (err) {
                    console.error("Failed to sync tables:", err);
                }
            };

            syncTables();
        }
    }, [allData?.driftedTableIds, fetchData]);

    useEffect(() => {
        const fetchAndSetRestaurantDetails = async () => {
            const user = auth.currentUser;
            if (!user) {
                setIsBusinessTypeResolved(true);
                return;
            }

            try {
                const idToken = await user.getIdToken();
                let settingsUrl = '/api/owner/settings';
                if (impersonatedOwnerId) {
                    settingsUrl += `?impersonate_owner_id=${impersonatedOwnerId}`;
                } else if (employeeOfOwnerId) {
                    settingsUrl += `?employee_of=${employeeOfOwnerId}`;
                }
                const settingsRes = await fetch(settingsUrl, { headers: { 'Authorization': `Bearer ${idToken}` } });
                if (settingsRes.ok) {
                    const settingsData = await settingsRes.json();
                    setBusinessType(settingsData.businessType || 'restaurant');
                    setRestaurantDetails({
                        id: settingsData.businessId,
                        name: settingsData.restaurantName,
                        address: settingsData.address,
                        gstin: settingsData.gstin
                    });
                } else {
                    setBusinessType('restaurant');
                    console.error("[Dine-In Dashboard] Failed to fetch restaurant settings.");
                }
            } catch (error) {
                setBusinessType('restaurant');
                console.error("[Dine-In Dashboard] Failed to resolve business type:", error);
            } finally {
                setIsBusinessTypeResolved(true);
            }
        }
        fetchAndSetRestaurantDetails();
    }, [impersonatedOwnerId, employeeOfOwnerId]);

    const handleSaveTable = async (tableName, maxCapacity) => {
        try {
            await handleApiCall('POST', { tableId: tableName, max_capacity: maxCapacity }, '/api/owner/dine-in-tables');
            setInfoDialog({ isOpen: true, title: "Success", message: `Table "${tableName}" saved.` });
            await fetchData(true);
        } catch (error) {
            setInfoDialog({ isOpen: true, title: "Error", message: `Could not save table: ${error.message}` });
            throw error;
        }
    };

    const handleEditTable = async (originalId, newId, newCapacity) => {
        try {
            await handleApiCall('PATCH', { tableId: originalId, newTableId: newId, newCapacity }, '/api/owner/dine-in-tables');
            setInfoDialog({ isOpen: true, title: "Success", message: `Table updated.` });
            await fetchData(true);
        } catch (error) {
            setInfoDialog({ isOpen: true, title: "Error", message: `Could not edit table: ${error.message}` });
            throw error;
        }
    };

    const handleDeleteTable = async (tableId) => {
        setConfirmationState({
            isOpen: true,
            title: "Delete Table",
            description: `Are you sure you want to delete table "${tableId}"? This action cannot be undone.`,
            confirmText: "Delete Table",
            paymentMethod: 'cod', // Not used but required by ConfirmationModal
            onConfirm: async () => {
                try {
                    await handleApiCall('DELETE', { tableId }, '/api/owner/dine-in-tables');
                    setInfoDialog({ isOpen: true, title: "Success", message: `Table "${tableId}" has been deleted.` });
                    await fetchData(true);
                } catch (error) {
                    setInfoDialog({ isOpen: true, title: "Error", message: `Could not delete table: ${error.message}` });
                }
                setConfirmationState({ isOpen: false });
            },
        });
    };


    // Real-time listener for dine-in tables (Signal-based Refresh)
    // We listen for ANY change in tables or orders, and then fetch the full aggregated data from API
    // This saves massive reads by avoiding recreating the complex aggregation logic client-side
    useEffect(() => {
        const user = auth.currentUser;
        if (!user) {
            setLoading(false);
            return;
        }

        // For impersonation/employee: Polling is handled by usePolling hook above
        if (impersonatedOwnerId || employeeOfOwnerId) {
            return;
        }

        if (businessType !== 'restaurant') {
            setLoading(false);
            return;
        }

        // For Owner: Use Signal-based Refresh
        if (!restaurantDetails?.id) {
            fetchData(); // Initial load
            return;
        }

        setLoading(true);
        const restaurantId = restaurantDetails.id;
        console.log('[Dine-In] Setting up Signal-based Refresh for', restaurantId);

        // 1. Listen to Tables
        const tablesQuery = query(
            collection(db, 'restaurants', restaurantId, 'tables')
        );

        // 2. Listen to Active Orders (Metadata only)
        const ordersQuery = query(
            collection(db, 'orders'),
            where('restaurantId', '==', restaurantId),
            where('deliveryType', '==', 'dine-in'),
            where('status', 'not-in', ['picked_up', 'rejected', 'cancelled', 'delivered'])
            // Note: We include 'delivered' in API but exclude here to reduce noise? 
            // Actually API includes delivered until paid/cleaned. 
            // Let's just listen to active stuff to trigger updates.
        );

        let lastUpdate = 0;
        const triggerRefresh = () => {
            const now = Date.now();
            // Debounce updates (max 1 refresh per 2 seconds)
            if (now - lastUpdate > 2000) {
                console.log('[Dine-In] Signal received! Refreshing data...');
                lastUpdate = now;
                fetchData(true);
            }
        };

        const unsubscribeTables = onSnapshot(tablesQuery, triggerRefresh, (err) => console.warn('Tables listener err:', err));
        const unsubscribeOrders = onSnapshot(ordersQuery, triggerRefresh, (err) => console.warn('Orders listener err:', err));

        // Initial fetch handled by listeners firing once on setup? 
        // Snapshot listeners fire immediately with current state.
        // So triggerRefresh will run once for tables and once for orders immediately.
        // But we set loading=true above.
        // fetchData(true) will run, but we need to wait for it for loading=false?
        // fetchData implementation handles specific loading states.

        // Let's do an explicit initial fetch to be sure, then let signals take over.
        fetchData().then(() => setLoading(false));

        return () => {
            console.log('[Dine-In] Cleaning up signal listeners');
            unsubscribeTables();
            unsubscribeOrders();
        };
    }, [auth.currentUser, impersonatedOwnerId, employeeOfOwnerId, restaurantDetails?.id, businessType]);


    const confirmMarkAsPaid = (tableId, tabId) => {
        setConfirmationState({
            isOpen: true,
            title: "Confirm Payment",
            description: `Select the payment method used to settle the bill for this tab on Table ${tableId}.`,
            confirmText: "Mark as Paid",
            paymentMethod: 'cod',
            onConfirm: (method) => {
                handleMarkAsPaid(tableId, tabId, method);
                setConfirmationState({ isOpen: false });
            },
        });
    };

    const handleMarkAsPaid = async (tableId, tabId, paymentMethod) => {
        setButtonLoading(`paid_${tabId}`);

        try {
            // Find all orders in this tab and update their paymentStatus
            let tabData = allData.tables.find(t => t.id === tableId)?.tabs?.[tabId];
            if (!tabData) {
                const virtualCarTables = buildCarVirtualTables(allData.carOrders || []);
                tabData = virtualCarTables.find(t => t.id === tableId)?.tabs?.[tabId];
            }
            if (!tabData?.orders) {
                throw new Error('Tab not found');
            }

            const orderIds = Object.keys(tabData.orders);

            // Update all orders in tab to mark as paid
            await handleApiCall('PATCH', {
                orderIds,
                paymentStatus: 'paid',
                paymentMethod
            }, '/api/owner/orders'); // Fixed: use /orders not /orders/payment-status

            // 🔧 Optimistically update table state to 'needs_cleaning'
            // This ensures the header turns Red and provides visual feedback
            setAllData(prev => {
                if (!prev?.tables) return prev;
                const updatedTables = prev.tables.map(table => {
                    if (table.id === tableId) {
                        return { ...table, state: 'needs_cleaning' };
                    }
                    return table;
                });
                return { ...prev, tables: updatedTables };
            });

            // Refetch to get updated data
            await fetchData(true);
            setButtonLoading(null);
            setInfoDialog({ isOpen: true, title: "Success", message: "Payment marked as received. Table marked for cleaning." });
        } catch (error) {
            setButtonLoading(null);
            setInfoDialog({ isOpen: true, title: "Error", message: `Could not mark as paid: ${error.message}` });
        }
    };

    const handleMarkAsCleaned = async (tableId) => {
        // Optimistic update - set table to available
        setAllData(prev => {
            if (!prev?.tables) return prev;
            const updatedTables = prev.tables.map(table => {
                if (table.id === tableId) {
                    return { ...table, state: 'available' };
                }
                return table;
            });
            return { ...prev, tables: updatedTables };
        });

        try {
            await handleApiCall('PATCH', { tableId, action: 'mark_cleaned' }, '/api/owner/dine-in-tables');
            setInfoDialog({ isOpen: true, title: "Success", message: `Table ${tableId} is now available.` });
        } catch (error) {
            await fetchData(true);
            setInfoDialog({ isOpen: true, title: "Error", message: `Could not update table status: ${error.message}` });
        }
    };

    const handleClearTab = async (tabId, tableId, paxCount) => {
        const normalizedTableId = String(tableId || '').trim();
        const normalizedTabId = String(tabId || '').trim();
        const isCarSlot = normalizedTableId.toLowerCase().startsWith('car spot');
        const carSlotName = isCarSlot
            ? normalizedTableId.replace(/^car\s+spot\s*/i, '').trim()
            : '';

        // Optimistic update - remove tab/order from view
        setAllData(prev => {
            if (!prev?.tables) return prev;
            const updatedTables = prev.tables.map(table => {
                if (table.id === tableId) {
                    // Remove from tabs if exists
                    const { [tabId]: removedTab, ...remainingTabs } = table.tabs || {};
                    // Remove from pendingOrders if exists
                    const updatedPending = (table.pendingOrders || []).filter(order => order.id !== tabId);
                    // Update current_pax
                    const newPax = Math.max(0, (table.current_pax || 0) - (paxCount || 0));
                    return {
                        ...table,
                        tabs: remainingTabs,
                        pendingOrders: updatedPending,
                        current_pax: newPax,
                        state: Object.keys(remainingTabs).length === 0 && updatedPending.length === 0 ? 'available' : table.state
                    };
                }
                return table;
            });

            const updatedCarOrders = isCarSlot
                ? (prev.carOrders || []).filter((order) => {
                    const orderSpot = String(order?.carSpot || '').trim();
                    const orderTableId = `Car Spot ${orderSpot || `Unassigned-${order?.id}`}`;
                    const orderGroupId = buildCarTabGroupId(orderSpot || `Unassigned-${order?.id}`, resolveCarOrderTokenKey(order));
                    const orderSessionTabId = String(order?.dineInTabId || order?.tabId || '').trim();
                    const matchesTable = orderTableId === normalizedTableId;
                    const matchesTab = orderGroupId === normalizedTabId || orderSessionTabId === normalizedTabId;
                    return !(matchesTable && matchesTab);
                })
                : (prev.carOrders || []);

            return { ...prev, tables: updatedTables, carOrders: updatedCarOrders };
        });

        try {
            // ✅ Using new dine-in cleanup endpoint
            const cleanupEndpoint = '/api/dine-in/clean-table';

            // ✅ CRITICAL: Also find the real dineInTabId from tab/group data so the API
            // can directly locate the Firestore tab doc even if tabId is a groupKey.
            const table = allData?.tables?.find(t => t.id === tableId);
            const tabData = table?.tabs?.[tabId] || (table?.pendingOrders || []).find(o => o.id === tabId);
            const realDineInTabId = tabData?.dineInTabId;

            const payload = {
                tabId,
                tableId: isCarSlot ? null : tableId,
                restaurantId: restaurantDetails?.id,
                dineInTabId: realDineInTabId || null // ✅ Send the real Firestore tab doc ID
            };

            console.log(`[Owner Dashboard] Cleaning tab with endpoint: ${cleanupEndpoint}, realTabId: ${realDineInTabId}`);

            await handleApiCall('PATCH', payload, cleanupEndpoint);
            setInfoDialog({
                isOpen: true,
                title: "Success",
                message: isCarSlot
                    ? `Car order session on Slot ${carSlotName || 'N/A'} has been cleared.`
                    : `Tab on Table ${tableId} has been cleared.`
            });
        } catch (error) {
            await fetchData(true);
            setInfoDialog({ isOpen: true, title: "Error", message: `Could not clear tab: ${error.message}` });
        }
    }

    const handleUpdateStatus = async (orderId, newStatus) => {
        // Set loading state
        setButtonLoading(`status_${orderId}`);

        // OPTIMISTIC UPDATE - Update UI immediately for instant feedback
        setAllData(prevData => {
            const updatedTables = prevData.tables.map(table => {
                // Update in pendingOrders
                const updatedPendingOrders = table.pendingOrders?.map(group => ({
                    ...group,
                    orderBatches: group.orderBatches?.map(batch =>
                        batch.id === orderId ? { ...batch, status: newStatus } : batch
                    )
                }));

                // Update in tabs
                const updatedTabs = {};
                Object.entries(table.tabs || {}).forEach(([key, group]) => {
                    updatedTabs[key] = {
                        ...group,
                        orderBatches: group.orderBatches?.map(batch =>
                            batch.id === orderId ? { ...batch, status: newStatus } : batch
                        )
                    };
                });

                return {
                    ...table,
                    pendingOrders: updatedPendingOrders,
                    tabs: updatedTabs
                };
            });

            return { ...prevData, tables: updatedTables };
        });

        // API call in background
        try {
            await handleApiCall('PATCH', { orderIds: [orderId], newStatus }, '/api/owner/orders');
            // Light refresh to sync any server-side calculations (no full loading state)
            await fetchData(true);
            setButtonLoading(null);
        } catch (error) {
            // Revert optimistic update on error
            await fetchData(true);
            setButtonLoading(null);
            setInfoDialog({ isOpen: true, title: "Error", message: `Could not update status: ${error.message}` });
        }
    }

    const handleRejectOrder = async (orderId) => {
        // Set loading state
        setButtonLoading(`reject_${orderId}`);

        // API call
        try {
            await handleApiCall('PATCH', { orderIds: [orderId], newStatus: 'rejected', rejectionReason: 'Rejected by restaurant' }, '/api/owner/orders');
            await fetchData(true); // Refetch to remove rejected order
            setButtonLoading(null);
            setInfoDialog({ isOpen: true, title: "Success", message: "Order rejected." });
        } catch (error) {
            setButtonLoading(null);
            setInfoDialog({ isOpen: true, title: "Error", message: `Could not reject order: ${error.message}` });
        }
    }

    const activeTableData = useMemo(() => {
        if (!allData || !allData.tables) return [];
        return allData.tables;
    }, [allData]);

    const handleOpenEditModal = (table = null) => {
        if (!restaurantDetails?.id) {
            setInfoDialog({ isOpen: true, title: "Error", message: "Restaurant data is not loaded yet. Cannot manage tables." });
            return;
        }
        setEditingTable(table);
        setIsQrGeneratorModalOpen(true);
    };

    const handleOpenQrDisplayModal = (table) => {
        if (!restaurantDetails?.id) {
            setInfoDialog({ isOpen: true, title: "Error", message: "Restaurant data is not loaded yet. Cannot show QR code." });
            return;
        }
        setDisplayTable(table);
        setIsManageTablesModalOpen(false); // Close manage modal if open
        setIsQrDisplayModalOpen(true);
    };

    const renderTableCards = () => {
        const carTables = buildCarVirtualTables(allData.carOrders || []);

        // Combine Real Tables + Car Tables
        const combinedData = [...activeTableData, ...carTables];

        if (loading || combinedData.length === 0) return [];

        const sortedTables = combinedData.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

        // Map status filter to mainStatus values
        const statusMapping = {
            'All': null, // Show all
            'Pending': 'pending',
            'Confirmed': 'confirmed',              // Chef's first tab: Orders ready to cook
            'Preparing': 'preparing',              // Chef's second tab: Currently cooking
            'In Progress': ['confirmed', 'preparing'], // Manager/Owner combined view
            'Ready': 'ready_for_pickup',
            'Served': 'delivered',                 // Waiter's view of delivered orders
            'Delivered': 'delivered',              // Manager/Owner/Cashier view
            'Needs Cleaning': 'needs_cleaning'     // Waiter's cleaning queue
        };

        const matchesFilter = (mainStatus, table) => {
            if (activeStatusFilter === 'All') return true;

            // Special handling for "Needs Cleaning" tab
            if (activeStatusFilter === 'Needs Cleaning') {
                // Show tables that are paid (all orders delivered) but need cleaning
                return table?.state === 'needs_cleaning';
            }

            // Special handling for "Delivered" tab - SHOW all delivered/served orders, even if paid
            // This prevents them from disappearing immediately
            if (activeStatusFilter === 'Delivered') {
                return mainStatus === 'delivered';
            }

            const filterValue = statusMapping[activeStatusFilter];
            if (Array.isArray(filterValue)) {
                return filterValue.includes(mainStatus);
            }
            return mainStatus === filterValue;
        };

        // Filter tables to only show those with orders matching the filter
        const filteredTables = sortedTables.map(table => {
            // Special handling for "Needs Cleaning" tab - show tables with paid tabs needing cleaning
            if (activeStatusFilter === 'Needs Cleaning') {
                // Check if table has any paid tabs (isPaid === true for group)
                const paidTabs = {};
                Object.entries(table.tabs || {}).forEach(([key, group]) => {
                    if (group.isPaid === true || group.paymentStatus === 'paid') {
                        paidTabs[key] = group;
                    }
                });

                if (Object.keys(paidTabs).length > 0) {
                    return {
                        ...table,
                        pendingOrders: [],
                        tabs: paidTabs
                    };
                }
                return null;
            }

            // For "Delivered" tab (Cashier) OR "Served" tab (Waiter)
            if (activeStatusFilter === 'Delivered' || activeStatusFilter === 'Served') {
                const deliveredPendingOrders = (table.pendingOrders || []).filter(group =>
                    group.mainStatus === 'delivered'
                );

                const deliveredTabs = {};
                Object.entries(table.tabs || {}).forEach(([key, group]) => {
                    if (group.mainStatus === 'delivered' || group.status === 'delivered') {
                        deliveredTabs[key] = group;
                    }
                });

                if (deliveredPendingOrders.length > 0 || Object.keys(deliveredTabs).length > 0) {
                    return {
                        ...table,
                        pendingOrders: deliveredPendingOrders,
                        tabs: deliveredTabs
                    };
                }
                return null;
            }

            // Filter pending orders and tabs based on status (for other tabs)
            const filteredPendingOrders = (table.pendingOrders || []).filter(group =>
                matchesFilter(group.mainStatus || 'pending', table)
            );

            const filteredTabs = {};
            Object.entries(table.tabs || {}).forEach(([key, group]) => {
                if (matchesFilter(group.mainStatus || group.status, table)) {
                    filteredTabs[key] = group;
                }
            });

            // Only include table if it has matching orders/tabs
            if (filteredPendingOrders.length > 0 || Object.keys(filteredTabs).length > 0) {
                return {
                    ...table,
                    pendingOrders: filteredPendingOrders,
                    tabs: filteredTabs
                };
            }
            return null;
        }).filter(Boolean);

        return filteredTables.map(table => {
            return (
                <TableCard
                    key={table.id}
                    tableData={table}
                    onMarkAsPaid={confirmMarkAsPaid}
                    onPrintBill={setBillData}
                    onMarkAsCleaned={handleMarkAsCleaned}
                    onConfirmOrder={(orderId) => handleUpdateStatus(orderId, 'confirmed')}
                    onRejectOrder={handleRejectOrder}
                    onClearTab={handleClearTab}
                    onUpdateStatus={handleUpdateStatus}
                    onMarkForCleaning={() => { }} // TODO: implement
                    buttonLoading={buttonLoading}
                    lastBulkAction={lastBulkAction}
                    setLastBulkAction={setLastBulkAction}
                    setConfirmationState={setConfirmationState}
                    userRole={userRole}
                    canPerformAction={canPerformAction}
                />
            );
        }).flat();
    };

    const tableCards = renderTableCards();

    if (isBusinessTypeResolved && businessType !== 'restaurant') {
        return (
            <div className="p-4 md:p-6 text-foreground min-h-screen bg-background">
                <div className="border border-border rounded-xl p-6 bg-card">
                    <h1 className="text-2xl font-bold tracking-tight">Dine-In Not Available</h1>
                    <p className="text-muted-foreground mt-2">
                        This feature is only available for restaurant outlets. Current outlet type: <strong>{businessType}</strong>.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-4 md:p-6 text-foreground min-h-screen bg-background">
            <DineInHistoryModal isOpen={isHistoryModalOpen} onClose={() => setIsHistoryModalOpen(false)} closedTabs={allData.closedTabs || []} />
            <ManageTablesModal isOpen={isManageTablesModalOpen} onClose={() => setIsManageTablesModalOpen(false)} allTables={allData.tables} onEdit={handleOpenEditModal} onDelete={handleDeleteTable} loading={loading} onCreateNew={() => handleOpenEditModal(null)} onShowQr={handleOpenQrDisplayModal} />
            {billData && (
                <BillModal
                    order={billData}
                    restaurant={restaurantDetails}
                    onClose={() => setBillData(null)}
                    onPrint={handlePrint}
                    printRef={billPrintRef}
                />
            )}
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />
            {restaurantDetails?.id && <QrGeneratorModal isOpen={isQrGeneratorModalOpen} onClose={() => setIsQrGeneratorModalOpen(false)} restaurantId={restaurantDetails.id} onSaveTable={handleSaveTable} onEditTable={handleEditTable} onDeleteTable={handleDeleteTable} initialTable={editingTable} showInfoDialog={setInfoDialog} />}
            <QrCodeDisplayModal isOpen={isQrDisplayModalOpen} onClose={() => setIsQrDisplayModalOpen(false)} restaurant={restaurantDetails} table={displayTable} />
            <CarSpotQrModal
                isOpen={isCarSpotQrModalOpen}
                onClose={() => setIsCarSpotQrModalOpen(false)}
                restaurant={restaurantDetails}
                handleApiCall={handleApiCall}
                showInfoDialog={setInfoDialog}
            />
            <ConfirmationModal
                isOpen={confirmationState.isOpen}
                onClose={() => setConfirmationState({ ...confirmationState, isOpen: false })}
                onConfirm={() => confirmationState.onConfirm(confirmationState.paymentMethod)}
                title={confirmationState.title}
                description={confirmationState.description}
                confirmText={confirmationState.confirmText}
                paymentMethod={confirmationState.paymentMethod}
                setPaymentMethod={(method) => setConfirmationState(prev => ({ ...prev, paymentMethod: method }))}
            />


            <div className="flex flex-col md:flex-row justify-between md:items-center mb-6 gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Dine-In Command Center</h1>
                    <p className="text-muted-foreground mt-1 text-sm md:text-base">A live overview of your active tables and table management.</p>
                </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                {/* 🔐 RBAC: Create Order button - Only for Owner, Manager, Waiter */}
                {(userRole === 'owner' || userRole === 'manager' || userRole === 'waiter') && (
                    <Link href={`/owner-dashboard/dine-in-waiter${impersonatedOwnerId ? `?impersonate_owner_id=${impersonatedOwnerId}` : employeeOfOwnerId ? `?employee_of=${employeeOfOwnerId}` : ''}`}>
                        <Button variant="default" className="h-20 flex-col gap-1 w-full bg-primary hover:bg-primary/90">
                            <Plus size={20} /> Create Order
                        </Button>
                    </Link>
                )}


                {/* 🔐 RBAC: Dine-In History - Only for Owner, Manager, Cashier */}
                {(userRole === 'owner' || userRole === 'manager' || userRole === 'cashier') && (
                    <Link href={`/owner-dashboard/dine-in-history${impersonatedOwnerId ? `?impersonate_owner_id=${impersonatedOwnerId}` : employeeOfOwnerId ? `?employee_of=${employeeOfOwnerId}` : ''}`}>
                        <Button variant="outline" className="h-20 flex-col gap-1 w-full" disabled={loading}>
                            <History size={20} /> Dine-In History
                        </Button>
                    </Link>
                )}
                <Button variant="outline" className="h-20 flex-col gap-1" disabled={true}>
                    <Salad size={20} /> Dine-In Menu
                </Button>

                {/* 🔐 RBAC: Manage Tables - Only for Owner, Manager */}
                {(userRole === 'owner' || userRole === 'manager') && (
                    <Button onClick={() => setIsManageTablesModalOpen(true)} variant="outline" className="h-20 flex-col gap-1" disabled={loading || !restaurantDetails}>
                        <TableIcon size={20} /> Manage Tables
                    </Button>
                )}
                <Button onClick={() => fetchData(true)} variant="outline" className="h-20 flex-col gap-1" disabled={loading}>
                    <RefreshCw size={20} className={cn(loading && "animate-spin")} /> Refresh View
                </Button>

                {/* ✅ New: Car Spot QR Button */}
                {(userRole === 'owner' || userRole === 'manager') && (
                    <Button onClick={() => setIsCarSpotQrModalOpen(true)} variant="outline" className="h-20 flex-col gap-1 border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700">
                        <QrCode size={20} /> Car Spot QR
                    </Button>
                )}
            </div>




            <LiveServiceRequests impersonatedOwnerId={impersonatedOwnerId} employeeOfOwnerId={employeeOfOwnerId} />

            <div className="flex flex-col md:flex-row justify-between md:items-center mb-4 gap-4">
                <h2 className="text-xl font-bold">Live Tables</h2>

                {/* Status Filter Tabs - RBAC Filtered */}
                <div className="flex items-center gap-2 bg-card p-1 rounded-lg border border-border overflow-x-auto max-w-full whitespace-nowrap no-scrollbar">
                    {['All', 'Pending', 'Confirmed', 'Preparing', 'In Progress', 'Ready', 'Served', 'Delivered', 'Needs Cleaning']
                        .filter(filter => getAllowedTabs(userRole).includes(filter))
                        .map(filter => (
                            <button
                                key={filter}
                                onClick={() => setActiveStatusFilter(filter)}
                                className={cn(
                                    'px-3 py-1.5 text-sm font-semibold rounded-md transition-colors flex-shrink-0',
                                    activeStatusFilter === filter
                                        ? 'bg-primary text-primary-foreground'
                                        : 'text-muted-foreground hover:bg-muted'
                                )}
                            >
                                {filter}
                            </button>
                        ))}
                </div>
            </div>

            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="h-96 bg-muted rounded-xl" />
                    ))}
                </div>
            ) : tableCards.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {tableCards}
                </div>
            ) : (
                <div className="text-center py-16 text-muted-foreground border-2 border-dashed border-border rounded-xl">
                    <ShoppingBag size={48} className="mx-auto" />
                    <p className="mt-4 text-lg font-semibold">No Active Tables</p>
                    <p>When a customer scans a QR code and orders, their table will appear here live.</p>
                </div>
            )}
        </div>
    );
};

const DineInPage = () => (
    <Suspense fallback={<div className="flex h-full w-full items-center justify-center">Loading...</div>}>
        <DineInPageContent />
    </Suspense>
);

export default DineInPage;

