'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ChefHat,
    Clock,
    Check,
    CookingPot,
    PackageCheck,
    X,
    Loader2,
    User,
    Phone,
    IndianRupee,
    Wallet,
    RefreshCw,
    Volume2,
    VolumeX,
    Package,
    Undo2,
    ConciergeBell
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFirebase } from '@/firebase';
import { collection, query, where, orderBy, onSnapshot, doc, getDoc } from 'firebase/firestore';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import InfoDialog from '@/components/InfoDialog';
import { useSearchParams } from 'next/navigation';

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const formatDateTime = (timestamp) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return format(date, 'dd/MM, p');
};

// Order Card Component - Same style as street-vendor-dashboard
const OrderCard = ({ order, onMarkPreparing, onMarkReady, onRevertToPending, isUpdating }) => {
    const token = order.dineInToken || order.id?.slice(-4);
    const isPending = order.status === 'pending' || order.status === 'confirmed';
    const isPreparing = order.status === 'preparing';
    const isReady = order.status === 'Ready' || order.status === 'ready_for_pickup';

    let statusClass = 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20';
    let borderClass = 'border-yellow-500';
    if (isPreparing) {
        statusClass = 'text-orange-500 bg-orange-500/10 border-orange-500/20';
        borderClass = 'border-orange-500';
    } else if (isReady) {
        statusClass = 'text-green-500 bg-green-500/10 border-green-500/20';
        borderClass = 'border-green-500';
    }

    const paymentDetailsArray = Array.isArray(order.paymentDetails) ? order.paymentDetails : [order.paymentDetails].filter(Boolean);
    const amountPaidOnlineDetails = paymentDetailsArray
        .filter(p => (p?.method === 'razorpay' || p?.method === 'phonepe' || p?.method === 'online') && p?.status === 'paid')
        .reduce((sum, p) => sum + (p?.amount || 0), 0);
    const isPaidViaRoot = order.paymentStatus === 'paid' && (order.paymentMethod === 'razorpay' || order.paymentMethod === 'phonepe' || order.paymentMethod === 'online');
    const isFullyPaidOnline = isPaidViaRoot || amountPaidOnlineDetails >= (order.totalAmount || 0);
    const amountPaidOnline = isPaidViaRoot ? (order.totalAmount || 0) : amountPaidOnlineDetails;
    const amountDueAtCounter = (order.totalAmount || 0) - amountPaidOnline;
    const isPartiallyPaid = !isFullyPaidOnline && amountPaidOnline > 0 && amountDueAtCounter > 0.01;

    return (
        <motion.div
            layout
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 20 }}
            className={cn("rounded-lg p-4 flex flex-col justify-between border-l-4 bg-card shadow-lg hover:shadow-primary/20 hover:-translate-y-1 transition-all duration-300", borderClass)}
        >
            <div>
                <div className="flex justify-between items-start">
                    <div>
                        <p className="text-4xl font-bold text-foreground">{token}</p>
                        {order.diningPreference === 'takeaway' && (
                            <div className="mt-2 flex items-center gap-2 text-sm font-bold px-3 py-1.5 rounded-lg bg-orange-500/20 text-orange-600 border-2 border-orange-500 w-fit">
                                <PackageCheck size={18} /> PACK THIS ORDER
                            </div>
                        )}
                        {order.diningPreference === 'dine-in' && (
                            <div className="mt-2 flex items-center gap-2 text-sm font-bold px-3 py-1.5 rounded-lg bg-cyan-500/20 text-cyan-600 border-2 border-cyan-500 w-fit">
                                <ConciergeBell size={18} /> SERVE ON PLATE
                            </div>
                        )}
                        {order.deliveryType === 'delivery' && (
                            <div className="mt-2 flex items-center gap-2 text-sm font-bold px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-600 border-2 border-blue-500 w-fit">
                                <Package size={18} /> DELIVERY ORDER
                            </div>
                        )}
                    </div>
                    <div className="text-right">
                        <div className={cn('px-2 py-1 text-xs font-semibold rounded-full border bg-opacity-20 capitalize', statusClass)}>{order.status}</div>
                        <p className="text-xs text-muted-foreground mt-1">{formatDateTime(order.orderDate)}</p>
                    </div>
                </div>
                <div className="flex justify-between items-center mt-2 border-b border-dashed border-border pb-3 mb-3">
                    <p className="text-3xl font-bold text-green-500">{formatCurrency(order.totalAmount)}</p>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        {isFullyPaidOnline ? (
                            <div className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-green-500/10 text-green-500 border border-green-500/20">
                                <Wallet size={14} /> PAID ONLINE
                            </div>
                        ) : isPartiallyPaid ? (
                            <div className="text-right">
                                <span className="block text-xs font-semibold text-green-500">Paid: {formatCurrency(amountPaidOnline)}</span>
                                <span className="block text-xs font-semibold text-yellow-400">Due: {formatCurrency(amountDueAtCounter)}</span>
                            </div>
                        ) : (
                            <div className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                                <IndianRupee size={14} /> PAY AT COUNTER
                            </div>
                        )}
                    </div>
                </div>

                <div className="mt-2 text-muted-foreground space-y-1">
                    <div className="flex items-center gap-2">
                        <User size={14} />
                        <span className="font-semibold text-foreground text-base">{order.customerName || 'Guest'}</span>
                    </div>
                    {order.customerPhone && (
                        <div className="flex items-center gap-2 text-xs">
                            <Phone size={12} />
                            <span>{order.customerPhone}</span>
                        </div>
                    )}
                </div>
                <div className="mt-3 pt-3 border-t border-dashed border-border">
                    <p className="font-semibold text-foreground text-sm mb-1.5">Items:</p>
                    <ul className="list-disc list-inside text-muted-foreground text-base space-y-2">
                        {(order.items || []).map((item, idx) => {
                            const portionName = item.portion?.name;
                            const addOns = (item.selectedAddOns || [])
                                .map(addon => `${addon.quantity}x ${addon.name}`)
                                .join(', ');

                            return (
                                <li key={idx} className="flex items-start gap-2">
                                    <span className="flex-1">
                                        {item.quantity || item.qty}x {item.name}
                                        {portionName && portionName.toLowerCase() !== 'full' && ` - ${portionName}`}
                                        {addOns && <span className="text-xs text-primary block pl-4">({addOns})</span>}
                                    </span>
                                    {item.isAddon && (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/30 text-xs font-semibold whitespace-nowrap">
                                            🆕 Added {item.addedAt ? format(new Date(item.addedAt?.seconds ? item.addedAt.seconds * 1000 : item.addedAt), 'hh:mm a') : ''}
                                        </span>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </div>
                {order.specialInstructions && (
                    <div className="mt-3 pt-3 border-t border-dashed border-yellow-500/30">
                        <p className="font-semibold text-yellow-400">⚠️ Special Instructions:</p>
                        <p className="text-sm text-yellow-400/90">{order.specialInstructions}</p>
                    </div>
                )}
            </div>
            <div className="mt-4">
                {isUpdating ? (
                    <div className="flex items-center justify-center gap-2 h-12 text-muted-foreground text-sm w-full">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Processing...
                    </div>
                ) : (
                    <>
                        {isPending && (
                            <div className="grid grid-cols-2 gap-2">
                                <Button onClick={() => onRevertToPending?.(order.id)} variant="outline" className="h-12 text-base">
                                    <Undo2 className="mr-2" size={18} /> Skip
                                </Button>
                                <Button onClick={() => onMarkPreparing(order.id)} className="bg-orange-500 hover:bg-orange-600 h-12 text-base">
                                    <CookingPot className="mr-2" size={18} /> Start Preparing
                                </Button>
                            </div>
                        )}
                        {isPreparing && (
                            <div className="flex gap-3">
                                <Button onClick={() => onRevertToPending?.(order.id)} variant="outline" className="h-12 text-base font-semibold flex-1">
                                    <Undo2 size={18} className="mr-2" /> Undo
                                </Button>
                                <Button onClick={() => onMarkReady(order.id)} className="bg-green-600 hover:bg-green-700 text-white font-bold text-base h-12 flex-[2]">
                                    <Check size={18} className="mr-2" /> Mark Ready
                                </Button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </motion.div>
    );
};

export default function KitchenPage() {
    const { user, firestore } = useFirebase();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [updatingOrderId, setUpdatingOrderId] = useState(null);
    const [outletId, setOutletId] = useState(null);
    const [collectionName, setCollectionName] = useState('restaurants');
    const [soundEnabled, setSoundEnabled] = useState(true);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const audioRef = useRef(null);
    const audioUnlockedRef = useRef(false);
    const lastOrderCountRef = useRef(0);

    // Unlock audio on first user interaction (mobile browsers block autoplay)
    useEffect(() => {
        const unlockAudio = () => {
            if (!audioUnlockedRef.current && audioRef.current) {
                audioRef.current.volume = 0;
                audioRef.current.play()
                    .then(() => {
                        audioRef.current.pause();
                        audioRef.current.currentTime = 0;
                        audioRef.current.volume = 1;
                        audioUnlockedRef.current = true;
                        console.log('[Audio] Unlocked successfully');
                    })
                    .catch(() => console.log('[Audio] Unlock attempt - will try on interaction'));
            }
        };

        const handleInteraction = () => {
            unlockAudio();
            if (audioUnlockedRef.current) {
                document.removeEventListener('click', handleInteraction);
                document.removeEventListener('touchstart', handleInteraction);
            }
        };

        document.addEventListener('click', handleInteraction);
        document.addEventListener('touchstart', handleInteraction);

        return () => {
            document.removeEventListener('click', handleInteraction);
            document.removeEventListener('touchstart', handleInteraction);
        };
    }, []);

    const playNotificationSound = useCallback(() => {
        if (!audioRef.current || !soundEnabled) return;

        // Vibrate for new order alert
        if (navigator.vibrate) {
            navigator.vibrate([200, 100, 200]);
        }

        audioRef.current.currentTime = 0;
        audioRef.current.volume = 1;
        audioRef.current.play()
            .then(() => console.log('[Audio] ✅ Notification sound played'))
            .catch(err => console.error('[Audio] ❌ Play failed:', err.message));
    }, [soundEnabled]);

    // Get outlet ID from user data
    useEffect(() => {
        if (!user) return;

        async function getOutletId() {
            const userDoc = await getDoc(doc(firestore, 'users', user.uid));
            if (userDoc.exists()) {
                const userData = userDoc.data();
                const activeOutlet = userData.linkedOutlets?.find(o => o.isActive) || userData.linkedOutlets?.[0];
                if (activeOutlet) {
                    setOutletId(activeOutlet.outletId);
                    setCollectionName(activeOutlet.collectionName || 'restaurants');
                }
            }
        }

        getOutletId();
    }, [user, firestore]);

    // Subscribe to orders (real-time)
    useEffect(() => {
        if (!outletId || !firestore) return;

        setLoading(true);
        let isInitialLoad = true;

        const ordersQuery = query(
            collection(firestore, 'orders'),
            where('restaurantId', '==', outletId),
            where('status', 'in', ['pending', 'confirmed', 'preparing']),
            orderBy('orderDate', 'asc')
        );

        const unsubscribe = onSnapshot(ordersQuery, (querySnapshot) => {
            let hasNewPendingOrder = false;

            if (!isInitialLoad) {
                querySnapshot.docChanges().forEach((change) => {
                    if (change.type === 'added' && (change.doc.data().status === 'pending' || change.doc.data().status === 'confirmed')) {
                        hasNewPendingOrder = true;
                    }
                });

                if (hasNewPendingOrder) {
                    playNotificationSound();
                }
            }

            isInitialLoad = false;

            const fetchedOrders = querySnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
            }));

            setOrders(fetchedOrders);
            setLoading(false);
        }, (error) => {
            console.error('Error fetching orders:', error);
            setInfoDialog({ isOpen: true, title: 'Error', message: 'Could not load orders. Please refresh.' });
            setLoading(false);
        });

        return () => unsubscribe();
    }, [outletId, firestore, playNotificationSound]);

    // API call handler
    const handleApiCall = useCallback(async (orderId, newStatus) => {
        if (!user) return;
        setUpdatingOrderId(orderId);

        try {
            const idToken = await user.getIdToken();
            let url = '/api/owner/orders';
            if (impersonatedOwnerId) {
                url += `?impersonate_owner_id=${impersonatedOwnerId}`;
            }

            const response = await fetch(url, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`,
                },
                body: JSON.stringify({ orderId, newStatus }),
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.message || 'Failed to update order');
            }

            // Haptic feedback
            if (navigator.vibrate) {
                navigator.vibrate(50);
            }

        } catch (error) {
            console.error('Error updating order:', error);
            setInfoDialog({ isOpen: true, title: 'Error', message: `Could not update order: ${error.message}` });
        } finally {
            setUpdatingOrderId(null);
        }
    }, [user, impersonatedOwnerId]);

    const handleMarkPreparing = (orderId) => handleApiCall(orderId, 'preparing');
    const handleMarkReady = (orderId) => handleApiCall(orderId, 'Ready');
    const handleRevertToPending = (orderId) => handleApiCall(orderId, 'pending');

    // Separate orders by status
    const pendingOrders = useMemo(() =>
        orders.filter(o => o.status === 'pending' || o.status === 'confirmed'),
        [orders]
    );
    const preparingOrders = useMemo(() =>
        orders.filter(o => o.status === 'preparing'),
        [orders]
    );

    if (loading) {
        return (
            <div className="p-6 flex items-center justify-center min-h-screen bg-background">
                <div className="text-center">
                    <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
                    <p className="text-muted-foreground">Loading kitchen orders...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-4 md:p-6 text-foreground min-h-screen bg-background">
            {/* Audio element for notifications */}
            <audio ref={audioRef} src="/sounds/new-order.mp3" preload="auto" />

            {/* Info Dialog */}
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />

            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-primary/20 rounded-xl flex items-center justify-center">
                        <ChefHat className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-foreground">Kitchen Display</h1>
                        <p className="text-muted-foreground text-sm">
                            {orders.length} active order{orders.length !== 1 ? 's' : ''}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setSoundEnabled(!soundEnabled)}
                        className={soundEnabled ? 'text-green-400' : 'text-muted-foreground'}
                    >
                        {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => window.location.reload()}
                        className="text-muted-foreground hover:text-foreground"
                    >
                        <RefreshCw className="w-5 h-5" />
                    </Button>
                </div>
            </div>

            {/* No orders */}
            {orders.length === 0 && (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-card rounded-2xl p-12 text-center border border-border"
                >
                    <Package className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                    <h2 className="text-xl font-semibold text-foreground mb-2">No Orders</h2>
                    <p className="text-muted-foreground">
                        New orders will appear here automatically
                    </p>
                </motion.div>
            )}

            {/* Orders Grid */}
            {orders.length > 0 && (
                <div className="grid lg:grid-cols-2 gap-6">
                    {/* New Orders Column */}
                    <div>
                        <div className="flex items-center gap-2 mb-4">
                            <div className="w-3 h-3 bg-yellow-500 rounded-full animate-pulse"></div>
                            <h2 className="text-lg font-semibold text-foreground">
                                New Orders ({pendingOrders.length})
                            </h2>
                        </div>
                        <AnimatePresence>
                            <div className="space-y-4">
                                {pendingOrders.map(order => (
                                    <OrderCard
                                        key={order.id}
                                        order={order}
                                        onMarkPreparing={handleMarkPreparing}
                                        onMarkReady={handleMarkReady}
                                        onRevertToPending={handleRevertToPending}
                                        isUpdating={updatingOrderId === order.id}
                                    />
                                ))}
                                {pendingOrders.length === 0 && (
                                    <div className="bg-card/50 rounded-xl p-6 text-center border border-border">
                                        <p className="text-muted-foreground">No new orders</p>
                                    </div>
                                )}
                            </div>
                        </AnimatePresence>
                    </div>

                    {/* Preparing Column */}
                    <div>
                        <div className="flex items-center gap-2 mb-4">
                            <CookingPot className="w-5 h-5 text-orange-400 animate-pulse" />
                            <h2 className="text-lg font-semibold text-foreground">
                                Preparing ({preparingOrders.length})
                            </h2>
                        </div>
                        <AnimatePresence>
                            <div className="space-y-4">
                                {preparingOrders.map(order => (
                                    <OrderCard
                                        key={order.id}
                                        order={order}
                                        onMarkPreparing={handleMarkPreparing}
                                        onMarkReady={handleMarkReady}
                                        onRevertToPending={handleRevertToPending}
                                        isUpdating={updatingOrderId === order.id}
                                    />
                                ))}
                                {preparingOrders.length === 0 && (
                                    <div className="bg-card/50 rounded-xl p-6 text-center border border-border">
                                        <p className="text-muted-foreground">No orders being prepared</p>
                                    </div>
                                )}
                            </div>
                        </AnimatePresence>
                    </div>
                </div>
            )}
        </div>
    );
}
