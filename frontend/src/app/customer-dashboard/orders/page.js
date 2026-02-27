'use client';

import { motion } from 'framer-motion';
import { ArrowLeft, ShoppingBag, Loader2, ReceiptText, CalendarClock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useState, useEffect } from 'react';
import { useUser } from '@/firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';

const parseOrderDate = (value) => {
    if (!value) return null;
    if (typeof value?.toDate === 'function') return value.toDate();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

const getItemQuantity = (item = {}) => {
    const raw = item.quantity ?? item.qty ?? 1;
    const numeric = Number(raw);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
};

const getOrderTotal = (order = {}) => {
    const rawTotal = order.totalAmount ?? order.grandTotal ?? order.total ?? 0;
    const total = Number(rawTotal);
    return Number.isFinite(total) ? total : 0;
};

const getCustomerFacingOrderId = (order = {}) => {
    const rawOrderId = order.customerOrderId ?? order.customer_order_id ?? order.orderNumber ?? order.id;
    return String(rawOrderId || '').trim();
};

const statusStyles = {
    Delivered: 'border-emerald-500/35 bg-emerald-500/15 text-emerald-300',
    Cancelled: 'border-red-500/35 bg-red-500/15 text-red-300',
    Rejected: 'border-red-500/35 bg-red-500/15 text-red-300',
    'In Progress': 'border-blue-500/35 bg-blue-500/15 text-blue-300',
    Pending: 'border-yellow-500/35 bg-yellow-500/15 text-yellow-300',
    Confirmed: 'border-cyan-500/35 bg-cyan-500/15 text-cyan-300',
    Preparing: 'border-orange-500/35 bg-orange-500/15 text-orange-300',
    Dispatched: 'border-indigo-500/35 bg-indigo-500/15 text-indigo-300',
    'Picked Up': 'border-green-500/35 bg-green-500/15 text-green-300',
};

const OrderCard = ({ order, index }) => {
    const statusText = (order.status || 'pending').replace('_', ' ');
    const capitalizedStatus = statusText.charAt(0).toUpperCase() + statusText.slice(1);
    const orderDate = parseOrderDate(order.orderDate);
    const orderItems = Array.isArray(order.items) ? order.items : [];

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.04 }}
            className="rounded-2xl border border-border/70 bg-card/70 p-5 shadow-[0_20px_40px_-30px_rgba(2,6,23,0.95)]"
        >
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Order ID</p>
                    <p className="mt-1 font-mono text-sm text-primary">#{getCustomerFacingOrderId(order)}</p>
                    <h3 className="mt-2 text-xl font-bold text-foreground">{order.restaurantName || 'Unnamed Restaurant'}</h3>
                </div>
                <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusStyles[capitalizedStatus] || 'border-border bg-muted/60 text-muted-foreground'}`}>
                    {capitalizedStatus}
                </span>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto]">
                <div className="rounded-xl border border-border/60 bg-background/45 p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Items</p>
                    <div className="space-y-1.5">
                        {orderItems.length > 0 ? orderItems.slice(0, 4).map((item, itemIndex) => (
                            <p key={`${item.name || 'item'}-${itemIndex}`} className="text-sm text-foreground">
                                <span className="font-semibold text-primary">{getItemQuantity(item)}x</span>{' '}
                                <span>{item.name || 'Item'}</span>
                            </p>
                        )) : (
                            <p className="text-sm text-muted-foreground">No item details available.</p>
                        )}
                        {orderItems.length > 4 ? (
                            <p className="text-xs text-muted-foreground">+{orderItems.length - 4} more items</p>
                        ) : null}
                    </div>
                </div>

                <div className="flex flex-col justify-between gap-2 lg:min-w-40">
                    <div className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-background/45 px-3 py-2 text-xs text-muted-foreground">
                        <CalendarClock className="h-3.5 w-3.5" />
                        {orderDate ? orderDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A'}
                    </div>
                    <div className="inline-flex items-center justify-between rounded-lg border border-primary/30 bg-primary/10 px-3 py-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-primary">Total</span>
                        <span className="text-lg font-bold text-primary">₹{getOrderTotal(order).toFixed(2)}</span>
                    </div>
                </div>
            </div>
        </motion.div>
    );
};

export default function MyOrdersPage() {
    const router = useRouter();
    const { user, isUserLoading } = useUser();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (isUserLoading) {
            return;
        }
        if (!user) {
            setError('Please log in to view your orders.');
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);

        const byUserIdQuery = query(
            collection(db, 'orders'),
            where('userId', '==', user.uid)
        );
        const byLegacyCustomerIdQuery = query(
            collection(db, 'orders'),
            where('customerId', '==', user.uid)
        );

        let userIdOrders = [];
        let legacyOrders = [];
        let userIdDone = false;
        let legacyDone = false;
        let userIdFailed = false;
        let legacyFailed = false;

        const syncMergedOrders = () => {
            const mergedById = new Map();
            [...userIdOrders, ...legacyOrders].forEach((order) => {
                mergedById.set(order.id, order);
            });

            const mergedOrders = Array.from(mergedById.values());
            mergedOrders.sort((a, b) => {
                const dateA = parseOrderDate(a.orderDate);
                const dateB = parseOrderDate(b.orderDate);
                return (dateB?.getTime() || 0) - (dateA?.getTime() || 0);
            });

            setOrders(mergedOrders);

            if (userIdDone && legacyDone) {
                setLoading(false);
                if (userIdFailed && legacyFailed) {
                    setError('Failed to fetch orders. Please try again.');
                }
            }
        };

        const unsubscribeUserId = onSnapshot(byUserIdQuery, (querySnapshot) => {
            userIdOrders = querySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
            userIdDone = true;
            syncMergedOrders();
        }, (err) => {
            console.error('Error fetching orders by userId:', err);
            userIdFailed = true;
            userIdDone = true;
            syncMergedOrders();
        });

        const unsubscribeLegacy = onSnapshot(byLegacyCustomerIdQuery, (querySnapshot) => {
            legacyOrders = querySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
            legacyDone = true;
            syncMergedOrders();
        }, (err) => {
            console.error('Error fetching orders by legacy customerId:', err);
            legacyFailed = true;
            legacyDone = true;
            syncMergedOrders();
        });

        return () => {
            unsubscribeUserId();
            unsubscribeLegacy();
        };
    }, [user, isUserLoading]);

    return (
        <div className="px-4 py-5 md:px-6 md:py-7 space-y-6">
            <header className="rounded-2xl border border-border/70 bg-card/65 p-4 md:p-5 flex items-center gap-3">
                <Button variant="ghost" size="icon" className="rounded-full border border-border/70" onClick={() => router.push('/customer-dashboard/profile')}>
                    <ArrowLeft className="h-5 w-5" />
                </Button>
                <div className="min-w-0">
                    <h1 className="font-[family-name:var(--font-customer-display)] text-2xl md:text-3xl font-bold tracking-tight">My Orders</h1>
                    <p className="text-sm text-muted-foreground mt-1">All your past and active orders in one place.</p>
                </div>
            </header>

            {loading ? (
                <div className="min-h-[50vh] rounded-3xl border border-border/60 bg-card/40 flex justify-center items-center">
                    <Loader2 className="animate-spin text-primary h-12 w-12" />
                </div>
            ) : error ? (
                <div className="rounded-3xl border border-destructive/30 bg-destructive/5 px-6 py-16 text-center text-destructive">
                    <p className="font-semibold">Error loading orders</p>
                    <p className="text-sm mt-1">{error}</p>
                </div>
            ) : orders.length > 0 ? (
                <div className="space-y-4">
                    {orders.map((order, index) => (
                        <OrderCard key={order.id} order={order} index={index} />
                    ))}
                </div>
            ) : (
                <div className="rounded-3xl border border-dashed border-border/70 bg-card/40 px-6 py-16 text-center text-muted-foreground">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary">
                        <ShoppingBag size={28} />
                    </div>
                    <p className="text-lg font-semibold text-foreground">No Orders Yet</p>
                    <p className="mt-1 text-sm">Place your first order and your order timeline will appear here.</p>
                </div>
            )}

            {!loading && orders.length > 0 ? (
                <div className="rounded-2xl border border-border/70 bg-card/50 px-4 py-3 text-xs text-muted-foreground flex items-center gap-2">
                    <ReceiptText className="h-4 w-4 text-primary" />
                    Orders update in real-time when status changes.
                </div>
            ) : null}
        </div>
    );
}
