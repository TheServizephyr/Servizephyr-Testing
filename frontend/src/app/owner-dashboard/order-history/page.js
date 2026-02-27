"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Calendar, RefreshCw, ChevronLeft, Download, Printer, Search, Filter, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auth, db } from '@/lib/firebase';
import { collection, query, where, orderBy, getDocs, limit, Timestamp } from 'firebase/firestore';
import { cn } from "@/lib/utils";
import { format, startOfDay, endOfDay, subDays } from 'date-fns';
import { useSearchParams, useRouter } from 'next/navigation';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { OrderStatusBadge } from '@/components/OrderStatusBadge';
import Link from 'next/link';

// Date presets for quick selection
const DATE_PRESETS = [
    { label: "Today", getValue: () => ({ from: startOfDay(new Date()), to: endOfDay(new Date()) }) },
    { label: "Yesterday", getValue: () => ({ from: startOfDay(subDays(new Date(), 1)), to: endOfDay(subDays(new Date(), 1)) }) },
    { label: "Last 7 Days", getValue: () => ({ from: startOfDay(subDays(new Date(), 7)), to: endOfDay(new Date()) }) }
];

export default function OrderHistoryPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = searchParams.get('employee_of');

    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedOrder, setSelectedOrder] = useState(null); // ✅ For detail modal
    const [dateRange, setDateRange] = useState({
        from: startOfDay(new Date()),
        to: endOfDay(new Date())
    });
    const [statusFilter, setStatusFilter] = useState('All');
    const [searchQuery, setSearchQuery] = useState('');

    // Fetch completed orders
    const fetchOrders = async () => {
        setLoading(true);
        try {
            const user = auth.currentUser;
            if (!user) {
                setLoading(false);
                return;
            }

            // Get owner's restaurant ID
            const ownerId = user.uid;
            const restaurantsQuery = query(
                collection(db, 'restaurants'),
                where('ownerId', '==', ownerId),
                limit(1)
            );

            const restaurantSnapshot = await getDocs(restaurantsQuery);

            if (restaurantSnapshot.empty) {
                console.error('[OrderHistory] No restaurant found for owner:', ownerId);
                setLoading(false);
                return;
            }

            const restaurantId = restaurantSnapshot.docs[0].id;
            console.log('[OrderHistory] Found restaurantId:', restaurantId);

            // Query completed orders within date range
            // OPTIMIZATION: Query by Date only, then filter status in memory.
            // This avoids complicated composite index requirements (Status + Date + Sort).
            const ordersQuery = query(
                collection(db, 'orders'),
                where('restaurantId', '==', restaurantId),
                where('orderDate', '>=', Timestamp.fromDate(dateRange.from)),
                where('orderDate', '<=', Timestamp.fromDate(dateRange.to)),
                orderBy('orderDate', 'desc'), // Sorting by date is safe with date range filter
                limit(100)
            );

            const ordersSnapshot = await getDocs(ordersQuery);
            const fetchedOrders = [];
            const historyStatuses = ['delivered', 'picked_up', 'rejected', 'cancelled', 'failed_delivery'];

            ordersSnapshot.forEach((doc) => {
                const data = doc.data();
                if (historyStatuses.includes(data.status)) {
                    fetchedOrders.push({ id: doc.id, ...data });
                }
            });

            console.log(`[OrderHistory] Fetched ${fetchedOrders.length} completed orders`);
            setOrders(fetchedOrders);

        } catch (error) {
            console.error('[OrderHistory] Error fetching orders:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchOrders();
    }, [dateRange]);

    // Filter orders by status and search
    const filteredOrders = useMemo(() => {
        let filtered = [...orders];

        // Status filter
        if (statusFilter !== 'All') {
            const statusMap = {
                'Delivered': (o) => o.status === 'delivered' || o.status === 'picked_up',
                'Rejected': (o) => o.status === 'rejected'
            };
            filtered = filtered.filter(statusMap[statusFilter]);
        }

        // Search filter
        if (searchQuery) {
            const lowercased = searchQuery.toLowerCase();
            filtered = filtered.filter(order =>
                (order.customerOrderId || '').toString().toLowerCase().includes(lowercased) ||
                order.id.toLowerCase().includes(lowercased) ||
                (order.customer || order.customerName || '').toLowerCase().includes(lowercased) ||
                (order.customerPhone || '').includes(searchQuery)
            );
        }

        return filtered;
    }, [orders, statusFilter, searchQuery]);

    return (
        <div className="p-4 md:p-6 text-foreground min-h-screen bg-background">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between md:items-center mb-6 gap-4">
                <div className="flex items-center gap-3">
                    <Button
                        onClick={() => router.push('/owner-dashboard/live-orders')}
                        variant="ghost"
                        size="icon"
                    >
                        <ChevronLeft className="h-5 w-5" />
                    </Button>
                    <div>
                        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Order History</h1>
                        <p className="text-muted-foreground mt-1 text-sm md:text-base">
                            View and analyze completed orders
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <Button onClick={fetchOrders} variant="outline" disabled={loading}>
                        <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                        <span className="ml-2 hidden sm:inline">Refresh</span>
                    </Button>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-card border border-border rounded-xl p-4 mb-6">
                {/* Date Range Presets */}
                <div className="flex flex-wrap items-center gap-2 mb-4">
                    <span className="text-sm font-semibold text-muted-foreground mr-2">Quick Select:</span>
                    {DATE_PRESETS.map((preset) => (
                        <Button
                            key={preset.label}
                            variant="outline"
                            size="sm"
                            onClick={() => setDateRange(preset.getValue())}
                            className="text-xs"
                        >
                            {preset.label}
                        </Button>
                    ))}
                </div>

                {/* Date Range Picker */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* From Date */}
                    <div>
                        <label className="text-sm font-medium mb-2 block">From Date</label>
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="outline" className="w-full justify-start">
                                    <Calendar className="mr-2 h-4 w-4" />
                                    {format(dateRange.from, 'PPP')}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                                <CalendarComponent
                                    mode="single"
                                    selected={dateRange.from}
                                    onSelect={(date) => date && setDateRange({ ...dateRange, from: startOfDay(date) })}
                                    initialFocus
                                />
                            </PopoverContent>
                        </Popover>
                    </div>

                    {/* To Date */}
                    <div>
                        <label className="text-sm font-medium mb-2 block">To Date</label>
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="outline" className="w-full justify-start">
                                    <Calendar className="mr-2 h-4 w-4" />
                                    {format(dateRange.to, 'PPP')}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                                <CalendarComponent
                                    mode="single"
                                    selected={dateRange.to}
                                    onSelect={(date) => date && setDateRange({ ...dateRange, to: endOfDay(date) })}
                                    initialFocus
                                />
                            </PopoverContent>
                        </Popover>
                    </div>

                    {/* Search */}
                    <div>
                        <label className="text-sm font-medium mb-2 block">Search</label>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <input
                                type="text"
                                placeholder="Order ID, customer..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 h-10 rounded-md bg-input border border-border"
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Status Tabs */}
            <Tabs value={statusFilter} onValueChange={setStatusFilter} className="w-full mb-6">
                <TabsList className="grid w-full grid-cols-3 h-auto p-1 bg-muted">
                    <TabsTrigger value="All">All ({orders.length})</TabsTrigger>
                    <TabsTrigger value="Delivered">Delivered</TabsTrigger>
                    <TabsTrigger value="Rejected">Rejected</TabsTrigger>
                </TabsList>
            </Tabs>

            {/* Orders Table */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="bg-muted/30">
                                <th className="p-4 text-left text-sm font-semibold text-muted-foreground">Order ID</th>
                                <th className="p-4 text-left text-sm font-semibold text-muted-foreground">Customer</th>
                                <th className="p-4 text-left text-sm font-semibold text-muted-foreground">Amount</th>
                                <th className="p-4 text-left text-sm font-semibold text-muted-foreground">Date & Time</th>
                                <th className="p-4 text-left text-sm font-semibold text-muted-foreground">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {loading ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-24"></div></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-32"></div></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-16"></div></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-28"></div></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-20"></div></td>
                                    </tr>
                                ))
                            ) : filteredOrders.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="p-8 text-center text-muted-foreground">
                                        No orders found for the selected date range.
                                    </td>
                                </tr>
                            ) : (
                                filteredOrders.map((order) => (
                                    <tr
                                        key={order.id}
                                        className="hover:bg-muted/50 cursor-pointer"
                                        onClick={() => setSelectedOrder(order)}
                                    >
                                        <td className="p-4 font-mono text-sm">{order.id.substring(0, 8)}</td>
                                        <td className="p-4 text-sm">{order.customer || order.customerName || 'Guest'}</td>
                                        <td className="p-4 text-sm font-semibold">₹{order.totalAmount?.toFixed(0) || 0}</td>
                                        <td className="p-4 text-sm text-muted-foreground">
                                            {order.orderDate?.seconds
                                                ? format(new Date(order.orderDate.seconds * 1000), 'PPp')
                                                : 'N/A'}
                                        </td>
                                        <td className="p-4">
                                            <OrderStatusBadge status={order.status} />
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Order Detail Modal */}
            <Dialog open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center justify-between">
                            <span>Order Details</span>
                            <span className="font-mono text-sm text-muted-foreground">
                                {selectedOrder?.id.substring(0, 10)}
                            </span>
                        </DialogTitle>
                    </DialogHeader>

                    {selectedOrder && (
                        <div className="space-y-6">
                            {/* Customer Info */}
                            <div className="bg-muted/30 rounded-lg p-4">
                                <h3 className="font-semibold mb-2">Customer Information</h3>
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div>
                                        <p className="text-muted-foreground">Name</p>
                                        <p className="font-medium">{selectedOrder.customer || selectedOrder.customerName || 'Guest'}</p>
                                    </div>
                                    <div>
                                        <p className="text-muted-foreground">Phone</p>
                                        <p className="font-medium">{selectedOrder.customerPhone || 'N/A'}</p>
                                    </div>
                                    {selectedOrder.address && (
                                        <div className="col-span-2">
                                            <p className="text-muted-foreground">Address</p>
                                            <p className="font-medium">{
                                                typeof selectedOrder.address === 'string'
                                                    ? selectedOrder.address
                                                    : (selectedOrder.address?.street || selectedOrder.address?.formattedAddress || 'N/A')
                                            }</p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Order Items */}
                            <div>
                                <h3 className="font-semibold mb-3">Order Items</h3>
                                <div className="space-y-2">
                                    {selectedOrder.items && selectedOrder.items.length > 0 ? (
                                        selectedOrder.items.map((item, idx) => (
                                            <div key={idx} className="flex justify-between items-start p-3 bg-muted/20 rounded-lg">
                                                <div className="flex-1">
                                                    <p className="font-medium">{item.name || item.itemName}</p>
                                                    {item.portion && (
                                                        <p className="text-sm text-muted-foreground">Portion: {item.portion.name}</p>
                                                    )}
                                                    {item.customizations && item.customizations.length > 0 && (
                                                        <p className="text-xs text-muted-foreground mt-1">
                                                            {item.customizations.map(c => c.name).join(', ')}
                                                        </p>
                                                    )}
                                                    <p className="text-sm font-medium mt-1">Qty: {item.quantity}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="font-semibold">₹{(item.totalPrice || item.serverVerifiedTotal || 0).toFixed(0)}</p>
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <p className="text-sm text-muted-foreground">No items found</p>
                                    )}
                                </div>
                            </div>

                            {/* Bill Summary */}
                            <div className="border-t pt-4">
                                <h3 className="font-semibold mb-3">Bill Summary</h3>
                                <div className="space-y-2 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Subtotal</span>
                                        <span>₹{(selectedOrder.subtotal || 0).toFixed(0)}</span>
                                    </div>
                                    {selectedOrder.cgst > 0 && (
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">CGST</span>
                                            <span>₹{selectedOrder.cgst.toFixed(0)}</span>
                                        </div>
                                    )}
                                    {selectedOrder.sgst > 0 && (
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">SGST</span>
                                            <span>₹{selectedOrder.sgst.toFixed(0)}</span>
                                        </div>
                                    )}
                                    {selectedOrder.deliveryCharge > 0 && (
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Delivery Charge</span>
                                            <span>₹{selectedOrder.deliveryCharge.toFixed(0)}</span>
                                        </div>
                                    )}
                                    <div className="flex justify-between font-bold text-base pt-2 border-t">
                                        <span>Total Amount</span>
                                        <span>₹{(selectedOrder.totalAmount || 0).toFixed(0)}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Status & Date */}
                            <div className="bg-muted/30 rounded-lg p-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-sm text-muted-foreground">Status</p>
                                        <div className="mt-1">
                                            <OrderStatusBadge status={selectedOrder.status} />
                                        </div>
                                    </div>
                                    <div>
                                        <p className="text-sm text-muted-foreground">Order Date</p>
                                        <p className="font-medium mt-1">
                                            {selectedOrder.orderDate?.seconds
                                                ? format(new Date(selectedOrder.orderDate.seconds * 1000), 'PPp')
                                                : 'N/A'}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
