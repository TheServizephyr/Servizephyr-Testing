'use client';

import React, { useState, useEffect, useMemo, Suspense, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import Image from 'next/image';
import { Check, CookingPot, Bike, Home, Star, Phone, Navigation, RefreshCw, Loader2, ArrowLeft, XCircle, Wallet, Split, ConciergeBell, ShoppingBag, MapPin, CheckCircle, PackageCheck, Maximize, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { isFinalState, getPollingInterval, getPollingStartTime, clearPollingTimer, POLLING_MAX_TIME } from '@/lib/trackingConstants';
import dynamic from 'next/dynamic';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';
import { rtdb } from '@/lib/firebase'; // ✅ RTDB for real-time tracking
import { ref, onValue, off } from 'firebase/database'; // ✅ RTDB listeners

const LiveTrackingMap = dynamic(() => import('@/components/LiveTrackingMap'), {
    ssr: false,
    loading: () => <div className="w-full h-full bg-muted flex items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>
});

const statusConfig = {
    pending: { title: 'Order Placed', icon: <Check size={24} />, step: 0, description: "Your order has been sent to the restaurant." },
    paid: { title: 'Order Placed', icon: <Check size={24} />, step: 0, description: "Your order has been sent to the restaurant." },
    confirmed: { title: 'Order Confirmed', icon: <Check size={24} />, step: 1, description: "The restaurant has confirmed your order." },
    preparing: { title: 'Preparing Your Order', icon: <CookingPot size={24} />, step: 2, description: "Your meal is being prepared." },
    prepared: { title: 'Order Prepared', icon: <PackageCheck size={24} />, step: 3, description: 'Your order is prepared and waiting for rider assignment.' },
    dispatched: { title: 'Rider Assigned', icon: <Bike size={24} />, step: 4, description: "A delivery partner has been assigned to your order." },
    on_the_way: { title: 'Out for Delivery', icon: <Bike size={24} />, step: 5, description: "Our delivery hero is on their way." },
    rider_arrived: { title: 'Rider Reached', icon: <MapPin size={24} />, step: 6, description: "Your delivery partner has arrived at your location!" },
    delivered: { title: 'Delivered', icon: <Home size={24} />, step: 7, description: "Enjoy your meal!" },
    rejected: { title: 'Order Cancelled', icon: <XCircle size={24} />, step: 7, isError: true, description: "The restaurant could not accept your order." },
    picked_up: { title: 'Picked Up', icon: <ShoppingBag size={24} />, step: 7, description: "You have picked up your order." },
    ready_for_pickup: { title: 'Ready for Pickup', icon: <PackageCheck size={24} />, step: 5, description: 'Your order is ready for pickup.' }
};

// Internal Components
const RiderCard = ({ rider }) => {
    if (!rider) return null;
    return (
        <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="bg-white/80 backdrop-blur-md border border-white/20 shadow-xl rounded-2xl p-5 mb-6"
        >
            <div className="flex items-center gap-4">
                <div className="relative">
                    <Image
                        src={rider.photoUrl || 'https://cdn-icons-png.flaticon.com/512/10664/10664883.png'}
                        alt={rider.name}
                        width={64}
                        height={64}
                        unoptimized
                        className="w-16 h-16 rounded-full object-cover border-4 border-white shadow-md"
                    />
                    <div className="absolute -bottom-1 -right-1 bg-green-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full border-2 border-white">
                        4.8 ★
                    </div>
                </div>
                <div className="flex-1">
                    <h3 className="font-bold text-lg text-gray-800">{rider.name}</h3>
                    <p className="text-xs text-gray-500 font-medium">Delivery Partner • <span className="text-green-600">Vaccinated</span></p>
                    <div className="flex items-center gap-2 mt-2">
                        <Button size="sm" className="h-8 bg-green-600 hover:bg-green-700 rounded-full px-4 text-xs">
                            <Phone size={12} className="mr-1" /> Call
                        </Button>
                        <Button size="sm" variant="outline" className="h-8 rounded-full px-4 text-xs border-gray-200">
                            Message
                        </Button>
                    </div>
                </div>
            </div>
        </motion.div>
    );
};

const EnhancedTimeline = ({ currentStatus }) => {
    const steps = [
        { key: 'confirmed', label: 'Order Confirmed', icon: <CheckCircle size={16} /> },
        { key: 'preparing', label: 'Cooking', icon: <CookingPot size={16} /> },
        { key: 'prepared', label: 'Prepared', icon: <PackageCheck size={16} /> },
        { key: 'dispatched', label: 'Rider Assigned', icon: <Bike size={16} /> },
        { key: 'on_the_way', label: 'Out for Delivery', icon: <Bike size={16} /> },
        { key: 'rider_arrived', label: 'Rider Reached', icon: <MapPin size={16} /> },
        { key: 'delivered', label: 'Delivered', icon: <Home size={16} /> },
    ];

    // 🎯 CRITICAL: Map ALL database statuses to timeline steps
    const getTimelineStep = (status) => {
        switch (status) {
            // Initial states
            case 'pending':
            case 'paid':
            case 'placed':
                return -1; // Before timeline starts

            case 'confirmed':
                return 0; // Order Confirmed

            case 'preparing':
                return 1; // Cooking

            case 'prepared':
                return 2; // Food is prepared

            // Rider assignment & restaurant pickup (all show as "Rider Assigned")
            case 'ready_for_pickup': // ✅ Added support for new flow
            case 'reached_restaurant':
            case 'picked_up':
                return 3; // Rider Assigned (rider collecting food)

            // Delivery in progress
            case 'dispatched': // ✅ MOVED `dispatched` here (Step 3: Out for Delivery)
            case 'on_the_way':
                return 4; // Out for Delivery (rider clicked START DELIVERY)

            // Rider reached customer
            case 'rider_arrived':
                return 5; // Rider Reached (rider clicked REACHED LOCATION)

            // Final states
            case 'delivered':
            case 'picked_up_by_customer':
                return 6; // Delivered

            // Error/cancelled states
            case 'rejected':
            case 'cancelled':
            case 'failed_delivery':
                return 6; // Show as final state

            default:
                console.warn('[Timeline] Unknown status:', status);
                return -1;
        }
    };

    const currentStepIndex = getTimelineStep(currentStatus);

    return (
        <div className="relative pl-4 border-l-2 border-gray-100 space-y-8 my-8 ml-2">
            {steps.map((step, index) => {
                const isActive = index <= currentStepIndex;
                const isCurrent = index === currentStepIndex;

                return (
                    <div key={step.key} className="relative flex items-center group">
                        <motion.div
                            initial={false}
                            animate={{
                                scale: isCurrent ? 1.2 : 1,
                                backgroundColor: isActive ? '#10B981' : '#E5E7EB',
                                borderColor: isActive ? '#059669' : '#D1D5DB'
                            }}
                            className={`absolute -left-[21px] w-10 h-10 rounded-full border-4 flex items-center justify-center text-white shadow-sm z-10 transition-colors duration-300`}
                        >
                            {step.icon}
                        </motion.div>
                        <div className={`ml-8 transition-opacity duration-300 ${isActive ? 'opacity-100' : 'opacity-40'}`}>
                            <p className="font-bold text-sm text-gray-800">{step.label}</p>
                            {isCurrent && <p className="text-xs text-green-600 font-medium animate-pulse">In Progress</p>}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

// New Component for Order Tabs
const OrderTabs = ({ activeOrders, currentOrderId, onSwitch }) => {
    if (!activeOrders || activeOrders.length <= 1) return null;

    return (
        <div className="px-5 pt-4 overflow-x-auto whitespace-nowrap scrollbar-hide">
            <div className="flex gap-3">
                {activeOrders.map((order, index) => {
                    const isActive = order.orderId === currentOrderId;
                    return (
                        <button
                            key={order.orderId}
                            onClick={() => onSwitch(order.orderId)}
                            className={`px-4 py-2 rounded-full text-xs font-bold transition-all border ${isActive
                                ? 'bg-gray-900 text-white border-gray-900 shadow-lg'
                                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                                }`}
                        >
                            Order #{index + 1}
                            {/* Status Dot */}
                            <span className={`ml-2 inline-block w-2 h-2 rounded-full ${['delivered', 'picked_up'].includes(order.status) ? 'bg-green-500' : 'bg-orange-500 animate-pulse'
                                }`}></span>
                        </button>
                    )
                })}
            </div>
        </div>
    );
};

function OrderTrackingContent() {
    const { orderId: paramOrderId } = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const sessionToken = searchParams.get('token');
    const userPhone = searchParams.get('phone');
    const refParam = searchParams.get('ref');
    const activeOrderParam = searchParams.get('activeOrderId');

    // Internal State
    const [currentOrderId, setCurrentOrderId] = useState(paramOrderId);
    const [activeOrders, setActiveOrders] = useState([]); // List of all active orders for this user

    const buildOrderPageUrl = useCallback((restaurantId, overrideOrderId = null) => {
        if (!restaurantId) return null;

        const params = new URLSearchParams();
        if (sessionToken) params.set('token', sessionToken);
        if (userPhone) params.set('phone', userPhone);
        if (refParam) params.set('ref', refParam);

        const activeId = overrideOrderId || currentOrderId || activeOrderParam || paramOrderId;
        if (activeId) params.set('activeOrderId', activeId);

        const qs = params.toString();
        return qs ? `/order/${restaurantId}?${qs}` : `/order/${restaurantId}`;
    }, [sessionToken, userPhone, refParam, currentOrderId, activeOrderParam, paramOrderId]);

    // Handler to switch between active orders via tabs
    const handleSwitchOrder = (id) => {
        setCurrentOrderId(id);
    };

    // ... existing state ...
    const [orderData, setOrderData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const mapRef = useRef(null);
    const [isMapExpanded, setIsMapExpanded] = useState(false);

    // ========== BUNDLING FEATURE - TEMPORARILY DISABLED FOR MVP ==========
    // TODO: Re-enable after MVP launch - See bundling_feature_complete_guide.md
    /*
    // SMART BUNDLING STATE
    const [isBundlingEligible, setIsBundlingEligible] = useState(false);
    const [timeRemaining, setTimeRemaining] = useState(null);
    */
    const isBundlingEligible = false; // Bundling disabled
    const timeRemaining = null;
    // ========== END BUNDLING FEATURE ==========
    const [deliverySettings, setDeliverySettings] = useState(null); // To check if fees are enabled

    // Celebration/Rejection State Logic
    const currentOrderComplete = orderData?.order?.status === 'delivered';
    const currentOrderCancelled = orderData?.order?.status === 'rejected' ||
        orderData?.order?.status === 'cancelled';

    // Removed: activeOrders is empty for delivered orders, so this check fails

    // Removed: not needed, check current order directly

    // Removed: activeOrders is empty for cancelled orders too

    // Show celebration when current order is delivered
    const showFullScreenCelebration = currentOrderComplete;

    // Show rejection when current order is cancelled/rejected
    const showFullScreenCancellation = currentOrderCancelled;

    // 1. Fetch ALL active orders for this user (for Tabs)
    useEffect(() => {
        // Derive phone from URL param OR fetched order data
        const phoneToUse = userPhone || orderData?.order?.customerPhone || orderData?.order?.phone;
        const refParam = searchParams.get('ref');

        if (!phoneToUse && !refParam) return;

        const fetchActiveOrders = async () => {
            try {
                let url = `/api/order/active?`;
                if (phoneToUse) url += `phone=${phoneToUse}&`;
                if (refParam) url += `ref=${refParam}`;

                const res = await fetch(url);
                if (res.ok) {
                    const data = await res.json();
                    // Filter valid delivery orders or active ones
                    if (data.activeOrders) {
                        // Ensure we get an array, and prioritize the current order
                        let orders = Array.isArray(data.activeOrders) ? data.activeOrders : [data.activeOrders];

                        // FILTER DISABLED: Showing all active orders (supports mixed data scenarios)
                        // orders = orders.filter(o => o.deliveryType === 'delivery');

                        // If API returns single object inside activeOrders key (unlikely but safe)
                        // Sort Chronologically (Oldest = Order 1)
                        orders.sort((a, b) => {
                            const getDateVal = (o) => {
                                const d = o.orderDate || o.createdAt;
                                if (!d) return 0;
                                if (d.seconds) return d.seconds; // Timestamp
                                if (d._seconds) return d._seconds; // Serialized
                                if (typeof d === 'string') return new Date(d).getTime();
                                return 0;
                            };
                            return getDateVal(a) - getDateVal(b);
                        });

                        setActiveOrders(orders);
                    }
                }
            } catch (e) {
                console.error("Failed to fetch active orders list", e);
            }
        };
        fetchActiveOrders();
    }, [userPhone, orderData]);


    const fetchData = useCallback(async (isBackground = false) => {
        if (!isBackground) setLoading(true);
        if (!currentOrderId || !sessionToken) {
            setError("Order ID or tracking token is missing.");
            setLoading(false);
            return;
        }

        try {
            // Use currentOrderId instead of paramOrderId
            // FIXED: Pass token to API for auth check
            const queryParams = new URLSearchParams();
            if (sessionToken) queryParams.set('token', sessionToken);
            const res = await fetch(`/api/order/status/${currentOrderId}?${queryParams.toString()}`);
            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || 'Failed to fetch order status.');
            }
            const data = await res.json();
            const status = data.order?.status;

            setOrderData(data);
        } catch (err) {
            setError(err.message);
        } finally {
            if (!isBackground) setLoading(false);
        }
    }, [currentOrderId, sessionToken]); // depend on currentOrderId

    // BROWSER BACK BUTTON INTERCEPTION
    useEffect(() => {
        const preventBack = () => {
            window.history.pushState(null, document.title, window.location.href);
            const restaurantId = orderData?.order?.restaurantId || orderData?.restaurant?.id;
            const targetUrl = buildOrderPageUrl(restaurantId);
            if (targetUrl) {
                console.log('[DeliveryTrack] Back intercepted -> going to menu');
                router.replace(targetUrl);
            }
        };

        window.history.pushState(null, document.title, window.location.href);
        window.addEventListener('popstate', preventBack);

        return () => {
            window.removeEventListener('popstate', preventBack);
        };
    }, [orderData?.order?.restaurantId, orderData?.restaurant?.id, buildOrderPageUrl, router]);

    // Payment Verification
    const paymentStatus = searchParams.get('payment_status');
    useEffect(() => {
        const verifyPayment = async () => {
            if (paymentStatus === 'success' && currentOrderId) {
                try {
                    await fetch(`/api/payment/phonepe/status/${currentOrderId}`);
                    await fetchData();
                } catch (e) { console.error(e); }
            } else {
                fetchData();
            }
        };
        verifyPayment();
    }, [currentOrderId, paymentStatus, fetchData]);

    // RTDB Listener
    useEffect(() => {
        if (!currentOrderId || !orderData) return;
        const currentStatus = orderData.order?.status;
        if (isFinalState(currentStatus)) return;

        console.log('[RTDB] Attaching status listener for', currentOrderId);
        const statusRef = ref(rtdb, `delivery_tracking/${currentOrderId}`);
        const unsubscribe = onValue(statusRef, (snapshot) => {
            const rtdbData = snapshot.val();
            if (rtdbData && rtdbData.status && rtdbData.status !== currentStatus) {
                console.log('[RTDB] Status updated:', rtdbData.status);
                setOrderData(prev => ({
                    ...prev,
                    order: { ...prev.order, status: rtdbData.status }
                }));
            }
        });
        return () => off(statusRef, 'value', unsubscribe);
    }, [currentOrderId, orderData?.order?.status]);

    // FETCH DELIVERY SETTINGS (One time)
    useEffect(() => {
        if (orderData?.restaurant?.id) {
            fetch(`/api/owner/settings?restaurantId=${orderData.restaurant.id}`)
                .then(res => res.json())
                .then(data => setDeliverySettings(data))
                .catch(err => console.error("Failed to fetch settings:", err));
        }
    }, [orderData?.restaurant?.id]);

    // ========== BUNDLING FEATURE - TEMPORARILY DISABLED FOR MVP ==========
    /*
    // BUNDLING TIMER
    useEffect(() => {
        if (!orderData?.order?.createdAt) return;

        const checkTime = () => {
            const createdAt = new Date(orderData.order.createdAt.seconds ? orderData.order.createdAt.seconds * 1000 : orderData.order.createdAt);
            const now = new Date();
            const diffSeconds = (now - createdAt) / 1000;
            const windowSeconds = 10 * 60; // 10 minutes

            if (diffSeconds < windowSeconds) {
                setTimeRemaining(windowSeconds - diffSeconds);
                setIsBundlingEligible(true);
            } else {
                setTimeRemaining(0);
                setIsBundlingEligible(false);
            }
        };

        checkTime(); // Initial check
        const interval = setInterval(checkTime, 1000);
        return () => clearInterval(interval);
    }, [orderData?.order?.createdAt]);
    */
    // ========== END BUNDLING FEATURE ==========




    // Auto-update Param if changed externally
    useEffect(() => {
        if (paramOrderId && paramOrderId !== currentOrderId) {
            setCurrentOrderId(paramOrderId);
        }
    }, [paramOrderId]);


    const handleRecenter = () => {
        if (!mapRef.current) return;
        const bounds = new window.google.maps.LatLngBounds();
        if (orderData.restaurant?.address) bounds.extend({ lat: orderData.restaurant.address.latitude, lng: orderData.restaurant.address.longitude });
        if (orderData.deliveryBoy?.location) bounds.extend(orderData.deliveryBoy.location);
        if (orderData.order?.customerLocation) bounds.extend({
            lat: orderData.order.customerLocation._latitude || orderData.order.customerLocation.lat,
            lng: orderData.order.customerLocation._longitude || orderData.order.customerLocation.lng
        });

        if (!bounds.isEmpty()) {
            mapRef.current.fitBounds(bounds, 80);
        }
    };

    if (loading && !orderData) return <div className="h-screen flex items-center justify-center bg-gray-50"><GoldenCoinSpinner /></div>;
    if (error) return <div className="h-screen flex items-center justify-center text-red-500">{error}</div>;
    if (!orderData) return null;

    const normalizeDialablePhone = (value) => {
        if (!value) return null;
        const raw = String(value).trim();
        if (!raw) return null;

        if (raw.startsWith('+')) {
            const withCountryCode = `+${raw.slice(1).replace(/\D/g, '')}`;
            return withCountryCode.length > 1 ? withCountryCode : null;
        }

        const digitsOnly = raw.replace(/\D/g, '');
        return digitsOnly || null;
    };

    const restaurantCallPhone = normalizeDialablePhone(
        orderData?.restaurant?.ownerPhone ||
        orderData?.restaurant?.phone ||
        orderData?.restaurant?.contactPhone ||
        orderData?.order?.restaurantPhone
    );
    const restaurantCallHref = restaurantCallPhone ? `tel:${restaurantCallPhone}` : null;

    // Location Logic
    const mapLocations = {
        restaurantLocation: orderData.restaurant?.address
            ? { lat: orderData.restaurant.address.latitude, lng: orderData.restaurant.address.longitude }
            : orderData.restaurant?.restaurantLocation,
        customerLocation: orderData.order?.customerLocation
            ? {
                lat: orderData.order.customerLocation._latitude || orderData.order.customerLocation.lat,
                lng: orderData.order.customerLocation._longitude || orderData.order.customerLocation.lng
            }
            : null,
        riderLocation: orderData.deliveryBoy?.location,
    };

    return (
        <div className="h-[100dvh] w-full flex flex-col bg-gradient-to-br from-indigo-50 via-white to-purple-50 overflow-hidden font-sans">
            {/* TABS SECTION */}
            <OrderTabs activeOrders={activeOrders} currentOrderId={currentOrderId} onSwitch={handleSwitchOrder} />

            {/* CELEBRATION SCREEN - All Orders Delivered */}
            {showFullScreenCelebration && (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-gradient-to-br from-green-50 to-emerald-50">
                    <CheckCircle size={80} className="text-green-500 mb-6 animate-bounce" />
                    <h2 className="text-4xl font-bold text-gray-900 mb-2">
                        Order Delivered!
                    </h2>
                    <p className="mt-2 text-gray-600 max-w-md">
                        Thank you for your order. Enjoy your meal!
                    </p>
                    <Button
                        onClick={() => {
                            const targetUrl = buildOrderPageUrl(orderData?.restaurant?.id, currentOrderId);
                            if (targetUrl) router.push(targetUrl);
                        }}
                        className="mt-8 bg-green-600 text-white hover:bg-green-700 px-8 py-3 text-lg font-semibold rounded-xl shadow-lg"
                    >
                        Order Again
                    </Button>
                </div>
            )}

            {/* REJECTION SCREEN - All Orders Cancelled */}
            {showFullScreenCancellation && (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-gradient-to-br from-red-50 to-pink-50">
                    <XCircle size={80} className="text-red-500 mb-6" />
                    <h2 className="text-4xl font-bold text-gray-900 mb-2">
                        Order Cancelled
                    </h2>
                    <p className="mt-2 text-gray-600 max-w-md">
                        We&apos;re sorry, your order could not be processed.
                    </p>
                    <p className="mt-4 text-sm font-semibold bg-red-100 text-red-700 p-3 rounded-md max-w-md">
                        Reason: {orderData?.order?.rejectionReason || orderData?.order?.cancellationReason || 'Not specified'}
                    </p>
                    <Button
                        onClick={() => {
                            const targetUrl = buildOrderPageUrl(orderData?.restaurant?.id, currentOrderId);
                            if (targetUrl) router.push(targetUrl);
                        }}
                        className="mt-8 bg-gray-900 text-white hover:bg-black px-8 py-3 text-lg font-semibold rounded-xl shadow-lg"
                    >
                        Try Again
                    </Button>
                </div>
            )}

            {/* NORMAL TRACK PAGE - Only show when NOT celebrating or cancelled */}
            {!showFullScreenCelebration && !showFullScreenCancellation && (
                <div className={`flex-1 overflow-y-auto overflow-x-hidden w-full ${isMapExpanded ? 'overflow-hidden' : ''}`}>

                    {/* HEADER & STATUS CARD */}
                    {!isMapExpanded && (
                        <div className="px-5 pt-6 pb-4 z-20">
                            <motion.div
                                key={currentOrderId} // Animate on switch active
                                initial={{ y: -20, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                className="bg-white/90 backdrop-blur-sm shadow-sm rounded-2xl p-4 border border-gray-100"
                            >
                                <div className="flex justify-between items-start mb-3">
                                    <div>
                                        <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-0.5">ORDER #{orderData?.order?.customerOrderId || currentOrderId?.slice(0, 8) || '...'}</p>
                                        <h1 className="text-xl font-black text-gray-900 leading-tight line-clamp-1">{orderData?.restaurant?.name || 'Restaurant'}</h1>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button variant="ghost" size="sm" onClick={() => {
                                            const targetUrl = buildOrderPageUrl(orderData?.restaurant?.id, currentOrderId);
                                            if (targetUrl) {
                                                router.push(targetUrl);
                                            } else {
                                                router.back();
                                            }
                                        }} className="text-gray-500 hover:bg-gray-50 h-8 w-8 p-0 rounded-full">
                                            <ArrowLeft size={18} />
                                        </Button>
                                        <Button variant="ghost" size="sm" onClick={() => fetchData(true)} className="text-gray-400 h-8 w-8 p-0 rounded-full hover:bg-gray-50">
                                            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                                        </Button>
                                    </div>
                                </div>

                                {/* DYNAMIC STATUS BAR */}
                                {(() => {
                                    const status = orderData?.order?.status || 'pending';
                                    let statusText = "Order In Progress";
                                    let statusColor = "bg-gray-100 text-gray-600";
                                    let icon = <Loader2 size={16} className="animate-spin" />;

                                    // Determine if it's a delivery order to adjust 'ready' status text
                                    const isDelivery = orderData.deliveryBoy ||
                                        (orderData.order.deliveryMode === 'delivery') ||
                                        (orderData.order.type === 'delivery');

                                    // Custom Status Logic
                                    switch (status) {
                                        case 'pending':
                                        case 'placed':
                                        case 'paid':
                                            statusText = "Order Placed";
                                            statusColor = "bg-blue-50 text-blue-700";
                                            icon = <CheckCircle size={18} />;
                                            break;

                                        case 'confirmed':
                                        case 'accepted':
                                            statusText = "Order Confirmed";
                                            statusColor = "bg-green-50 text-green-700";
                                            icon = <Check size={18} />;
                                            break;

                                        case 'preparing':
                                        case 'cooking':
                                            statusText = "Preparing Your Food";
                                            statusColor = "bg-orange-50 text-orange-700";
                                            icon = <CookingPot size={18} className="animate-pulse" />;
                                            break;

                                        case 'prepared':
                                            statusText = "Order Prepared";
                                            statusColor = "bg-emerald-50 text-emerald-700";
                                            icon = <PackageCheck size={18} />;
                                            break;

                                        case 'dispatched':
                                        case 'reached_restaurant':
                                        case 'rider_assigned':
                                            // User requested explicit "Rider Assigned" for these states
                                            statusText = "Rider Assigned";
                                            statusColor = "bg-indigo-50 text-indigo-700"; // Distinct color
                                            icon = <Bike size={18} />;
                                            break;

                                        case 'ready':
                                        case 'ready_for_pickup':
                                            if (isDelivery) {
                                                // Delivery: Food is ready, waiting for rider pickup -> Show "Rider Assigned" (or "Food Ready")
                                                // User preferred "Rider Assigned"
                                                statusText = "Rider Assigned";
                                                statusColor = "bg-indigo-50 text-indigo-700 text-sm";
                                                icon = <Bike size={18} />;
                                            } else {
                                                // Pickup: Customer picks up
                                                statusText = "Ready for Pickup";
                                                statusColor = "bg-blue-100 text-blue-800";
                                                icon = <PackageCheck size={18} />;
                                            }
                                            break;

                                        case 'picked_up':
                                        case 'out_for_delivery':
                                        case 'on_the_way':
                                            statusText = "Out for Delivery";
                                            statusColor = "bg-green-100 text-green-800";
                                            icon = <Bike size={18} className="animate-bounce" />;
                                            break;

                                        case 'reached':
                                        case 'rider_arrived':
                                            statusText = "Rider Reached";
                                            statusColor = "bg-teal-50 text-teal-700";
                                            icon = <MapPin size={18} />;
                                            break;

                                        case 'delivered':
                                        case 'picked_up_by_customer':
                                            statusText = "Food Delivered";
                                            statusColor = "bg-green-600 text-white shadow-green-200";
                                            icon = <PackageCheck size={18} />;
                                            break;

                                        case 'cancelled':
                                        case 'rejected':
                                        case 'failed_delivery':
                                            statusText = "Order Cancelled";
                                            statusColor = "bg-red-50 text-red-700";
                                            icon = <XCircle size={18} />;
                                            break;

                                        default:
                                            // Fallback for unknown states
                                            statusText = "Order In Progress";
                                            statusColor = "bg-gray-50 text-gray-500";
                                            icon = <RefreshCw size={16} className="animate-spin opacity-50" />;
                                    }

                                    return (
                                        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl ${statusColor} font-bold shadow-sm transition-colors duration-300`}>
                                            <div className="shrink-0">{icon}</div>
                                            <span className="text-sm tracking-wide truncate">{statusText}</span>
                                        </div>
                                    );
                                })()}
                            </motion.div>
                        </div>
                    )}



                    {/* ========== BUNDLING FEATURE - TEMPORARILY DISABLED FOR MVP ========== */}
                    {/* SMART BUNDLING BANNER */}
                    {false && deliverySettings?.deliveryCodEnabled !== false && ( // Bundling disabled
                        <div className="px-5 mb-4">
                            {isBundlingEligible ? (
                                <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-xl p-4 shadow-sm flex items-center justify-between">
                                    <div>
                                        <p className="text-green-800 font-bold text-sm">Free Delivery on Add-ons!</p>
                                        <p className="text-green-600 text-xs mt-0.5">
                                            Order within <span className="font-mono font-bold bg-green-200 px-1 rounded">{Math.floor(timeRemaining / 60)}:{(Math.floor(timeRemaining % 60)).toString().padStart(2, '0')}</span> to bundle.
                                        </p>
                                    </div>
                                    <Button size="sm" onClick={() => {
                                        const targetUrl = buildOrderPageUrl(orderData?.restaurant?.id, currentOrderId);
                                        if (targetUrl) router.push(targetUrl);
                                    }} className="bg-green-600 hover:bg-green-700 text-white rounded-lg h-9 text-xs font-bold">
                                        + Add Items
                                    </Button>
                                </div>
                            ) : (
                                // Only show "Window Closed" if it was recently closed? Or persistent? 
                                // User requirement: "persistent banner... indicating standard shipping applies."
                                // We should show it if Status is still active (not delivered)
                                !isFinalState(orderData?.order?.status) && (
                                    <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex items-center gap-3 opacity-80">
                                        <div className="h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-500">
                                            <PackageCheck size={16} />
                                        </div>
                                        <div>
                                            <p className="text-gray-700 font-bold text-xs">Bundling Window Closed</p>
                                            <p className="text-gray-500 text-[10px]">Standard delivery fees apply to new orders.</p>
                                        </div>
                                    </div>
                                )
                            )}
                        </div>
                    )}

                    {/* MAP SECTION - BOXED */}
                    <div
                        className={`relative w-full transition-all duration-300 ease-in-out ${isMapExpanded ? 'fixed inset-0 h-[100dvh] z-50' : 'h-[50vh] px-4 py-1'}`}
                    >
                        <div className={`relative w-full h-full overflow-hidden shadow-2xl border-4 border-white ring-1 ring-gray-200 ${isMapExpanded ? '' : 'rounded-3xl'}`}>

                            {/* LIVE BADGE */}
                            {!isMapExpanded && (
                                <div className="absolute top-4 left-4 z-10 bg-white/90 backdrop-blur px-3 py-1.5 rounded-full shadow-sm flex items-center gap-2 pointer-events-none border border-white/50">
                                    <span className="relative flex h-2.5 w-2.5">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                                    </span>
                                    <span className="text-xs font-bold text-gray-700">Live Tracking</span>
                                </div>
                            )}

                            {/* MAP CONTAINER - Always interactive now */}
                            <div className="w-full h-full">
                                <LiveTrackingMap {...mapLocations} mapRef={mapRef} isInteractive={true} />
                            </div>

                            {/* EXPAND / COLLAPSE BUTTON - pointer-events-auto needed explicitly since parent might propagate none? No, siblings are fine, but good practice */}
                            <Button
                                onClick={() => setIsMapExpanded(!isMapExpanded)}
                                className={`absolute z-10 bg-white text-gray-800 shadow-xl rounded-full p-3 h-12 w-12 hover:bg-gray-50 border border-gray-100 pointer-events-auto transition-all duration-300 ${isMapExpanded ? 'top-6 right-6' : 'bottom-4 right-4'}`}
                            >
                                {isMapExpanded ? <X size={24} /> : <Maximize size={24} />}
                            </Button>

                            {!isMapExpanded && (
                                <div className="absolute bottom-20 right-4 z-10 pointer-events-auto">
                                    <Button
                                        onClick={handleRecenter}
                                        size="sm"
                                        className="rounded-full shadow-xl bg-white text-gray-800 hover:bg-gray-50 h-12 w-12 p-0 border border-gray-100"
                                    >
                                        <Navigation size={22} />
                                    </Button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* DETAILS SECTION - Scrolls with the page */}
                    {!isMapExpanded && (
                        <div className="w-full px-4 pb-32 pt-2">

                            {/* RIDER OFFLINE WARNING */}
                            {orderData.deliveryBoy && orderData.deliveryBoy.isOnline === false && (
                                <div className="bg-red-50 border border-red-100 text-red-600 p-3 rounded-xl mb-4 flex items-start gap-3 text-sm">
                                    <span className="text-xl">⚠️</span>
                                    <div>
                                        <p className="font-bold">Signal Lost</p>
                                        <p className="text-xs opacity-80 mt-0.5">Rider&apos;s location isn&apos;t updating. Don&apos;t worry, they are moving!</p>
                                    </div>
                                </div>
                            )}

                            {/* RIDER CARD */}
                            {orderData.deliveryBoy && (
                                <div className="bg-white border border-gray-100 shadow-sm rounded-2xl p-4 mb-6 flex items-center gap-4">
                                    <Image
                                        src={orderData.deliveryBoy.photoUrl || 'https://cdn-icons-png.flaticon.com/512/10664/10664883.png'}
                                        alt={orderData.deliveryBoy.name}
                                        width={56}
                                        height={56}
                                        unoptimized
                                        className="w-14 h-14 rounded-full object-cover border-2 border-gray-100"
                                    />
                                    <div className="flex-1 min-w-0">
                                        <h3 className="font-bold text-gray-900 truncate">{orderData.deliveryBoy.name}</h3>
                                        <p className="text-xs text-blue-600 font-bold">Delivery Partner</p>
                                    </div>
                                    <a href={`tel:${orderData.deliveryBoy.phone}`} className="no-underline">
                                        <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white rounded-full px-4 h-9 shadow-green-200 shadow-lg">
                                            <Phone size={14} className="mr-2" /> Call
                                        </Button>
                                    </a>
                                </div>
                            )}

                            {/* CUSTOMER DETAILS (New Addition) */}
                            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-6 relative overflow-hidden">
                                { /* Add a subtle background pattern or icon for visual separation */}
                                <div className="absolute top-0 right-0 p-4 opacity-5">
                                    <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" /></svg>
                                </div>

                                <div className="flex flex-col gap-1 relative z-10">
                                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Delivering To</span>
                                    <h3 className="font-bold text-gray-900 text-lg">
                                        {/* Fallback chain: customerName -> customer (which might serve as name) -> Guest */}
                                        {orderData.order.customerName || orderData.order.customer || 'Guest'}
                                    </h3>
                                    <p className="text-sm text-gray-600 leading-relaxed font-medium">
                                        {/* Fallback chain: customerAddress string -> address object (if exists) -> default message */}
                                        {orderData.order.customerAddress ||
                                            (orderData.order.address && (orderData.order.address.street || orderData.order.address.formatted_address || orderData.order.address.text)) ||
                                            'Address details not available'}
                                    </p>
                                </div>
                            </div>

                            {/* ORDER SUMMARY */}
                            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-6">
                                <div className="flex justify-between items-center mb-4 pb-3 border-b border-gray-50">
                                    <div>
                                        <h3 className="font-bold text-gray-800 text-sm">Bill Summary</h3>
                                        {orderData.order.createdAt && (
                                            <p className="text-[10px] text-gray-400 font-medium mt-0.5">
                                                {(() => {
                                                    try {
                                                        const d = new Date(orderData.order.createdAt._seconds
                                                            ? orderData.order.createdAt._seconds * 1000
                                                            : orderData.order.createdAt);
                                                        return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
                                                    } catch (e) { return ''; }
                                                })()}
                                            </p>
                                        )}
                                    </div>
                                    {/* PAYMENT STATUS BADGE */}
                                    {(() => {
                                        const paymentStatus = (orderData.order.paymentStatus || '').toLowerCase();
                                        const isPaidOnline = paymentStatus === 'paid' || paymentStatus === 'success';

                                        return !isPaidOnline ? (
                                            <div className="flex items-center gap-1.5 bg-yellow-50 px-2.5 py-1 rounded-lg border border-yellow-100">
                                                <span className="w-1.5 h-1.5 rounded-full bg-yellow-500"></span>
                                                <span className="text-[10px] text-yellow-700 font-extrabold uppercase tracking-wide">Pay on Delivery</span>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-1.5 bg-green-50 px-2.5 py-1 rounded-lg border border-green-100">
                                                <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                                                <span className="text-[10px] text-green-700 font-extrabold uppercase tracking-wide">Paid Online</span>
                                            </div>
                                        );
                                    })()}
                                </div>

                                <div className="space-y-3">
                                    {orderData.order.items?.map((item, i) => {
                                        let unitPrice = Number(item.price) || Number(item.itemPrice) || 0;
                                        const quantity = Number(item.quantity) || 1;
                                        if (unitPrice === 0) {
                                            const totalField = Number(item.totalPrice) || Number(item.total) || 0;
                                            if (totalField > 0) unitPrice = totalField / quantity;
                                        }
                                        const totalItemPrice = unitPrice * quantity;

                                        // Handle Addons (support both property names)
                                        const addons = item.addons || item.selectedAddOns || [];

                                        return (
                                            <div key={i} className="flex flex-col gap-1 text-sm text-gray-600 border-b border-gray-50 pb-2 last:border-0 last:pb-0">
                                                <div className="flex justify-between">
                                                    <div className="flex items-start gap-2">
                                                        <span className="bg-gray-100 text-gray-600 text-[10px] font-bold px-1.5 py-0.5 rounded-md min-w-[20px] text-center mt-0.5">{quantity}x</span>
                                                        <div className="flex flex-col">
                                                            <span className="font-medium">
                                                                {item.name}
                                                                {item.portion?.name ? ` (${item.portion.name})` : (item.variant ? ` (${item.variant})` : '')}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <span className="font-bold text-gray-800">₹{totalItemPrice.toFixed(2)}</span>
                                                </div>

                                                {/* Add-ons Display */}
                                                {addons.length > 0 && (
                                                    <div className="pl-9 pr-0">
                                                        {addons.map((addon, aIdx) => (
                                                            <div key={aIdx} className="flex justify-between text-xs text-gray-500">
                                                                <span>+ {addon.name}</span>
                                                                <span>₹{parseFloat(addon.price || 0).toFixed(2)}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Detailed Cost Breakdown */}
                                <div className="border-t border-dashed border-gray-200 mt-4 pt-3 space-y-2">
                                    {(() => {
                                        const subtotal = Number(orderData.order.subtotal) || 0;
                                        const total = Number(orderData.order.totalAmount);
                                        let delivery = Number(orderData.order.deliveryCharge) || 0;
                                        const tax = (Number(orderData.order.cgst) || 0) + (Number(orderData.order.sgst) || 0);
                                        const packing = Number(orderData.order.packagingCharge) || 0;
                                        const platform = Number(orderData.order.convenienceFee) || 0;
                                        const discount = Number(orderData.order.discount) || 0;

                                        // Improved breakdown logic: Calculate residual as delivery if not accounted for
                                        const accounted = subtotal + tax + packing + platform - discount;
                                        const residual = total - accounted;

                                        if (delivery === 0 && residual > 0) {
                                            delivery = residual;
                                        }

                                        return (
                                            <>
                                                <div className="flex justify-between text-xs text-gray-500">
                                                    <span>Item Total</span>
                                                    <span>₹{subtotal}</span>
                                                </div>
                                                {delivery > 0 && (
                                                    <div className="flex justify-between text-xs text-gray-500">
                                                        <span>Delivery Fee</span>
                                                        <span>₹{Number(delivery).toFixed(2)}</span>
                                                    </div>
                                                )}
                                                {tax > 0 && (
                                                    <div className="flex justify-between text-xs text-gray-500">
                                                        <span>Taxes (GST)</span>
                                                        <span>₹{Math.round(tax)}</span>
                                                    </div>
                                                )}
                                                {packing > 0 && (
                                                    <div className="flex justify-between text-xs text-gray-500">
                                                        <span>Packaging/Restaurant Charges</span>
                                                        <span>₹{packing}</span>
                                                    </div>
                                                )}
                                                {platform > 0 && (
                                                    <div className="flex justify-between text-xs text-gray-500">
                                                        <span>Platform Fee</span>
                                                        <span>₹{platform}</span>
                                                    </div>
                                                )}
                                                {discount > 0 && (
                                                    <div className="flex justify-between text-xs text-green-600 font-medium">
                                                        <span>Discount</span>
                                                        <span>-₹{discount}</span>
                                                    </div>
                                                )}
                                            </>
                                        );
                                    })()}
                                </div>

                                <div className="border-t border-gray-100 mt-2 pt-2 flex justify-between items-center">
                                    <span className="text-gray-700 text-sm font-bold">Total Bill</span>
                                    <span className="text-xl font-black text-gray-900">₹{Math.round(orderData.order.totalAmount)}</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* FOOTER ACTION - Only visible if map is NOT expanded */}
            {!isMapExpanded && (
                <div className="p-4 bg-white border-t border-gray-100 sticky bottom-0 z-30 pb-safe">
                    {restaurantCallHref ? (
                        <a href={restaurantCallHref} className="block w-full">
                            <Button className="w-full h-12 text-base font-bold bg-gray-900 text-white hover:bg-black shadow-lg rounded-xl flex items-center justify-center gap-2">
                                <Phone size={18} />
                                Call Restaurant
                            </Button>
                        </a>
                    ) : (
                        <Button
                            disabled
                            className="w-full h-12 text-base font-bold bg-gray-300 text-gray-600 rounded-xl flex items-center justify-center gap-2 cursor-not-allowed"
                        >
                            <Phone size={18} />
                            Restaurant Phone Unavailable
                        </Button>
                    )}
                </div>
            )}
        </div>
    )
}

export default function OrderTrackingPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><GoldenCoinSpinner /></div>}>
            <OrderTrackingContent />
        </Suspense>
    )
}
