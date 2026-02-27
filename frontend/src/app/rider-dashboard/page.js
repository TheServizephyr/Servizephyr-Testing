
'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { Power, PowerOff, Loader2, Mail, Check, X, ShoppingBag, Bell, Bike, CheckCircle, Navigation, TrendingDown, Fuel, DollarSign, CreditCard, Send } from 'lucide-react';
import { auth, db, rtdb } from '@/lib/firebase';
import { doc, onSnapshot, collection, query, where, getDoc, getDocs, deleteDoc } from 'firebase/firestore';
import { ref, set, serverTimestamp, remove } from 'firebase/database'; // ✅ RTDB for location tracking
import { useUser } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import InfoDialog from '@/components/InfoDialog';
import { cn } from '@/lib/utils';
import { usePolling } from '@/lib/usePolling';
import { FirestorePermissionError } from '@/firebase/errors';
import { errorEmitter } from '@/firebase/error-emitter';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';
import { optimizeDeliveryRoute, formatRouteForGoogleMaps } from '@/lib/routeOptimizer';
import { emitAppNotification } from '@/lib/appNotifications';

const InvitationCard = ({ invite, onAccept, onDecline }) => {
    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="bg-primary/10 border border-primary/30 rounded-lg p-6 text-center"
        >
            <Mail size={32} className="mx-auto text-primary mb-3" />
            <h3 className="text-lg font-bold text-foreground">You have a new invitation!</h3>
            <p className="mt-1 text-muted-foreground">
                <span className="font-semibold text-foreground">{invite.restaurantName}</span> wants to add you as a delivery rider.
            </p>
            <div className="mt-4 flex justify-center gap-4">
                <Button onClick={() => onAccept(invite)} variant="default" className="bg-green-500 hover:bg-green-600 text-white"><Check className="mr-2 h-4 w-4" /> Accept</Button>
                <Button onClick={() => onDecline(invite.id)} variant="destructive"><X className="mr-2 h-4 w-4" /> Decline</Button>
            </div>
        </motion.div>
    )
}

const sanitizeUpiId = (value) => String(value || '').trim().toLowerCase();

const buildRiderManualUpiLink = ({ upiId, payeeName, amount, customerName, orderId }) => {
    const cleanedUpiId = sanitizeUpiId(upiId);
    if (!cleanedUpiId || !cleanedUpiId.includes('@')) return null;

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return null;

    const amountFixed = numericAmount.toFixed(2);
    const params = new URLSearchParams({
        pa: cleanedUpiId,
        pn: String(payeeName || 'ServiZephyr').trim().slice(0, 50),
        am: amountFixed,
        cu: 'INR',
        tn: `Order by ${String(customerName || 'Customer').trim().slice(0, 30)}`,
        tr: `ORD${String(orderId || '').replace(/[^a-zA-Z0-9]/g, '').slice(-12)}${Date.now().toString().slice(-4)}`
    });
    return `upi://pay?${params.toString()}`;
};

const buildRiderPaymentQrCardUrl = ({ order, restaurantData }) => {
    const upiId = sanitizeUpiId(restaurantData?.upiId);
    const payeeName = String(restaurantData?.upiPayeeName || restaurantData?.name || 'ServiZephyr').trim();
    const amount = Number(order?.totalAmount || order?.amount || 0);
    const amountFixed = Number.isFinite(amount) ? amount.toFixed(2) : null;
    if (!upiId || !upiId.includes('@') || !amountFixed) return null;

    const orderDisplayId = order?.customerOrderId ? `#${order.customerOrderId}` : `#${String(order?.id || '').slice(0, 8)}`;
    const upiLink = buildRiderManualUpiLink({
        upiId,
        payeeName,
        amount,
        customerName: order?.customerName || 'Customer',
        orderId: order?.id
    });
    if (!upiLink) return null;

    const baseUrl = (typeof window !== 'undefined' && window.location?.origin)
        ? window.location.origin.replace(/\/+$/g, '')
        : '';
    if (!baseUrl) return null;

    const upiQueryIndex = String(upiLink || '').indexOf('?');
    const upiParams = upiQueryIndex >= 0
        ? new URLSearchParams(String(upiLink).slice(upiQueryIndex + 1))
        : new URLSearchParams();
    const params = new URLSearchParams({
        am: amountFixed,
        upi: upiId,
        pn: payeeName,
        rn: String(restaurantData?.name || 'Restaurant').trim(),
        oid: orderDisplayId,
        tn: String(upiParams.get('tn') || '').trim(),
        tr: String(upiParams.get('tr') || '').trim()
    });

    return {
        imageUrl: `${baseUrl}/api/payment/upi-qr-card?${params.toString()}`,
        upiLink,
        amountFixed,
        orderDisplayId
    };
};



// 🎨 PREMIUM DELIVERY CARD - Modern Gradients, 3D Effects, Sequence Badges
const DeliveryCard = ({
    order,
    isPrimary,
    onStatusAction,
    isLoading,
    sequenceNumber,
    onShowQR,
    onShowInfo,
    isUpiConfigured,
    onSendPaymentRequestToCustomer,
    isSendingPaymentRequest
}) => {
    const [showPaymentModal, setShowPaymentModal] = useState(false);

    const handleMarkPaid = async (method) => {
        try {
            // Specific API call for payment status with method
            const response = await fetch('/api/rider/update-payment-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.currentUser?.accessToken || await auth.currentUser?.getIdToken()}` },
                body: JSON.stringify({ orderId: order.id, paymentStatus: 'paid', paymentMethod: method })
            });
            if (!response.ok) throw new Error("Update failed");

            // Close modal
            setShowPaymentModal(false);

            // Show success dialog
            onShowInfo && onShowInfo({
                isOpen: true,
                title: 'Success',
                message: `Marked as Paid via ${method === 'cash' ? 'Cash' : 'Online'}!`,
                type: 'success'
            });

        } catch (e) {
            onShowInfo && onShowInfo({
                isOpen: true,
                title: 'Error',
                message: "Failed to mark paid: " + e.message,
                type: 'error'
            });
        }
    };

    const getStatusConfig = (status) => {
        switch (status) {
            case 'ready_for_pickup': // ✅ NEW FLOW START
                return { button: 'MARK OUT FOR DELIVERY', gradient: 'from-blue-600 to-indigo-600', icon: '🚀' };
            case 'dispatched':
                return { button: 'REACHED RESTAURANT', gradient: 'from-orange-500 to-orange-600', icon: '🏪' };
            case 'reached_restaurant':
                return { button: 'FOOD COLLECTED', gradient: 'from-amber-500 to-amber-600', icon: '📦' };
            case 'picked_up': // Legacy/Alternative flow
                return { button: 'START DELIVERY', gradient: 'from-blue-500 to-indigo-600', icon: '🚀' };
            case 'on_the_way':
                return { button: '📍 REACHED LOCATION', gradient: 'from-purple-500 to-purple-600', icon: '📍' };
            case 'rider_arrived':
                return { button: '✅ MARK DELIVERED', gradient: 'from-green-500 to-emerald-600', icon: '✅' };
            case 'delivery_attempted':
                return { button: 'MARK FAILED', gradient: 'from-red-500 to-red-600', icon: '❌' };
            case 'failed_delivery':
                return { button: 'RETURNED TO RESTAURANT', gradient: 'from-gray-500 to-gray-600', icon: '🔄' };
            default:
                return { button: 'UPDATE STATUS', gradient: 'from-purple-500 to-purple-600', icon: '📋' };
        }
    };

    const config = getStatusConfig(order.status);
    const lat = order.customerLocation?._latitude || order.customerLocation?.latitude;
    const lng = order.customerLocation?._longitude || order.customerLocation?.longitude;

    // Generate Google Maps URL for this individual order
    const mapsUrl = lat && lng
        ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`
        : null;

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className={cn(
                "relative rounded-2xl p-5 sm:p-6 w-full break-words transition-all duration-300",
                "shadow-[0_10px_25px_-5px_rgba(0,0,0,0.1),0_8px_10px_-6px_rgba(0,0,0,0.1)]",
                "hover:shadow-[0_20px_40px_-10px_rgba(0,0,0,0.2),0_10px_15px_-8px_rgba(0,0,0,0.15)]",
                "hover:-translate-y-1",
                isPrimary
                    ? "bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950/30 dark:to-purple-950/30 border-2 border-blue-400"
                    : "bg-card border-2 border-border"
            )}
        >
            {/* 🔢 DELIVERY SEQUENCE BADGE */}
            {sequenceNumber && (
                <div className="absolute -top-3 -right-3 z-10">
                    <div className={cn(
                        "w-14 h-14 rounded-full flex items-center justify-center text-white font-black text-lg",
                        "shadow-lg transform transition-transform hover:scale-110",
                        sequenceNumber === 1
                            ? "bg-gradient-to-br from-yellow-400 to-amber-500"
                            : sequenceNumber === 2
                                ? "bg-gradient-to-br from-gray-300 to-gray-400"
                                : "bg-gradient-to-br from-orange-400 to-orange-500"
                    )}>
                        {sequenceNumber === 1 ? '1st' : sequenceNumber === 2 ? '2nd' : sequenceNumber === 3 ? '3rd' : `${sequenceNumber}th`}
                    </div>
                </div>
            )}

            {/* ⭐ PRIORITY BADGE */}
            {isPrimary && (
                <div className="flex items-center gap-2 mb-4 bg-gradient-to-r from-yellow-400/20 to-amber-400/20 rounded-lg p-3 border border-yellow-400/50">
                    <span className="text-2xl">⭐</span>
                    <span className="text-lg font-black bg-gradient-to-r from-yellow-600 to-amber-600 bg-clip-text text-transparent">DELIVER FIRST</span>
                </div>
            )}

            {/* 👤 CUSTOMER INFO */}
            <div className="mb-4 min-w-0">
                <p className="text-sm text-muted-foreground mb-1 font-medium">👤 Customer</p>
                <h3 className="text-2xl sm:text-3xl font-bold text-foreground break-words">{order.customerName || 'Unknown'}</h3>
                <p className="text-sm text-muted-foreground mt-2 break-words whitespace-normal flex items-start gap-1">
                    <span>📍</span>
                    <span>{order.customerAddress || 'Address not available'}</span>
                </p>
            </div>

            {/* 💰 PAYMENT ACTIONS - Visible ONLY after 'Reached Location' (rider_arrived) */}
            {order.status === 'rider_arrived' && (
                <div className={cn(
                    "p-4 rounded-xl mb-4 text-center transition-all duration-300",
                    "shadow-inner bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-950/30 dark:to-cyan-950/30 border-2 border-blue-400"
                )}>
                    {order.paymentStatus === 'paid' ? (
                        <>
                            <p className="text-2xl font-black bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">✅ PAYMENT DONE</p>
                            <p className="text-sm font-bold text-green-700 mt-1">
                                {order.paymentMethod === 'cash' ? 'Collected in Cash' : 'Paid Online'}
                            </p>
                        </>
                    ) : order.paymentMethod === 'cod' ? (
                        <>
                            <p className="text-2xl font-black bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">💵 COLLECT CASH</p>
                            <p className="text-4xl font-black bg-gradient-to-r from-green-700 to-emerald-700 bg-clip-text text-transparent mt-1">
                                ₹{order.totalAmount?.toFixed(2) || '0'}
                            </p>
                        </>
                    ) : (
                        <p className="text-sm font-bold text-muted-foreground mb-2">PAYMENT PENDING</p>
                    )}

                    {/* QR Code & Mark Paid Actions (For BOTH COD and Online) */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                        {isUpiConfigured && order.paymentStatus !== 'paid' && (
                            <button
                                onClick={() => onShowQR(order)}
                                className="w-full bg-white hover:bg-gray-100 text-foreground border border-border font-bold py-2 px-3 rounded-lg shadow-sm transition-all"
                            >
                                📲 Show QR
                            </button>
                        )}

                        {isUpiConfigured && order.paymentStatus !== 'paid' && (
                            <button
                                onClick={() => onSendPaymentRequestToCustomer?.(order.id)}
                                disabled={isSendingPaymentRequest}
                                className={cn(
                                    "w-full border font-bold py-2 px-3 rounded-lg shadow-sm transition-all flex items-center justify-center gap-2",
                                    isSendingPaymentRequest
                                        ? "bg-slate-200 text-slate-500 border-slate-300 cursor-not-allowed"
                                        : "bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-700"
                                )}
                            >
                                {isSendingPaymentRequest ? (
                                    <>
                                        <Loader2 size={14} className="animate-spin" />
                                        Sending...
                                    </>
                                ) : (
                                    <>
                                        <Send size={14} />
                                        Send to Customer
                                    </>
                                )}
                            </button>
                        )}

                        {/* MARK PAID BUTTON - Only visible if NOT paid yet */}
                        {order.paymentStatus !== 'paid' ? (
                            <>
                                <button
                                    onClick={() => setShowPaymentModal(true)}
                                    className="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold py-2 px-3 rounded-lg shadow-md hover:shadow-lg transition-all transform hover:-translate-y-0.5 active:scale-95 sm:col-span-2"
                                >
                                    ✅ Mark Paid
                                </button>

                                {/* PAYMENT SELECTION MODAL */}
                                <AnimatePresence>
                                    {showPaymentModal && (
                                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowPaymentModal(false)}>
                                            <motion.div
                                                initial={{ scale: 0.9, opacity: 0 }}
                                                animate={{ scale: 1, opacity: 1 }}
                                                exit={{ scale: 0.9, opacity: 0 }}
                                                className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl"
                                                onClick={e => e.stopPropagation()}
                                            >
                                                <h3 className="text-xl font-black text-gray-800 mb-4 text-center">Select Payment Method</h3>
                                                <div className="grid grid-cols-2 gap-4">
                                                    <button
                                                        onClick={() => handleMarkPaid('online')}
                                                        className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border-2 border-blue-100 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:border-blue-300 transition-all active:scale-95"
                                                    >
                                                        <CreditCard size={32} />
                                                        <span className="font-bold">Online Pay</span>
                                                    </button>
                                                    <button
                                                        onClick={() => handleMarkPaid('cash')}
                                                        className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border-2 border-green-100 bg-green-50 text-green-700 hover:bg-green-100 hover:border-green-300 transition-all active:scale-95"
                                                    >
                                                        <DollarSign size={32} />
                                                        <span className="font-bold">Cash</span>
                                                    </button>
                                                </div>
                                                <button
                                                    onClick={() => setShowPaymentModal(false)}
                                                    className="mt-6 w-full py-3 rounded-xl font-bold text-gray-500 hover:bg-gray-100 transition-colors"
                                                >
                                                    Cancel
                                                </button>
                                            </motion.div>
                                        </div>
                                    )}
                                </AnimatePresence>
                            </>
                        ) : (
                            <div className="w-full flex items-center justify-center bg-green-100 text-green-800 font-bold py-2 px-3 rounded-lg border border-green-200 sm:col-span-2">
                                <CheckCircle size={16} className="mr-2" />
                                {order.paymentMethod === 'cash' ? 'Paid (Cash)' : 'Paid (Online)'}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* 📞 CALL BUTTON - Gradient Style */}
            {order.customerPhone && (
                <a
                    href={`tel:${order.customerPhone}`}
                    className={cn(
                        "block w-full h-14 rounded-xl mb-3 flex items-center justify-center text-lg font-bold",
                        "bg-gradient-to-r from-green-500 to-emerald-600 text-white",
                        "shadow-md hover:shadow-lg",
                        "transform transition-all duration-200 hover:-translate-y-0.5 active:scale-95"
                    )}
                >
                    📞 Call: {order.customerPhone}
                </a>
            )}

            {/* 🗺️ GOOGLE MAPS NAVIGATION - Individual Order */}
            {mapsUrl && (
                <button
                    onClick={() => window.open(mapsUrl, '_blank')}
                    className={cn(
                        "block w-full h-14 rounded-xl mb-3 flex items-center justify-center text-lg font-bold",
                        "bg-gradient-to-r from-blue-500 to-indigo-600 text-white",
                        "shadow-md hover:shadow-lg",
                        "transform transition-all duration-200 hover:-translate-y-0.5 active:scale-95"
                    )}
                >
                    🗺️ Navigate to Customer
                </button>
            )}

            {/* ⚡ STATUS ACTION BUTTON - Premium Gradient */}
            <div className="relative">
                {/* DISABLED OVERLAY for Delivered Action if Pending Payment */}
                {config.button === '✅ MARK DELIVERED' && order.paymentStatus !== 'paid' && (
                    <div
                        className="absolute inset-0 z-10 cursor-not-allowed flex items-center justify-center"
                        onClick={() => onShowInfo && onShowInfo({
                            isOpen: true,
                            title: 'Action Restricted',
                            message: 'Please MARK PAID first before completing the delivery!',
                            type: 'warning' // Using warning type for yellow/orange feel or default
                        })}
                    >
                    </div>
                )}

                <button
                    onClick={() => onStatusAction(order.id, order.status)}
                    disabled={isLoading || (config.button === '✅ MARK DELIVERED' && order.paymentStatus !== 'paid')}
                    className={cn(
                        "w-full h-16 rounded-xl text-white text-xl font-black",
                        "bg-gradient-to-r", config.gradient,
                        "shadow-lg hover:shadow-xl",
                        "transform transition-all duration-200",
                        isLoading || (config.button === '✅ MARK DELIVERED' && order.paymentStatus !== 'paid')
                            ? "opacity-50 grayscale cursor-not-allowed"
                            : "hover:-translate-y-0.5 active:scale-95"
                    )}
                >
                    {isLoading ? (
                        <>
                            <Loader2 className="inline-block animate-spin mr-2" size={24} />
                            Loading...
                        </>
                    ) : (
                        <>{config.icon} {config.button}</>
                    )}
                </button>
            </div>

            {/* ↩️ UNDO BUTTONS for Simplified Flow */}
            {order.status === 'on_the_way' && (
                <button
                    onClick={() => onStatusAction(order.id, 'undo_on_the_way')}
                    disabled={isLoading}
                    className="w-full mt-3 h-12 rounded-xl text-muted-foreground text-sm font-bold border-2 border-dashed border-muted hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                    ↩️ UNDO (Back to Pickup)
                </button>
            )}
            {order.status === 'rider_arrived' && (
                <button
                    onClick={() => onStatusAction(order.id, 'undo_rider_arrived')}
                    disabled={isLoading || order.paymentStatus === 'paid'} // Disable undo if already paid/delivered logic engaged? No, allow undo to fix mistake.
                    className="w-full mt-3 h-12 rounded-xl text-muted-foreground text-sm font-bold border-2 border-dashed border-muted hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                    ↩️ UNDO (Back to On Way)
                </button>
            )}

            <p className="text-xs text-center text-muted-foreground mt-3 font-medium">Order #{order.customerOrderId || order.id?.substring(0, 8)}</p>
        </motion.div>
    );
};


export default function RiderDashboardPage() {
    const { user, isUserLoading } = useUser();
    const router = useRouter();
    const [driverData, setDriverData] = useState(null);
    const [invites, setInvites] = useState([]);
    const [activeOrders, setActiveOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isAcceptingOrder, setIsAcceptingOrder] = useState(false);
    const [error, setError] = useState('');
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const [restaurantData, setRestaurantData] = useState(null); // ✅ Store full restaurant data
    const [isRestaurantActive, setIsRestaurantActive] = useState(false);
    const [qrPreview, setQrPreview] = useState({ isOpen: false, imageUrl: '', orderDisplayId: '', amountFixed: '' });
    const [sendingPaymentRequestOrderId, setSendingPaymentRequestOrderId] = useState(null);
    const [isOnline, setIsOnline] = useState(true); // ✅ STEP 8C: Network status
    const [actionLoading, setActionLoading] = useState(null); // 🔥 POLISH 1: Button locking
    const [gpsPermission, setGpsPermission] = useState('granted'); // 🔥 POLISH 2: GPS warning
    const [batteryLevel, setBatteryLevel] = useState(100); // 🔥 POLISH 3: Battery warning
    const hasBootstrappedOrderNotificationRef = useRef(false);
    const prevAssignedOrderIdsRef = useRef(new Set());
    const [isOptimizingRoute, setIsOptimizingRoute] = useState(false); // 🚀 TSP Route optimization
    const [routeOptimizationResult, setRouteOptimizationResult] = useState(null); // 🚀 Optimization results
    const [optimizedRouteData, setOptimizedRouteData] = useState(null); // 🎯 API-optimized route for dashboard


    const handleApiCall = useCallback(async (endpoint, method = 'PATCH', body = {}) => {
        if (!user) throw new Error('Authentication Error');
        const idToken = await user.getIdToken();
        const response = await fetch(endpoint, {
            method,
            headers: {
                'Authorization': `Bearer ${idToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.message || 'An API error occurred.');
        }
        return await response.json();
    }, [user]);

    // Use adaptive polling for high-performance location tracking
    usePolling(async () => {
        if (!user || (driverData?.status !== 'online' && driverData?.status !== 'on-delivery')) return;

        try {
            const position = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 0
                });
            });

            const { latitude, longitude, speed, heading, accuracy } = position.coords;
            const currentOrderId = activeOrders.length > 0 ? activeOrders[0].id : null;

            const locationRef = ref(rtdb, `rider_locations/${user.uid}`);
            await set(locationRef, {
                latitude,
                longitude,
                speed: speed || 0,
                bearing: heading || 0,
                accuracy: accuracy || 10,
                timestamp: Date.now(),
                orderId: currentOrderId,
                isOnline: true
            });

            console.log('[RTDB] Location updated', currentOrderId ? `(Order: ${currentOrderId.substring(0, 8)})` : '(No active order)');

        } catch (err) {
            console.warn('[GPS] Failed:', err.message);
        }
    }, {
        interval: 10000,
        enabled: driverData?.status === 'online' || driverData?.status === 'on-delivery',
        deps: [driverData?.status, user?.uid, activeOrders?.length]
    });

    // ✅ SEPARATE CLEANUP: Remove RTDB location when going offline
    useEffect(() => {
        if (driverData?.status === 'offline' && user?.uid) {
            const locationRef = ref(rtdb, `rider_locations/${user.uid}`);
            remove(locationRef).then(() => {
                console.log('[RTDB] Location removed (rider offline)');
            }).catch((err) => {
                console.error('[RTDB] Cleanup failed:', err);
            });
        }
    }, [driverData?.status, user?.uid]);

    // ✅ STEP 8B: Screen Wake Lock
    useEffect(() => {
        let wakeLock = null;

        const requestWakeLock = async () => {
            try {
                if ('wakeLock' in navigator) {
                    wakeLock = await navigator.wakeLock.request('screen');
                    console.log('[Wake Lock] Screen will stay active');
                }
            } catch (err) {
                console.warn('[Wake Lock] Failed:', err);
            }
        };

        if (driverData?.status === 'online' || driverData?.status === 'on-delivery') {
            requestWakeLock();
        }

        return () => {
            wakeLock?.release();
        };
    }, [driverData?.status]);

    // ✅ STEP 8C: Network Status Monitoring
    useEffect(() => {
        const updateNetworkStatus = () => {
            setIsOnline(navigator.onLine);
            console.log('[Network]', navigator.onLine ? 'Online' : 'Offline');
        };

        window.addEventListener('online', updateNetworkStatus);
        window.addEventListener('offline', updateNetworkStatus);

        return () => {
            window.removeEventListener('online', updateNetworkStatus);
            window.removeEventListener('offline', updateNetworkStatus);
        };
    }, []);


    // 🔥 POLISH 2: GPS Permission Monitoring
    useEffect(() => {
        const checkGPSPermission = async () => {
            if ('permissions' in navigator) {
                try {
                    const result = await navigator.permissions.query({ name: 'geolocation' });
                    setGpsPermission(result.state);
                    result.addEventListener('change', () => setGpsPermission(result.state));
                } catch (err) {
                    console.warn('[GPS Permission] Check failed:', err);
                }
            }
        };
        checkGPSPermission();
    }, []);

    // 🔥 POLISH 3: Battery Level Monitoring
    useEffect(() => {
        const checkBattery = async () => {
            if ('getBattery' in navigator) {
                try {
                    const battery = await navigator.getBattery();
                    setBatteryLevel(battery.level * 100);
                    battery.addEventListener('levelchange', () => {
                        setBatteryLevel(battery.level * 100);
                    });
                } catch (err) {
                    console.warn('[Battery] Check failed:', err);
                }
            }
        };
        checkBattery();
    }, []);

    // Rider assignment notification (new orders assigned to this rider)
    useEffect(() => {
        const currentIds = new Set((activeOrders || []).map((o) => o.id));

        if (!hasBootstrappedOrderNotificationRef.current) {
            hasBootstrappedOrderNotificationRef.current = true;
            prevAssignedOrderIdsRef.current = currentIds;
            return;
        }

        const prevIds = prevAssignedOrderIdsRef.current;
        const newlyAssigned = [...currentIds].filter((id) => !prevIds.has(id));
        if (newlyAssigned.length > 0) {
            if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);

            emitAppNotification({
                scope: 'rider',
                title: 'New Delivery Assigned',
                message: newlyAssigned.length === 1
                    ? 'You have 1 newly assigned order.'
                    : `You have ${newlyAssigned.length} newly assigned orders.`,
                dedupeKey: `rider_assigned_${newlyAssigned.sort().join(',')}`,
                sound: '/notification-rider-assigned.mp3',
                href: '/rider-dashboard'
            });
        }

        prevAssignedOrderIdsRef.current = currentIds;
    }, [activeOrders]);

    // Helper: One-time restaurant data fetch (checks active status + gets UPI settings)
    const fetchRestaurantData = useCallback(async (restaurantId) => {
        if (!restaurantId) {
            setIsRestaurantActive(false);
            setRestaurantData(null);
            return;
        }

        try {
            // Optimized: Try 'restaurants' first, then fall back to other business collections.
            let restSnap = await getDoc(doc(db, 'restaurants', restaurantId));

            if (!restSnap.exists()) {
                restSnap = await getDoc(doc(db, 'shops', restaurantId));
            }

            if (!restSnap.exists()) {
                restSnap = await getDoc(doc(db, 'street_vendors', restaurantId));
            }

            if (restSnap.exists()) {
                const restData = restSnap.data();
                setIsRestaurantActive(true);
                setRestaurantData(restData);
            } else {
                setIsRestaurantActive(false);
                setRestaurantData(null);
            }
        } catch (error) {
            console.error('[RiderDash] Restaurant fetch error:', error);
            setIsRestaurantActive(false);
        }
    }, []);

    // Helper: One-time invites fetch (not a listener!)
    const fetchInvitesOnce = useCallback(async (userId) => {
        try {
            const invitesQuery = query(collection(db, 'drivers', userId, 'invites'));
            const snapshot = await getDocs(invitesQuery);
            setInvites(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        } catch (error) {
            console.error('[RiderDash] Invites fetch error:', error);
        }
    }, []);

    // Main data fetching and real-time listeners (OPTIMIZED: 5 → 2 listeners!)
    useEffect(() => {
        if (isUserLoading) return;
        if (!user) {
            router.push('/rider-auth');
            return;
        }

        setLoading(true);
        let unsubscribes = [];

        const driverDocRef = doc(db, 'drivers', user.uid);
        const unsubscribeDriver = onSnapshot(driverDocRef,
            (driverSnap) => {
                if (driverSnap.exists()) {
                    const data = driverSnap.data();
                    setDriverData(data);
                    setError('');

                    // One-time restaurant data fetch
                    if (data.currentRestaurantId) {
                        fetchRestaurantData(data.currentRestaurantId);
                    } else {
                        setIsRestaurantActive(false);
                    }
                } else {
                    setError('Your rider profile could not be found.');
                }
                setLoading(false); // Only stop loading after profile check
            },
            (err) => {
                const contextualError = new FirestorePermissionError({ path: driverDocRef.path, operation: 'get' });
                errorEmitter.emit('permission-error', contextualError);
                setError("You don't have permission to view this data.");
                setLoading(false);
            }
        );
        unsubscribes.push(unsubscribeDriver);

        // LISTENER 2: Active orders (critical real-time data)
        // ✅ Include all statuses from dispatch to delivery (except completed)
        const ordersQuery = query(
            collection(db, "orders"),
            where("deliveryBoyId", "==", user.uid),
            where("status", "in", [
                "ready_for_pickup", // ✅ ADDED THIS
                "dispatched", "reached_restaurant", "picked_up",
                "on_the_way", "rider_arrived", "delivery_attempted", "failed_delivery"
            ])
            // limit(50) // Removed limit for now as it breaks if >50 active orders (rare but possible)
        );
        const unsubscribeOrders = onSnapshot(ordersQuery, (snapshot) => {
            const newOrders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setActiveOrders(newOrders);
        });
        unsubscribes.push(unsubscribeOrders);

        // One-time fetch of invites (not real-time critical)
        fetchInvitesOnce(user.uid);

        console.log('[RiderDash] Active listeners:', unsubscribes.length); // Should log: 2

        return () => {
            console.log('[RiderDash] Cleaning up', unsubscribes.length, 'listeners');
            unsubscribes.forEach(unsub => unsub());
        };

    }, [user, isUserLoading, router, fetchRestaurantData, fetchInvitesOnce]);

    const handleToggleOnline = async () => {
        const newStatus = driverData?.status === 'online' ? 'offline' : 'online';
        try {
            await handleApiCall('/api/rider/dashboard', 'PATCH', { status: newStatus });
        } catch (err) {
            setInfoDialog({ isOpen: true, title: 'Error', message: 'Failed to update your status. Please try again.' });
        }
    };

    const handleAcceptInvite = async (invite) => {
        if (!user) return;
        try {
            const data = await handleApiCall('/api/rider/accept-invite', 'POST', {
                restaurantId: invite.restaurantId,
                restaurantName: invite.restaurantName,
                inviteId: invite.id
            });
            setInfoDialog({ isOpen: true, title: "Success!", message: data.message });
        } catch (err) {
            setInfoDialog({ isOpen: true, title: 'Error', message: `Failed to accept the invitation: ${err.message}` });
        }
    };

    const handleDeclineInvite = async (inviteId) => {
        if (!user) return;
        const inviteDocRef = doc(db, 'drivers', user.uid, 'invites', inviteId);
        try {
            await deleteDoc(inviteDocRef);
        } catch (err) {
            const contextualError = new FirestorePermissionError({ path: inviteDocRef.path, operation: 'delete' });
            errorEmitter.emit('permission-error', contextualError);
            setInfoDialog({ isOpen: true, title: 'Error', message: "Failed to decline invitation." });
        }
    }

    const isRestaurantUpiConfigured = useMemo(() => {
        const upiId = sanitizeUpiId(restaurantData?.upiId);
        return upiId.includes('@');
    }, [restaurantData?.upiId]);

    const handleOpenQrPreview = useCallback((order) => {
        const qrData = buildRiderPaymentQrCardUrl({ order, restaurantData });
        if (!qrData) {
            setInfoDialog({
                isOpen: true,
                title: 'UPI Not Configured',
                message: 'Restaurant UPI is missing or order amount is invalid. Please ask owner to set UPI ID and payee name in settings.'
            });
            return;
        }

        setQrPreview({
            isOpen: true,
            imageUrl: qrData.imageUrl,
            orderDisplayId: qrData.orderDisplayId,
            amountFixed: qrData.amountFixed
        });
    }, [restaurantData]);

    const handleSendPaymentRequestToCustomer = useCallback(async (orderId) => {
        if (!orderId || sendingPaymentRequestOrderId) return;
        setSendingPaymentRequestOrderId(orderId);

        const previousOrders = activeOrders;
        setActiveOrders(prev =>
            prev.map(order =>
                order.id === orderId
                    ? { ...order, paymentRequestSentAt: new Date() }
                    : order
            )
        );

        try {
            const result = await handleApiCall('/api/rider/send-payment-request', 'POST', { orderId });
            setInfoDialog({
                isOpen: true,
                title: 'Payment Request Sent',
                message: result?.message || 'Payment QR and Pay Now CTA sent to customer on WhatsApp.'
            });
        } catch (error) {
            setActiveOrders(previousOrders);
            setInfoDialog({
                isOpen: true,
                title: 'Failed',
                message: error?.message || 'Could not send payment request to customer.'
            });
        } finally {
            setSendingPaymentRequestOrderId(null);
        }
    }, [activeOrders, handleApiCall, sendingPaymentRequestOrderId]);

    // 🔥 POLISH 1 & 4: Unified Status Action Handler with Button Locking + Auto Scroll
    const handleStatusAction = async (orderId, currentStatus) => {
        if (actionLoading === orderId) return; // Prevent double tap

        setActionLoading(orderId);

        try {
            let endpoint, body;

            switch (currentStatus) {
                case 'undo_dispatched': // ↩️ NEW: Undo Logic (Legacy)
                    endpoint = '/api/rider/update-order-status';
                    body = { orderId, newStatus: 'ready_for_pickup' };
                    break;
                case 'undo_on_the_way': // ↩️ UNDO 'Reached Location' -> Back to 'Ready'
                    endpoint = '/api/rider/update-order-status';
                    body = { orderId, newStatus: 'ready_for_pickup' };
                    break;
                case 'undo_rider_arrived': // ↩️ UNDO 'Mark Delivered' -> Back to 'On The Way'
                    endpoint = '/api/rider/update-order-status';
                    body = { orderId, newStatus: 'on_the_way' };
                    break;
                case 'ready_for_pickup': // ✅ NEW: Directly to ON THE WAY (Skipping restaurant steps)
                    endpoint = '/api/rider/update-order-status'; // Generic update
                    body = { orderId, newStatus: 'on_the_way' };
                    break;
                case 'dispatched':
                    endpoint = '/api/rider/reached-restaurant';
                    body = { orderIds: [orderId] };
                    break;
                case 'reached_restaurant':
                    endpoint = '/api/rider/accept-order';
                    body = { orderIds: [orderId] };
                    break;
                case 'picked_up':
                    endpoint = '/api/rider/start-delivery';
                    body = { orderIds: [orderId] };
                    break;
                case 'on_the_way':
                    // NEW: Rider reached customer location
                    endpoint = '/api/rider/update-order-status';
                    body = { orderId, newStatus: 'rider_arrived' };
                    break;
                case 'rider_arrived':
                    // NEW: Mark as delivered after reaching
                    endpoint = '/api/rider/update-order-status';
                    body = { orderId, newStatus: 'delivered' };
                    break;
                default:
                    throw new Error('Unknown status');
            }

            await handleApiCall(endpoint, 'POST', body);

            // 🔥 POLISH 4: Auto scroll to top on status change
            window.scrollTo({ top: 0, behavior: 'smooth' });

            // 🎯 CRITICAL FIX: Only remove card when marking as delivered!
            // Check if THIS button press will set status to 'delivered'
            const willBeDelivered = (currentStatus === 'rider_arrived'); // Only "Mark Delivered" button

            if (willBeDelivered || currentStatus === 'failed_delivery' || currentStatus === 'returned') {
                console.log('[Dashboard] Removing order card - Status:', currentStatus, 'Will be delivered:', willBeDelivered);
                setActiveOrders(prev => prev.filter(o => o.id !== orderId));
            } else {
                console.log('[Dashboard] Keeping order card visible - Status:', currentStatus);
            }
        } catch (err) {
            setInfoDialog({ isOpen: true, title: 'Action Failed', message: err.message });
        } finally {
            setActionLoading(null);
        }
    }

    // 🚀 NAVIGATE ALL DELIVERIES - TSP Route Optimization
    const handleNavigateAll = async () => {
        if (!activeOrders || activeOrders.length === 0) {
            setInfoDialog({ isOpen: true, title: 'No Orders', message: 'No deliveries to navigate to.' });
            return;
        }

        if (!driverData?.currentRestaurantId) {
            setInfoDialog({ isOpen: true, title: 'No Restaurant', message: 'Not connected to any restaurant.' });
            return;
        }

        setIsOptimizingRoute(true);

        // ✅ OPTIMIZATION: Single order = Direct navigation (no API call needed!)
        if (activeOrders.length === 1) {
            const order = activeOrders[0];

            // Debug: Check what location data exists
            console.log('[Navigate] Order location data:', {
                customerLocation: order.customerLocation,
                deliveryLocation: order.deliveryLocation,
                address: order.address
            });

            // Try multiple possible location fields
            let lat, lng;

            // Option 1: customerLocation (most common)
            if (order.customerLocation) {
                lat = order.customerLocation._latitude || order.customerLocation.latitude;
                lng = order.customerLocation._longitude || order.customerLocation.longitude;
            }

            // Option 2: deliveryLocation
            if (!lat && order.deliveryLocation) {
                lat = order.deliveryLocation._latitude || order.deliveryLocation.latitude;
                lng = order.deliveryLocation._longitude || order.deliveryLocation.longitude;
            }

            // Option 3: address.coordinates
            if (!lat && order.address?.coordinates) {
                lat = order.address.coordinates._latitude || order.address.coordinates.latitude;
                lng = order.address.coordinates._longitude || order.address.coordinates.longitude;
            }

            console.log('[Navigate] Extracted coordinates:', { lat, lng });

            if (!lat || !lng) {
                setInfoDialog({
                    isOpen: true,
                    title: 'Location Missing',
                    message: `Customer location not available.\n\nPlease check order details in owner dashboard.`
                });
                setIsOptimizingRoute(false);
                return;
            }

            // Direct navigation for single order
            const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
            window.open(mapsUrl, '_blank');

            setInfoDialog({
                isOpen: true,
                title: '🗺️ Navigation Started!',
                message: `Navigate to ${order.customerName}\n💰 Cash to collect: ₹${order.totalAmount}`
            });

            setIsOptimizingRoute(false);
            return;
        }

        // 🎯 CALL API TO OPTIMIZE ROUTE (on-demand, only when clicked!)
        try {
            const result = await handleApiCall('/api/rider/optimize-route', 'POST', {
                orderIds: activeOrders.map(o => o.id),
                restaurantId: driverData.currentRestaurantId
            });

            if (result.success) {
                console.log('[Navigate All] API Success! Route optimized');

                // ✅ Store result so badges appear on dashboard
                setOptimizedRouteData(result);

                // Open Google Maps with optimized route
                if (result.googleMapsUrl) {
                    const newWindow = window.open(result.googleMapsUrl, '_blank');

                    if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
                        window.location.href = result.googleMapsUrl;
                    }
                }

                // Maps opens silently - no popup needed!
                console.log('[Navigate All] Success - Maps opened');
            } else {
                setInfoDialog({
                    isOpen: true,
                    title: 'Optimization Failed',
                    message: 'Could not optimize route. Please try again.'
                });
            }
        } catch (err) {
            console.error('[Navigate All] Error:', err);
            setInfoDialog({
                isOpen: true,
                title: 'Navigation Failed',
                message: err.message || 'Could not start navigation.'
            });
        } finally {
            setIsOptimizingRoute(false);
        }
    }


    if (loading) {
        return <div className="min-h-screen flex items-center justify-center bg-background"><GoldenCoinSpinner /></div>
    }

    if (error && !driverData) {
        return <div className="min-h-screen flex items-center justify-center bg-background"><p className="text-red-500">{error}</p></div>
    }

    const isDriverOnline = driverData?.status === 'online';
    const isBusy = driverData?.status === 'on-delivery';

    // 🎯 SIMPLE STATUS-BASED SORT (No API calls, no logs!)
    // Orders displayed by status priority - fast and clean
    const sortedOrders = [...activeOrders].sort((a, b) => {
        const statusOrder = {
            'rider_arrived': 0, // Top priority
            'on_the_way': 1,
            'ready_for_pickup': 2, // ✅ New status priority
            'delivery_attempted': 3,
            'picked_up': 4,
            'reached_restaurant': 5,
            'dispatched': 6,
            'failed_delivery': 7
        };
        return (statusOrder[a.status] || 99) - (statusOrder[b.status] || 99);
    });

    // Sequence badges ONLY after Navigate All is clicked
    let deliverySequenceMap = new Map();
    if (optimizedRouteData && optimizedRouteData.optimizedRoute) {
        optimizedRouteData.optimizedRoute.forEach((order, index) => {
            deliverySequenceMap.set(order.id, index + 1); // 1st, 2nd, 3rd...
        });
    }

    const primaryDelivery = sortedOrders[0];
    const secondaryDeliveries = sortedOrders.slice(1);

    return (
        <div className="min-h-screen bg-background pb-20">
            <InfoDialog isOpen={infoDialog.isOpen} onClose={() => setInfoDialog({ isOpen: false })} title={infoDialog.title} message={infoDialog.message} />

            <div className="p-4 md:p-6 space-y-4 max-w-2xl mx-auto">
                {/* ✅ STEP 8C: Network Loss Indicator */}
                {!isOnline && (
                    <div className="bg-red-100 border border-red-300 text-red-700 p-3 rounded-lg text-center text-sm font-semibold animate-pulse">
                        📡 Network lost. Reconnecting...
                    </div>
                )}

                {/* 🔥 POLISH 2: GPS Permission Warning */}
                {gpsPermission === 'denied' && (
                    <div className="bg-orange-100 border border-orange-300 text-orange-700 p-3 rounded-lg text-center text-sm font-semibold">
                        📍 Location permission required for deliveries. Enable in browser settings.
                    </div>
                )}

                {/* 🔥 POLISH 3: Battery Saver Warning */}
                {batteryLevel < 15 && (
                    <div className="bg-yellow-100 border border-yellow-300 text-yellow-700 p-3 rounded-lg text-center text-sm font-semibold">
                        🔋 Low battery ({Math.round(batteryLevel)}%) may affect tracking. Charge soon.
                    </div>
                )}

                {/* 📜 HISTORY BUTTON */}
                <Link href="/rider-dashboard/history">
                    <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white p-4 rounded-xl shadow-lg font-bold text-center flex items-center justify-center gap-2"
                    >
                        📜 Delivery History
                    </motion.button>
                </Link>

                {/* ✅ PHASE 1 & 8: Status Card with GPS Info */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-card p-6 rounded-xl border border-border shadow-lg"
                >
                    {/* Online/Offline Toggle */}
                    <button
                        onClick={handleToggleOnline}
                        disabled={isBusy}
                        className={cn(
                            "mx-auto w-28 h-28 rounded-full flex items-center justify-center transition-all duration-300 mb-4",
                            isDriverOnline ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400",
                            isBusy && "bg-blue-500/20 text-blue-400 cursor-not-allowed"
                        )}
                    >
                        {isDriverOnline || isBusy ? <Power size={48} /> : <PowerOff size={48} />}
                    </button>

                    <p className="text-sm text-muted-foreground text-center">YOUR STATUS</p>
                    <p className={cn("text-3xl font-bold text-center mt-1 capitalize", isDriverOnline ? 'text-green-400' : isBusy ? 'text-blue-400' : 'text-red-400')}>
                        {driverData?.status?.replace('-', ' ') || 'Offline'}
                    </p>
                    {isBusy && <p className="text-xs text-blue-400 text-center mt-2">Complete current delivery to go offline.</p>}

                    {/* PHASE 8: GPS Status */}
                    {(isDriverOnline || isBusy) && (
                        <div className="mt-4 pt-4 border-t border-border">
                            <div className="flex items-center justify-center gap-2 text-sm">
                                <span className="text-green-400">📍 GPS Active</span>
                                <span className="text-muted-foreground">•</span>
                                <span className="text-muted-foreground">Updates every 20s</span>
                            </div>
                        </div>
                    )}
                </motion.div>



                {/* 🚀 NAVIGATE ALL DELIVERIES - TSP OPTIMIZED ROUTE */}
                {activeOrders.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border border-blue-500/30 rounded-xl p-5 shadow-lg"
                    >
                        <div className="flex items-start justify-between mb-3">
                            <div>
                                <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                                    <Navigation className="text-blue-500" size={20} />
                                    Navigate All Deliveries
                                </h3>
                                <p className="text-xs text-muted-foreground mt-1">
                                    {activeOrders.length > 1 ? 'AI-optimized route to save fuel & time' : 'Start navigation'}
                                </p>
                            </div>
                            {activeOrders.length > 1 && (
                                <div className="bg-green-500/20 px-2 py-1 rounded-full">
                                    <Fuel className="text-green-500" size={16} />
                                </div>
                            )}
                        </div>

                        {/* Optimization Results (if available) */}
                        {routeOptimizationResult && routeOptimizationResult.metrics?.fuelSavings?.moneyRupees > 0 && (
                            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 mb-3">
                                <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                                    <TrendingDown size={16} />
                                    <span className="font-semibold">
                                        ₹{routeOptimizationResult.metrics.fuelSavings.moneyRupees.toFixed(2)} saved
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                        ({routeOptimizationResult.metrics.fuelSavings.distanceKm.toFixed(1)} km less)
                                    </span>
                                </div>
                            </div>
                        )}

                        <button
                            onClick={handleNavigateAll}
                            disabled={isOptimizingRoute}
                            className={cn(
                                "w-full py-3 px-4 rounded-lg font-bold text-white transition-all",
                                "bg-gradient-to-r from-blue-500 to-cyan-500",
                                "hover:from-blue-600 hover:to-cyan-600",
                                "active:scale-95",
                                isOptimizingRoute && "opacity-50 cursor-not-allowed"
                            )}
                        >
                            {isOptimizingRoute ? (
                                <>
                                    <Loader2 className="inline-block animate-spin mr-2" size={20} />
                                    Optimizing Route...
                                </>
                            ) : (
                                <>
                                    <Navigation className="inline-block mr-2" size={20} />
                                    {activeOrders.length > 1 ? `Navigate ${activeOrders.length} Stops (Optimized)` : 'Navigate to Customer'}
                                </>
                            )}
                        </button>

                        {activeOrders.length > 1 && (
                            <p className="text-xs text-center text-muted-foreground mt-2">
                                🧠 Using AI to find shortest route & save petrol
                            </p>
                        )}
                    </motion.div>
                )}

                {/* Invitation Section */}
                <AnimatePresence>
                    {driverData && !driverData.currentRestaurantId && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Restaurant Invitation</CardTitle>
                            </CardHeader>
                            <CardContent>
                                {invites.length > 0 ? (
                                    <div className="space-y-4">
                                        {invites.map(invite => (
                                            <InvitationCard key={invite.id} invite={invite} onAccept={handleAcceptInvite} onDecline={handleDeclineInvite} />
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-muted-foreground text-center py-8">You are not an employee of any restaurant yet. Ask your owner to send an invite to your email.</p>
                                )}
                            </CardContent>
                        </Card>
                    )}
                </AnimatePresence>

                {/* ✅ PHASE 1: PRIMARY DELIVERY (Focus Mode) */}
                {primaryDelivery && (
                    <div>
                        <h2 className="text-2xl font-black text-foreground mb-3 flex items-center gap-2">
                            <Bike className="text-primary" />
                            Current Delivery
                        </h2>
                        <DeliveryCard
                            order={primaryDelivery}
                            isPrimary={true}
                            onStatusAction={handleStatusAction}
                            isLoading={actionLoading === primaryDelivery.id}
                            sequenceNumber={deliverySequenceMap.get(primaryDelivery.id)}
                            onShowQR={handleOpenQrPreview}
                            onShowInfo={setInfoDialog}
                            isUpiConfigured={isRestaurantUpiConfigured}
                            onSendPaymentRequestToCustomer={handleSendPaymentRequestToCustomer}
                            isSendingPaymentRequest={sendingPaymentRequestOrderId === primaryDelivery.id}
                        />
                    </div>
                )}

                {/* ✅ PHASE 1: SECONDARY DELIVERIES (Collapsed) */}
                {secondaryDeliveries.length > 0 && (
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-lg flex items-center gap-2">
                                <ShoppingBag className="text-muted-foreground" size={20} />
                                Next Deliveries ({secondaryDeliveries.length})
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {secondaryDeliveries.map((order, index) => (
                                <div key={order.id}>
                                    {index > 0 && <hr className="my-3 border-border" />}
                                    <DeliveryCard
                                        order={order}
                                        isPrimary={false}
                                        onStatusAction={handleStatusAction}
                                        isLoading={actionLoading === order.id}
                                        sequenceNumber={deliverySequenceMap.get(order.id)}
                                        onShowQR={handleOpenQrPreview}
                                        onShowInfo={setInfoDialog}
                                        isUpiConfigured={isRestaurantUpiConfigured}
                                        onSendPaymentRequestToCustomer={handleSendPaymentRequestToCustomer}
                                        isSendingPaymentRequest={sendingPaymentRequestOrderId === order.id}
                                    />
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                )}

                {/* No Active Orders State */}
                {!primaryDelivery && (
                    <Card>
                        <CardContent className="py-12">
                            <div className="text-center">
                                <Bell className="mx-auto text-muted-foreground mb-4" size={48} />
                                <p className="text-xl font-semibold text-foreground">No Active Deliveries</p>
                                <p className="text-muted-foreground mt-2">Waiting for new orders from your restaurant...</p>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* QR Code Modal */}
                <AnimatePresence>
                    {qrPreview.isOpen && qrPreview.imageUrl && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
                            onClick={() => setQrPreview({ isOpen: false, imageUrl: '', orderDisplayId: '', amountFixed: '' })}
                        >
                            <motion.div
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.9, opacity: 0 }}
                                className="bg-white p-6 rounded-2xl max-w-md w-full shadow-2xl text-center"
                                onClick={e => e.stopPropagation()}
                            >
                                <h3 className="text-xl font-bold mb-2 text-black">Scan to Pay</h3>
                                {qrPreview.orderDisplayId && (
                                    <p className="text-sm text-gray-600 mb-3">Order {qrPreview.orderDisplayId}</p>
                                )}
                                <div className="bg-gray-100 p-3 rounded-xl inline-block mb-4">
                                    <Image
                                        src={qrPreview.imageUrl}
                                        alt="Payment QR"
                                        width={288}
                                        height={288}
                                        unoptimized
                                        className="w-72 h-auto object-contain rounded-lg"
                                    />
                                </div>
                                <p className="text-gray-500 text-sm mb-6">
                                    Show this QR to customer. Amount is fixed at INR {qrPreview.amountFixed || '0.00'}.
                                </p>
                                <Button
                                    onClick={() => setQrPreview({ isOpen: false, imageUrl: '', orderDisplayId: '', amountFixed: '' })}
                                    className="w-full"
                                >
                                    Close
                                </Button>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>

            </div>
        </div>
    );
}
