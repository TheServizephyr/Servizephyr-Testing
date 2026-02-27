'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, ArrowLeft, CheckCircle, Check, IndianRupee, ShoppingBag, User, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import QRCode from 'qrcode.react';
import { db, auth } from '@/lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import { format } from 'date-fns';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';

const statusConfig = {
    confirmed: { title: 'Confirmed', icon: <Check size={24} />, step: 0, description: "Your order has been confirmed." },
    Ready: { title: 'Ready', icon: <CheckCircle size={24} />, step: 1, description: "Your order is ready for pickup!" },
    delivered: { title: 'Collected', icon: <User size={24} />, step: 2, description: "Order collected. Enjoy!" },
    rejected: { title: 'Rejected', icon: <XCircle size={24} />, step: 2, isError: true, description: "Order was rejected." },
    cancelled: { title: 'Cancelled', icon: <XCircle size={24} />, step: 2, isError: true, description: "Order was cancelled." },
};

const StatusTimeline = ({ currentStatus }) => {
    const activeStatus = (currentStatus === 'paid') ? 'confirmed' : currentStatus;
    const currentStepConfig = statusConfig[activeStatus] || { step: 0, isError: false };
    const currentStep = currentStepConfig.step;
    const isError = currentStepConfig.isError;

    const uniqueSteps = Object.values(statusConfig)
        .filter((value, index, self) =>
            !value.isError && self.findIndex(v => v.step === value.step) === index
        );

    return (
        <div className="flex justify-between items-start w-full px-2 sm:px-4 pt-4">
            {uniqueSteps.map(({ title, icon, step }) => {
                const isCompleted = step <= currentStep;
                const isCurrent = step === currentStep;
                return (
                    <React.Fragment key={step}>
                        <div className="flex flex-col items-center text-center w-20">
                            <motion.div
                                className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all duration-500 ${isError ? 'bg-destructive border-destructive text-destructive-foreground' :
                                    isCompleted ? 'bg-primary border-primary text-primary-foreground' : 'bg-card border-border text-muted-foreground'
                                    }`}
                                animate={{ scale: isCurrent ? 1.1 : 1 }}
                                transition={{ type: 'spring' }}
                            >
                                {icon}
                            </motion.div>
                            <p className={`mt-2 text-xs font-semibold ${isError ? 'text-destructive' :
                                isCompleted ? 'text-foreground' : 'text-muted-foreground'
                                }`}>
                                {isError ? statusConfig[currentStatus]?.title : title}
                            </p>
                        </div>
                        {step < uniqueSteps.length - 1 && (
                            <div className="flex-1 h-1 mt-6 mx-1 sm:mx-2 rounded-full bg-border">
                                <motion.div
                                    className={`h-full rounded-full ${isError ? 'bg-destructive' : 'bg-primary'}`}
                                    initial={{ width: '0%' }}
                                    animate={{ width: isCompleted ? '100%' : '0%' }}
                                    transition={{ duration: 0.5, delay: 0.2 }}
                                />
                            </div>
                        )}
                    </React.Fragment>
                );
            })}
        </div>
    );
};

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function PreOrderTrackingContent() {
    const router = useRouter();
    const { orderId } = useParams();
    const searchParams = useSearchParams();
    const tokenFromUrl = searchParams.get('token');

    const [order, setOrder] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // ✅ MULTI-ORDER STATE
    const [allOrders, setAllOrders] = useState([]);
    const [selectedOrderIndex, setSelectedOrderIndex] = useState(0);
    const [currentOrderId, setCurrentOrderId] = useState(orderId);
    const [currentToken, setCurrentToken] = useState(tokenFromUrl);

    // Animation states
    const [showRipple, setShowRipple] = useState(false);
    const [animationState, setAnimationState] = useState('drop');
    const [isFlipped, setIsFlipped] = useState(false);
    const tiltWrapperRef = useRef(null);

    // ✅ SMART CELEBRATION & CANCELLATION LOGIC
    const currentOrderComplete = order?.status === 'delivered';
    const currentOrderCancelled = order?.status === 'rejected' || order?.status === 'cancelled';

    // Check if ALL orders are delivered (for pure delivery celebration)
    const allOrdersComplete = allOrders.length > 0 &&
        allOrders.every(o => o.status === 'delivered');

    // Check if ALL orders are cancelled/rejected (for full-screen cancellation)
    const allOrdersCancelled = allOrders.length > 0 &&
        allOrders.every(o => o.status === 'cancelled' || o.status === 'rejected');

    // ✅ NEW: Check if ALL orders are FINALIZED (delivered OR cancelled)
    // This handles mixed scenarios: 2 delivered + 1 cancelled = all done!
    const allOrdersFinalized = allOrders.length > 0 &&
        allOrders.every(o => o.status === 'delivered' || o.status === 'cancelled' || o.status === 'rejected');

    // Check if ANY order is delivered (priority for celebration)
    const anyOrderDelivered = allOrders.some(o => o.status === 'delivered');

    // Show full-screen celebration ONLY if:
    // 1. Current order delivered AND
    // 2. (Single order OR all finalized) AND
    // 3. At least one order delivered (celebration wins over cancellation)
    const showFullScreenCelebration = currentOrderComplete &&
        (allOrders.length === 1 || allOrdersFinalized) &&
        anyOrderDelivered;

    // Show full-screen cancellation ONLY if:
    // 1. Current order cancelled AND
    // 2. (Single order OR all cancelled) AND
    // 3. NO delivered orders (celebration takes priority!)
    const showFullScreenCancellation = currentOrderCancelled &&
        (allOrders.length === 1 || allOrdersCancelled) &&
        !anyOrderDelivered;

    // ✅ LOAD ALL VENDOR ORDERS FROM LOCALSTORAGE
    useEffect(() => {
        const loadAllOrders = async () => {
            if (!order || !order.restaurantId) return;

            const { getVendorOrders } = await import('@/lib/vendorOrdersStorage');
            const orders = getVendorOrders(order.restaurantId);

            if (orders.length > 0) {
                // Sort orders chronologically: oldest first (Order 1, Order 2, Order 3...)
                const sortedOrders = orders.sort((a, b) => a.timestamp - b.timestamp);

                setAllOrders(sortedOrders);
                // Find index of current order
                const currentIndex = sortedOrders.findIndex(o => o.orderId === currentOrderId);
                if (currentIndex !== -1) {
                    setSelectedOrderIndex(currentIndex);
                }
                console.log(`[Track Page] Loaded ${sortedOrders.length} orders from localStorage (sorted chronologically)`);
            }
        };

        loadAllOrders();
    }, [order, currentOrderId]);

    // ✅ AUTO-CLEAN STORAGE: When ALL orders complete, clear localStorage
    useEffect(() => {
        if (showFullScreenCelebration && order?.restaurantId && order?.businessType === 'street-vendor') {
            // Only clean when full-screen celebration shows (ALL orders delivered)
            import('@/lib/vendorOrdersStorage').then(({ clearVendorOrders }) => {
                clearVendorOrders(order.restaurantId);
                console.log(`[Track Page] All orders complete - localStorage cleared for vendor ${order.restaurantId}`);
            });
        }
    }, [showFullScreenCelebration, order?.restaurantId, order?.businessType]);

    useEffect(() => {
        let unsubscribe = () => { };

        const setupListener = async () => {
            if (!orderId) {
                setError("Order ID is missing.");
                setLoading(false);
                return;
            }

            try {
                // Ensure anonymous auth for guest users
                if (!auth.currentUser) {
                    await signInAnonymously(auth);
                }

                const docRef = doc(db, 'orders', currentOrderId);

                // ✅ Use ref to track if we should stop processing updates
                const shouldStopRef = { current: false };

                unsubscribe = onSnapshot(docRef, (docSnap) => {
                    // Skip processing if we already stopped
                    if (shouldStopRef.current) return;

                    if (docSnap.exists()) {
                        const data = { id: docSnap.id, ...docSnap.data() };
                        // Robust token check with trim()
                        if (!data.trackingToken || data.trackingToken.trim() !== (currentToken || '').trim()) {
                            console.log(`[Track Page] Token Mismatch! Expected: ${data.trackingToken}, Got: ${tokenFromUrl}`);
                            setError("Invalid token. You do not have permission to view this order.");
                            setOrder(null);
                        } else {
                            setOrder(data);
                            setError(null);

                            // ✅ CRITICAL: Stop processing if order reached final state
                            const finalStates = ['delivered', 'cancelled', 'rejected'];
                            if (finalStates.includes(data.status)) {
                                console.log(`[Track Page] Order ${currentOrderId} reached final state: ${data.status} - Stopping listener processing`);
                                // Set flag to stop processing future updates
                                shouldStopRef.current = true;
                                // Unsubscribe will happen automatically on cleanup
                            }

                            // ✅ AUTO-SAVE: If order not in localStorage, add it now
                            // (Fixes issue where /order/placed page is skipped)
                            if (data.restaurantId && data.businessType === 'street-vendor') {
                                import('@/lib/vendorOrdersStorage').then(({ hasVendorOrder, addVendorOrder, updateVendorOrderStatus }) => {
                                    if (!hasVendorOrder(data.restaurantId, currentOrderId)) {
                                        addVendorOrder(data.restaurantId, {
                                            orderId: currentOrderId,
                                            token: currentToken,
                                            customerOrderId: data.customerOrderId, // NEW: Pass customer-facing ID
                                            totalAmount: data.totalAmount || 0,
                                            itemCount: data.items?.length || 0,
                                            status: data.status // NEW: Track initial status
                                        });
                                        console.log(`[Track Page] Auto-saved order ${currentOrderId} (CustomerID: ${data.customerOrderId}) to multi-order storage`);
                                    } else {
                                        // Update status in localStorage if it changed
                                        updateVendorOrderStatus(data.restaurantId, currentOrderId, data.status);
                                    }
                                });
                            }
                        }
                    } else {
                        setError("This order could not be found.");
                    }
                    setLoading(false);
                }, (err) => {
                    console.error("Firestore onSnapshot error:", err);
                    // Explicitly handle permission errors visually
                    if (err.code === 'permission-denied') {
                        setError("Access Denied: Please refresh the page or try again.");
                    } else {
                        setError("Could not load the order session.");
                    }
                    setLoading(false);
                });

            } catch (e) {
                console.error("Auth/Setup Error:", e);
                setError("Failed to initialize secure session.");
                setLoading(false);
            }
        };

        setupListener();

        return () => unsubscribe();
    }, [currentOrderId, currentToken]);

    useEffect(() => {
        const timer = setTimeout(() => {
            setAnimationState('float');
            setShowRipple(true);
            if (navigator.vibrate) navigator.vibrate([50, 20, 50]);
        }, 1200);

        const rippleTimer = setTimeout(() => setShowRipple(false), 2200);

        return () => { clearTimeout(timer); clearTimeout(rippleTimer); };
    }, []);

    useEffect(() => {
        const handleMouseMove = (e) => {
            if (!tiltWrapperRef.current) return;
            const x = e.clientX / window.innerWidth;
            const y = e.clientY / window.innerHeight;
            const rotateY = (x - 0.5) * 40;
            const rotateX = (0.5 - y) * 40;
            tiltWrapperRef.current.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
        };
        document.addEventListener('mousemove', handleMouseMove);
        return () => document.removeEventListener('mousemove', handleMouseMove);
    }, []);

    // Intercept Back Button to prevent going back to Checkout
    useEffect(() => {
        if (!order) return;

        // Add delay to prevent race condition with Next.js router after navigation
        const historyTimer = setTimeout(() => {
            // Push a dummy state to the history stack
            window.history.pushState(null, '', window.location.href);
        }, 300);

        const handlePopState = (event) => {
            // When user presses back, redirect to Menu instead of previous page (Checkout/Cart)
            event.preventDefault();
            if (order.restaurantId) {
                // Construct URL with query params to maintain session
                const phone = searchParams.get('phone') || order.customerPhone;
                const params = new URLSearchParams();
                params.set('restaurantId', order.restaurantId);
                if (tokenFromUrl) params.set('token', tokenFromUrl);
                if (phone) params.set('phone', phone);
                if (order.id) params.set('activeOrderId', order.id);

                router.replace(`/order/${order.restaurantId}?${params.toString()}`);
            } else {
                router.replace('/');
            }
        };

        window.addEventListener('popstate', handlePopState);

        return () => {
            clearTimeout(historyTimer);
            window.removeEventListener('popstate', handlePopState);
        };
    }, [order, router, tokenFromUrl, searchParams]);

    const handleBackToMenu = () => {
        if (order?.restaurantId) {
            const phone = searchParams.get('phone') || order.customerPhone;
            const params = new URLSearchParams();
            params.set('restaurantId', order.restaurantId);
            if (currentToken) params.set('token', currentToken);
            if (phone) params.set('phone', phone);
            if (order.id) params.set('activeOrderId', order.id); // ✅ RESTORED for Track button

            router.push(`/order/${order.restaurantId}?${params.toString()}`);
        } else {
            router.push('/');
        }
    };

    // ✅ HANDLE TAB SWITCH
    const handleOrderSwitch = (index) => {
        if (index === selectedOrderIndex) return;

        setSelectedOrderIndex(index);
        const selectedOrder = allOrders[index];
        setCurrentOrderId(selectedOrder.orderId);
        setCurrentToken(selectedOrder.token);
        setLoading(true);
        setOrder(null);

        console.log(`[Track Page] Switched to order ${selectedOrder.orderId}`);
    };

    const coinTheme = useMemo(() => {
        if (!order) return 'bronze-theme';
        const amount = order.totalAmount || 0;
        if (amount > 500) return 'gold-theme';
        if (amount >= 150) return 'silver-theme';
        return 'bronze-theme';
    }, [order]);

    const qrColor = useMemo(() => {
        switch (coinTheme) {
            case 'gold-theme': return '#5c3c00';
            case 'silver-theme': return '#4a4a4a';
            case 'bronze-theme':
            default: return '#4a3318';
        }
    }, [coinTheme]);


    if (loading) {
        return <div className="fixed inset-0 bg-background flex items-center justify-center"><GoldenCoinSpinner /></div>;
    }

    if (error) {
        return <div className="fixed inset-0 bg-background flex flex-col items-center justify-center text-red-500 p-4 text-center">
            <p>{error}</p>
            <Button onClick={handleBackToMenu} className="mt-4"><ArrowLeft size={16} className="mr-2" /> Back to Menu</Button>
        </div>;
    }

    if (!order) {
        return <div className="fixed inset-0 bg-background flex items-center justify-center text-muted-foreground p-4 text-center">Order data not available.</div>;
    }

    const token = order?.dineInToken || '----';
    const [tokenPart1, tokenPart2] = token.includes('-') ? token.split('-') : [token, ''];
    const qrValue = orderId ? `${window.location.origin}/street-vendor-dashboard?collect_order=${orderId}` : '';
    const orderDate = order.orderDate?.toDate ? order.orderDate.toDate() : new Date();
    const formattedDate = format(orderDate, 'dd MMM, p');

    return (
        <div className={cn("min-h-screen bg-background text-foreground font-sans", coinTheme)}>
            {/* 📌 Sticky Header Section - Always visible at top */}
            <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border">
                <div className="max-w-2xl mx-auto px-4 py-3">
                    {/* Multi-Order Banner */}
                    {allOrders.length > 1 && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex justify-center mb-2"
                        >
                            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 text-blue-900 px-5 py-2 rounded-full shadow-sm font-semibold text-xs">
                                🎉 You have {allOrders.length} active orders
                            </div>
                        </motion.div>
                    )}

                    {/* Back to Menu Button */}
                    {(order?.status === 'pending' || order?.status === 'confirmed' || order?.status === 'Ready') && (
                        <div className="flex items-center">
                            <Button onClick={handleBackToMenu} variant="ghost" className="text-foreground hover:bg-muted" size="sm">
                                <ArrowLeft className="mr-2" size={16} /> Back to Menu
                            </Button>
                        </div>
                    )}
                </div>
            </header>

            {/* 📄 Main Scrollable Content */}
            <main className="max-w-2xl mx-auto px-4 pb-8 space-y-6">
                <AnimatePresence>
                    {showFullScreenCelebration ? (
                        <section className="min-h-[60vh] flex items-center justify-center py-12 relative overflow-hidden">
                            {/* 🎈🎊 Celebration Rain */}
                            <div className="absolute inset-0 pointer-events-none">
                                {[...Array(50)].map((_, i) => {
                                    const isBalloon = i % 3 === 0;
                                    const colors = ['#FF6B6B', '#4ECDC4', '#FFD93D', '#95E1D3', '#F8B500', '#C7CEEA'];
                                    const randomColor = colors[Math.floor(Math.random() * colors.length)];
                                    const randomLeft = Math.random() * 100;
                                    const randomDelay = Math.random() * 2;

                                    return (
                                        <div
                                            key={i}
                                            className={isBalloon ? 'balloon' : 'confetti-celebration'}
                                            style={{
                                                background: randomColor,
                                                left: `${randomLeft}%`,
                                                animationDelay: `${randomDelay}s`
                                            }}
                                        />
                                    );
                                })}
                            </div>

                            <motion.div
                                key="completion-screen"
                                initial={{ scale: 0.8, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                className="text-center relative z-10"
                            >
                                <CheckCircle size={80} className="text-green-500 mb-6 mx-auto" />
                                <h2 className="text-4xl font-bold text-foreground">
                                    {allOrders.length > 1 ? 'All Orders Collected!' : 'Order Collected!'}
                                </h2>
                                <p className="mt-2 text-muted-foreground">
                                    {allOrders.length > 1
                                        ? `All ${allOrders.length} orders have been collected. Thank you!`
                                        : 'Thank you for your order. Enjoy your meal!'
                                    }
                                </p>
                                <Button onClick={handleBackToMenu} className="mt-8 bg-primary text-primary-foreground hover:bg-primary/90">
                                    Order Again
                                </Button>
                            </motion.div>
                        </section>
                    ) : showFullScreenCancellation ? (
                        <motion.div
                            key="rejection-screen"
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="flex-grow flex flex-col items-center justify-center text-center"
                        >
                            <motion.div initial={{ scale: 0.5 }} animate={{ scale: 1, rotate: [0, -10, 10, -5, 5, 0] }} transition={{ type: 'spring', stiffness: 500, damping: 15, delay: 0.2 }}>
                                <XCircle size={80} className="text-destructive mb-6" />
                            </motion.div>
                            <h2 className="text-4xl font-bold text-foreground">
                                {allOrders.length > 1 ? 'All Orders Cancelled' : 'Order Cancelled'}
                            </h2>
                            <p className="mt-2 text-muted-foreground">
                                {allOrders.length > 1
                                    ? `All ${allOrders.length} orders have been cancelled.`
                                    : "We're sorry, your order could not be processed."
                                }
                            </p>
                            <p className="mt-4 text-sm font-semibold bg-destructive/10 text-destructive p-2 rounded-md">Reason: {order.rejectionReason || 'Not specified'}</p>
                            <Button onClick={handleBackToMenu} className="mt-8 bg-primary text-primary-foreground hover:bg-primary/90">
                                Try Again
                            </Button>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="coin-view"
                            initial={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.8, opacity: 0 }}
                            className="flex-grow flex flex-col items-center justify-center"
                        >
                            <AnimatePresence>
                                {showRipple && <motion.div className="ripple" initial={{ width: 100, height: 100, opacity: 0.8, borderWidth: 10 }} animate={{ width: 500, height: 500, opacity: 0, borderWidth: 0 }} transition={{ duration: 1, ease: "easeOut" }} />}
                            </AnimatePresence>

                            <div className="scene">
                                <div className="tilt-wrapper" ref={tiltWrapperRef}>
                                    <div className={cn("anim-wrapper", animationState === 'drop' ? 'animate-drop' : 'animate-float')}>
                                        <div className={cn("coin", isFlipped && 'flipped')} onClick={() => setIsFlipped(f => !f)}>

                                            <div className="coin-face coin-front">
                                                <div className="texture-overlay"></div>
                                                <div className="sheen"></div>
                                                <svg className="rotating-text-svg" viewBox="0 0 200 200">
                                                    <path id="frontCurve" d="M 25,100 a 75,75 0 1,1 150,0 a 75,75 0 1,1 -150,0" fill="none" />
                                                    <text><textPath href="#frontCurve" startOffset="50%" textAnchor="middle">★ {order.restaurantName} ★ {formattedDate} ★</textPath></text>
                                                </svg>
                                                <div className="token-label">TOKEN</div>
                                                <div className="token-number">
                                                    <span className="token-number-main">{tokenPart1}-</span>
                                                    <span className="token-number-sub">{tokenPart2}</span>
                                                </div>
                                            </div>

                                            <div className="coin-face coin-back">
                                                <div className="texture-overlay"></div>
                                                <div className="sheen"></div>
                                                <svg className="rotating-text-svg" viewBox="0 0 200 200">
                                                    <path id="backCurve" d="M 25,100 a 75,75 0 1,1 150,0 a 75,75 0 1,1 -150,0" fill="none" />
                                                    <text><textPath href="#backCurve" startOffset="50%" textAnchor="middle">★ SECURED BY ServiZephyr ★ YOUR TRUSTED PARTNER ★</textPath></text>
                                                </svg>
                                                <div className="qr-box">
                                                    <QRCode
                                                        value={qrValue}
                                                        size={120}
                                                        level={"H"}
                                                        bgColor="transparent"
                                                        fgColor={qrColor}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* 📋 Single Order ID Display - ONLY for single order pages */}
                {allOrders.length === 1 && !(showFullScreenCelebration || showFullScreenCancellation) && order?.customerOrderId && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="w-full flex justify-center px-4 pb-4"
                    >
                        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-2xl px-6 py-3 shadow-sm">
                            <div className="text-center">
                                <div className="text-[10px] text-blue-600 font-semibold uppercase tracking-wider mb-0.5">
                                    Your Order ID
                                </div>
                                <div className="font-mono text-lg font-black text-blue-900 tracking-wide">
                                    {order.customerOrderId}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}

                {/* 🎨 Multi-Order Tabs - Calm & Professional */}
                {allOrders.length > 1 && !(showFullScreenCelebration || showFullScreenCancellation) && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="w-full px-4 pb-3"
                    >
                        <div className="flex gap-2.5 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                            {allOrders.map((o, index) => {
                                const isActive = index === selectedOrderIndex;

                                // Get customer-facing order ID (10 digits)
                                const customerOrderId = allOrders[index]?.customerOrderId || null;

                                // Get order status for theming
                                const orderStatus = isActive ? (order?.status || 'pending') : (allOrders[index]?.status || 'pending');

                                // Status-based colors (soft & calm)
                                let statusBg = 'bg-gray-50';
                                let statusBorder = 'border-gray-200';
                                let statusText = 'text-gray-700';

                                if (isActive) {
                                    if (orderStatus === 'confirmed' || orderStatus === 'Ready') {
                                        statusBg = 'bg-green-50';
                                        statusBorder = 'border-green-200';
                                        statusText = 'text-green-900';
                                    } else if (orderStatus === 'pending') {
                                        statusBg = 'bg-yellow-50';
                                        statusBorder = 'border-yellow-200';
                                        statusText = 'text-yellow-900';
                                    }
                                }

                                return (
                                    <motion.button
                                        key={o.orderId}
                                        onClick={() => handleOrderSwitch(index)}
                                        className={cn(
                                            "flex-1 min-w-[130px] h-20 rounded-2xl border-2 transition-all duration-300",
                                            "shadow-sm hover:shadow-md",
                                            isActive
                                                ? cn(statusBg, statusBorder, "scale-100")
                                                : "bg-white border-gray-200 opacity-70 hover:opacity-100"
                                        )}
                                        whileHover={{ y: -2 }}
                                        whileTap={{ scale: 0.98 }}
                                    >
                                        <div className={cn(
                                            "h-full flex flex-col items-center justify-center gap-1.5 px-3",
                                            isActive ? statusText : "text-gray-600"
                                        )}>
                                            {/* Icon + Label */}
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-lg">🍽️</span>
                                                <span className="font-bold text-sm">
                                                    Order {index + 1}
                                                </span>
                                            </div>

                                            {/* Customer Order ID - Bold & Prominent */}
                                            {customerOrderId ? (
                                                <div className={cn(
                                                    "font-mono text-[10px] font-bold tracking-wide",
                                                    isActive ? "opacity-90" : "opacity-70"
                                                )}>
                                                    <span className="font-extrabold">OrderID:</span> {customerOrderId}
                                                </div>
                                            ) : (
                                                <div className="text-[9px] opacity-40 italic">
                                                    Legacy order
                                                </div>
                                            )}
                                        </div>
                                    </motion.button>
                                );
                            })}
                        </div>
                    </motion.div>
                )}

                {!(showFullScreenCelebration || showFullScreenCancellation) && (
                    <footer className="w-full flex flex-col items-center gap-6 z-20 pb-8">
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={cn(
                                "relative border p-4 rounded-2xl shadow-md w-full max-w-sm transition-colors duration-500 overflow-hidden",
                                // Pending/Confirmed - Yellow
                                (order.status === 'pending' || order.status === 'confirmed') && "bg-yellow-50 border-yellow-200",
                                // Ready - Green
                                order.status === 'Ready' && "bg-green-50 border-green-200",
                                // Delivered - Beautiful gradient with confetti
                                order.status === 'delivered' && "bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-300 border-2",
                                // Canceled/Rejected - Red
                                (order.status === 'cancelled' || order.status === 'rejected') && "bg-red-50 border-red-300 border-2",
                                // Other statuses
                                !['pending', 'confirmed', 'Ready', 'delivered', 'cancelled', 'rejected'].includes(order.status) && "bg-card border-border"
                            )}
                        >
                            {/* 🎉 Localized Celebration - Only when order is delivered */}
                            {order.status === 'delivered' && (
                                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                                    {[...Array(30)].map((_, i) => {
                                        const style = {
                                            left: `${Math.random() * 100}%`,
                                            top: `-5%`,
                                            animationDelay: `${Math.random() * 2}s`,
                                            animationDuration: `${Math.random() * 2 + 2}s`,
                                            backgroundColor: `hsl(${Math.random() * 360}, 70%, 60%)`
                                        };
                                        return <div key={i} className="confetti-local" style={style}></div>
                                    })}
                                </div>
                            )}

                            {/* ✅ Order Complete Message */}
                            {order.status === 'delivered' && (
                                <div className="bg-emerald-100 border-2 border-emerald-400 rounded-xl p-3 mb-3 relative z-10">
                                    <div className="flex items-center gap-2">
                                        <CheckCircle size={24} className="text-emerald-600" />
                                        <div>
                                            <h3 className="font-bold text-emerald-900 text-sm">Order Complete! 🎉</h3>
                                            <p className="text-emerald-700 text-xs">Your order has been delivered</p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* ❌ Order Canceled Message */}
                            {(order.status === 'cancelled' || order.status === 'rejected') && (
                                <div className="bg-red-100 border-2 border-red-400 rounded-xl p-3 mb-3 relative z-10">
                                    <div className="flex items-center gap-2">
                                        <XCircle size={24} className="text-red-600" />
                                        <div className="flex-1">
                                            <h3 className="font-bold text-red-900 text-sm">Order Canceled</h3>
                                            {order.rejectionReason || order.cancellationReason ? (
                                                <p className="text-red-700 text-xs mt-1">
                                                    <strong>Reason:</strong> {order.rejectionReason || order.cancellationReason}
                                                </p>
                                            ) : (
                                                <p className="text-red-700 text-xs">This order was canceled</p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="space-y-2">
                                <p className="text-sm"><strong>Bill to:</strong> {order.customerName}</p>
                                {order.diningPreference && (
                                    <p className="text-sm">
                                        <strong>Dining Preference: </strong>
                                        <span className={cn(
                                            "font-semibold px-2 py-0.5 rounded-full text-xs",
                                            order.diningPreference === 'takeaway' ? "bg-orange-100 text-orange-700 border border-orange-200" :
                                                order.diningPreference === 'dine-in' ? "bg-cyan-100 text-cyan-700 border border-cyan-200" :
                                                    "bg-gray-100 text-gray-700 border border-gray-200"
                                        )}>
                                            {order.diningPreference === 'takeaway' ? 'Takeaway' : order.diningPreference === 'dine-in' ? 'Dine-In' : order.diningPreference}
                                        </span>
                                    </p>
                                )}
                                {order.items.map((item, index) => {
                                    // Handle Addons (support both property names)
                                    const addons = item.addons || item.selectedAddOns || [];

                                    return (
                                        <div key={index} className="flex flex-col gap-1 text-sm text-muted-foreground border-b border-border/50 pb-2 mb-2 last:border-0 last:pb-0 last:mb-0">
                                            <div className="flex justify-between items-start">
                                                <span className="font-medium text-foreground">
                                                    {item.quantity} x {item.name}
                                                    {item.portion?.name ? ` (${item.portion.name})` : (item.variant ? ` (${item.variant})` : '')}
                                                </span>
                                                <span className="font-semibold text-foreground">{formatCurrency(item.totalPrice)}</span>
                                            </div>

                                            {/* Add-ons Display */}
                                            {addons.length > 0 && (
                                                <div className="pl-4 border-l-2 border-border/50 ml-1">
                                                    {addons.map((addon, aIdx) => (
                                                        <div key={aIdx} className="flex justify-between text-xs opacity-80">
                                                            <span>+ {addon.name}</span>
                                                            <span>{formatCurrency(addon.price)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}

                                <div className="border-t border-dashed my-2"></div>

                                <div className="space-y-1 text-sm">
                                    {(order.packagingCharge > 0) && (
                                        <div className="flex justify-between text-muted-foreground">
                                            <span>Packaging Charge</span>
                                            <span>{formatCurrency(order.packagingCharge)}</span>
                                        </div>
                                    )}

                                    {(order.deliveryCharge > 0) && (
                                        <div className="flex justify-between text-muted-foreground">
                                            <span>Delivery Charge</span>
                                            <span>{formatCurrency(order.deliveryCharge)}</span>
                                        </div>
                                    )}

                                    {((order.cgst > 0) || (order.sgst > 0)) && (
                                        <div className="flex justify-between text-muted-foreground">
                                            <span>Taxes (GST)</span>
                                            <span>{formatCurrency((order.cgst || 0) + (order.sgst || 0))}</span>
                                        </div>
                                    )}

                                    {(order.convenienceFee > 0) && (
                                        <div className="flex justify-between text-muted-foreground">
                                            <span>Platform Fee</span>
                                            <span>{formatCurrency(order.convenienceFee)}</span>
                                        </div>
                                    )}

                                    {(order.tipAmount > 0) && (
                                        <div className="flex justify-between text-muted-foreground">
                                            <span>Tip</span>
                                            <span>{formatCurrency(order.tipAmount)}</span>
                                        </div>
                                    )}

                                    {(order.discount > 0) && (
                                        <div className="flex justify-between text-green-600">
                                            <span>Discount</span>
                                            <span>- {formatCurrency(order.discount)}</span>
                                        </div>
                                    )}
                                </div>

                                <div className="flex justify-between font-bold text-lg pt-2 border-t border-dashed text-green-600">
                                    <span>Grand Total</span>
                                    <span>{formatCurrency(order.grandTotal || order.totalAmount)}</span>
                                </div>
                            </div>
                        </motion.div>
                        <StatusTimeline currentStatus={order.status} />
                    </footer>
                )}
            </main>
        </div>
    );
}

export default function PreOrderTrackingPage() {
    return (
        <Suspense fallback={<div className="fixed inset-0 bg-background flex items-center justify-center"><GoldenCoinSpinner /></div>}>
            <PreOrderTrackingContent />
        </Suspense>
    )
}
