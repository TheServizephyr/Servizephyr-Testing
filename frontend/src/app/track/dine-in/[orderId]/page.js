
'use client';

import React, { useState, useEffect, Suspense, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, CookingPot, HandCoins, QrCode, Home, Loader2, RefreshCw, ArrowLeft, XCircle, Wallet, Split, ShoppingBag, PlusCircle, IndianRupee, Sparkles, CheckCircle, Plus, History, Clock, UtensilsCrossed, Info, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { isFinalState, getPollingInterval, getPollingStartTime, clearPollingTimer, POLLING_MAX_TIME } from '@/lib/trackingConstants';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { getDineInDetails } from '@/lib/dineInStorage';
import { rtdb } from '@/lib/firebase'; // ✅ RTDB for real-time tracking
import { ref, onValue, off } from 'firebase/database'; // ✅ RTDB listeners
import Script from 'next/script';

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const statusConfig = {
    pending: { title: 'Order Placed', icon: <Check size={24} />, step: 0, description: "Your order has been sent to the restaurant." },
    confirmed: { title: 'Order Confirmed', icon: <Check size={24} />, step: 1, description: "The restaurant has confirmed your order and will start preparing it soon." },
    preparing: { title: 'Preparing Your Order', icon: <CookingPot size={24} />, step: 2, description: "The kitchen is currently preparing your delicious food." },
    ready_for_pickup: { title: 'Ready', icon: <ShoppingBag size={24} />, step: 3, description: "Your order is ready to be served." },
    delivered: { title: 'Served', icon: <Home size={24} />, step: 4, description: "Enjoy your meal!" },
    rejected: { title: 'Order Rejected', icon: <XCircle size={24} />, step: 4, isError: true, description: "We're sorry, the restaurant could not accept your order." },
    cancelled: { title: 'Order Cancelled', icon: <XCircle size={24} />, step: 4, isError: true, description: "This order was cancelled." },
};


const StatusTimeline = ({ currentStatus }) => {
    const activeStatus = (currentStatus === 'paid') ? 'pending' : currentStatus;
    const currentStepConfig = statusConfig[activeStatus] || { step: 0, isError: false };
    const currentStep = currentStepConfig.step;
    const isError = currentStepConfig.isError;

    const uniqueSteps = Object.values(statusConfig)
        .filter((value, index, self) =>
            !value.isError && self.findIndex(v => v.step === value.step && !v.title.includes("Delivery")) === index
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
                                {isError ? statusConfig[currentStatus].title : title}
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


function DineInTrackingContent() {
    const router = useRouter();
    const { orderId } = useParams();
    const searchParams = useSearchParams();
    const sessionToken = searchParams.get('token');
    const paymentHash = searchParams.get('paid'); // Check for 'counter' param

    const [orderData, setOrderData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isVisible, setIsVisible] = useState(true); // RULE 1
    const [isPaymentChoiceModalOpen, setIsPaymentChoiceModalOpen] = useState(false);
    const [isConfirmPayOpen, setIsConfirmPayOpen] = useState(false);
    const [isProcessingPayment, setIsProcessingPayment] = useState(false);
    const [paymentSettings, setPaymentSettings] = useState(null);
    const [isMarkingDone, setIsMarkingDone] = useState(false);
    const [cancellingId, setCancellingId] = useState(null);

    // Check if ALL orders are cancelled
    const allOrdersCancelled = useMemo(() => {
        if (!orderData?.order?.batches || orderData.order.batches.length === 0) {
            // Single order case - check if current order is cancelled/rejected
            return ['cancelled', 'rejected'].includes(orderData?.order?.status);
        }
        // Multi-order case - ALL batches must be cancelled/rejected
        return orderData.order.batches.every(batch =>
            ['cancelled', 'rejected'].includes(batch.status)
        );
    }, [orderData]);

    // ✅ Check if ALL orders are PAID (celebration condition!)
    const allOrdersPaid = useMemo(() => {
        if (!orderData?.order) return false;

        const paymentStatus = orderData.order.paymentStatus;

        // Check if payment is marked as 'paid'
        return paymentStatus === 'paid';
    }, [orderData]);

    const fetchData = useCallback(async (isBackground = false) => {
        if (!isBackground) setLoading(true);
        if (!orderId) {
            setError("Order ID is missing.");
            setLoading(false);
            return;
        }

        try {
            // Cache-busting: Add timestamp to prevent stale data
            const cacheBuster = `?t=${Date.now()}`;
            // FIXED: Pass token to API for auth check
            const queryParams = new URLSearchParams();
            if (sessionToken) queryParams.set('token', sessionToken);
            const tokenParam = sessionToken ? `&${queryParams.toString()}` : '';

            const res = await fetch(`/api/order/status/${orderId}${cacheBuster}${tokenParam}`, {
                cache: 'no-store' // Disable Next.js caching
            });
            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || 'Failed to fetch order status.');
            }
            const data = await res.json();
            console.log('[DineIn Track] Order data received:', data);
            console.log('[DineIn Track] Status:', data.order?.status);
            setOrderData(data);
        } catch (err) {
            setError(err.message);
        } finally {
            if (!isBackground) setLoading(false);
        }
    }, [orderId, sessionToken]);

    // RULE 1: Visibility API
    useEffect(() => {
        const handleVisibilityChange = () => {
            const visible = !document.hidden;
            setIsVisible(visible);
            if (visible) {
                console.log('[DineInTrack] Visible - resuming');
                fetchData(true);
            } else {
                console.log('[DineInTrack] Hidden - pausing');
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [fetchData]);

    const getDineInContext = useCallback(() => {
        const restaurantId = orderData?.restaurant?.id || null;
        const tableId = orderData?.order?.tableId || orderData?.order?.table || null;
        const tabId = orderData?.order?.dineInTabId || orderData?.order?.tabId || searchParams.get('tabId') || null;
        const trackingToken = sessionToken || orderData?.order?.trackingToken || null;

        return { restaurantId, tableId, tabId, trackingToken };
    }, [orderData, searchParams, sessionToken]);

    // ✅ BROWSER BACK BUTTON INTERCEPTION
    // Intercept hardware/browser back to go to order page (not cart/checkout)
    useEffect(() => {
        const handlePopState = (event) => {
            event.preventDefault();
            const { restaurantId, tableId, tabId, trackingToken } = getDineInContext();

            if (restaurantId) {
                const params = new URLSearchParams();
                if (tableId) params.set('table', tableId);
                if (tabId) params.set('tabId', tabId);
                if (trackingToken) params.set('token', trackingToken);

                const url = `/order/${restaurantId}${params.toString() ? '?' + params.toString() : ''}`;
                console.log('[DineInTrack] Browser back intercepted → redirecting to:', url);
                router.replace(url);
            }
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [getDineInContext, router]);

    // Initial fetch
    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Fetch Payment Settings
    useEffect(() => {
        if (orderData?.restaurant?.id) {
            fetch(`/api/owner/settings?restaurantId=${orderData.restaurant.id}`)
                .then(res => res.json())
                .then(data => {
                    setPaymentSettings({
                        dineInPayAtCounterEnabled: data.dineInPayAtCounterEnabled !== false, // default true
                        dineInOnlinePaymentEnabled: data.dineInOnlinePaymentEnabled === true, // default false
                        razorpayKeyId: data.razorpayKeyId || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID
                    });
                })
                .catch(err => console.error(err));
        }
    }, [orderData?.restaurant?.id]);

    // ✅ RTDB LISTENER: Real-time dine-in status updates (NO POLLING!)
    useEffect(() => {
        if (!orderId || !orderData) return;

        const currentStatus = orderData?.order?.status;

        // Don't listen if already in final state
        if (currentStatus && isFinalState(currentStatus)) {
            console.log(`[DineInTrack] Final state (${currentStatus}) - no listener needed`);
            return;
        }

        console.log('[RTDB] Attaching dine-in status listener for', orderId);
        const statusRef = ref(rtdb, `dine_in_tracking/${orderId}`);

        const unsubscribe = onValue(statusRef, (snapshot) => {
            const rtdbData = snapshot.val();
            if (rtdbData && rtdbData.status) {
                console.log('[RTDB] Dine-in status updated:', rtdbData.status);

                // Update only status, keep rest of order data from Firestore
                setOrderData(prev => ({
                    ...prev,
                    order: {
                        ...prev.order,
                        status: rtdbData.status
                    }
                }));
            }
        }, (error) => {
            console.error('[RTDB] Dine-in listener error:', error);
        });

        return () => {
            console.log('[RTDB] Cleaning up dine-in status listener');
            off(statusRef, 'value', unsubscribe);
        };
    }, [orderData?.order?.status, orderId, fetchData, isVisible]); // Fixed dependency

    // Calculate bill details - AGGREGATE ALL ORDERS IN SAME TAB
    const billDetails = useMemo(() => {
        if (!orderData?.order) return null;
        const order = orderData.order;

        // For dine-in, we need to fetch ALL orders with same dineInTabId
        // But for now, show current order's items
        // TODO: Fetch all orders with same dineInTabId from API

        return {
            items: order.items || [],
            subtotal: order.subtotal || order.totalAmount || 0,
            cgst: order.cgst || 0,
            sgst: order.sgst || 0,
            discount: order.coupon?.discount || 0,
            grandTotal: order.totalAmount || 0,
        };
    }, [orderData]);

    const handleAddMoreItems = () => {
        console.log('[DineIn Track] Add More Items - orderData:', orderData);
        console.log('[DineIn Track] tableId:', orderData.order?.tableId || orderData.order?.table);
        console.log('[DineIn Track] dineInTabId:', orderData.order?.dineInTabId || orderData.order?.tabId);

        const { restaurantId, tableId, tabId, trackingToken } = getDineInContext();
        const isCarOrder = orderData?.order?.deliveryType === 'car-order' || orderData?.order?.isCarOrder === true;

        if (!restaurantId) {
            console.warn('[DineIn Track] Add More blocked: missing restaurantId');
            return;
        }

        const params = new URLSearchParams();
        if (!isCarOrder && tableId) params.set('table', tableId);
        if (tabId) params.set('tabId', tabId);
        if (trackingToken) params.set('token', trackingToken);
        params.set('activeOrderId', orderId);

        if (isCarOrder) {
            params.set('orderType', 'car');
            params.set('deliveryType', 'car-order');
            if (orderData?.order?.carSpot) params.set('spot', orderData.order.carSpot);

            // Persist car context for order page header/edit card restoration.
            try {
                const cartKey = `cart_${restaurantId}`;
                const existingCart = JSON.parse(localStorage.getItem(cartKey) || '{}');
                const mergedCart = {
                    ...existingCart,
                    deliveryType: 'car-order',
                    carSpot: orderData?.order?.carSpot || existingCart?.carSpot || null,
                    carDetails: orderData?.order?.carDetails || existingCart?.carDetails || '',
                    phone: orderData?.order?.customerPhone || existingCart?.phone || '',
                    dineInTabId: tabId || existingCart?.dineInTabId || null,
                    dineInToken: orderData?.order?.dineInToken || existingCart?.dineInToken || null
                };
                localStorage.setItem(cartKey, JSON.stringify(mergedCart));
                if (mergedCart.phone) {
                    localStorage.setItem('customerPhone', mergedCart.phone);
                }
            } catch (err) {
                console.warn('[DineIn Track] Failed to persist car context before Add More:', err?.message || err);
            }
        }

        const url = `/order/${restaurantId}?${params.toString()}`;
        console.log('[DineIn Track] Navigating to:', url);
        router.push(url);
    };

    const handleRequestBillClick = () => {
        if (!paymentSettings) return;

        if (paymentSettings.dineInPayAtCounterEnabled && paymentSettings.dineInOnlinePaymentEnabled) {
            // Both options enabled, show choice modal
            setIsPaymentChoiceModalOpen(true);
        } else if (paymentSettings.dineInOnlinePaymentEnabled) {
            // Only online enabled
            handlePayOnline();
        } else if (paymentSettings.dineInPayAtCounterEnabled) {
            // Only offline enabled
            handlePayAtCounter();
        } else {
            // Fallback: If both disabled (edge case), default to pay at counter
            handlePayAtCounter();
        }
    };

    const handlePayAtCounter = async () => {
        // Customer chose Pay at Counter - open confirmation modal
        setIsConfirmPayOpen(true);
    };

    const executePayAtCounter = async () => {
        setIsConfirmPayOpen(false);
        setIsMarkingDone(true);
        setIsPaymentChoiceModalOpen(false);
        try {
            const res = await fetch(`/api/order/update`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    orderId: orderId,
                    dineInTabId: orderData.order?.dineInTabId,
                    paymentStatus: 'pay_at_counter',
                    paymentMethod: 'counter',
                    trackingToken: sessionToken
                })
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || 'Failed to update payment status');
            }

            // Refresh data to show updated status
            fetchData(true);
        } catch (err) {
            console.error('Error updating payment status:', err);
            alert('Failed to update payment status. Please try again.');
        } finally {
            setIsMarkingDone(false);
        }
    };

    const handlePayOnline = async () => {
        if (isProcessingPayment) return;
        setIsProcessingPayment(true);
        setIsPaymentChoiceModalOpen(false);

        try {
            // 1. Create Razorpay order
            const res = await fetch('/api/payment/create-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    grandTotal: billDetails.grandTotal,
                    restaurantId: orderData.restaurant.id
                })
            });

            if (!res.ok) throw new Error("Failed to initialize payment");
            const data = await res.json();

            // 2. Open Razorpay modal
            const options = {
                key: paymentSettings?.razorpayKeyId,
                amount: data.amount,
                currency: data.currency,
                name: orderData.restaurant.name || "ServiZephyr",
                description: "Dine-In Bill Settlement",
                order_id: data.id,
                theme: { color: "#10b981" }, // matches primary
                handler: async function (response) {
                    console.log("Payment Success:", response);
                    // 3. Update orders to 'paid'
                    const updateRes = await fetch(`/api/order/update`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            orderId: orderId, // active order
                            dineInTabId: orderData.order?.dineInTabId || searchParams.get('tabId') || null,
                            paymentStatus: 'paid',
                            paymentMethod: 'online'
                        })
                    });

                    if (updateRes.ok) {
                        fetchData(true); // Re-fetch to show success screen
                    } else {
                        alert("Payment successful but failed to update status. Please show screen at counter.");
                    }
                },
                modal: {
                    ondismiss: function () {
                        setIsProcessingPayment(false);
                    }
                }
            };

            if (typeof window !== 'undefined' && window.Razorpay) {
                const rzp = new window.Razorpay(options);
                rzp.open();
            } else {
                throw new Error("Razorpay SDK not loaded.");
            }
        } catch (err) {
            console.error("Online payment error:", err);
            alert("Error starting online payment. Please try again or pay at counter.");
            setIsProcessingPayment(false);
        }
    };

    const handleSplitBill = () => {
        const { restaurantId, tableId, tabId } = getDineInContext();
        const params = new URLSearchParams();
        if (restaurantId) params.set('restaurantId', restaurantId);
        if (tableId) params.set('table', tableId);
        if (tabId) params.set('tabId', tabId);
        if (sessionToken) params.set('session_token', sessionToken);
        params.set('split', 'true');
        router.push(`/checkout?${params.toString()}`);
    };

    const clearLocalDineInSession = (restaurantId, tableId) => {
        if (!restaurantId) return;
        try {
            localStorage.removeItem(`liveOrder_${restaurantId}`);
            if (tableId) {
                localStorage.removeItem(`dineInTab_${restaurantId}_${tableId}`);
            }
        } catch (err) {
            console.warn('[DineIn Track] Failed to clear local session cache:', err?.message || err);
        }
    };

    const handleExitTable = async () => {
        setIsMarkingDone(true);
        try {
            const { restaurantId, tableId } = getDineInContext();

            // Just clear the customer's local session cache
            clearLocalDineInSession(restaurantId, tableId);
            setIsExitModalOpen(false);

            // After exiting, simply redirect to the restaurant menu page
            if (restaurantId) {
                router.replace(`/order/${restaurantId}`);
            } else {
                router.back();
            }
        } catch (err) {
            console.error('Error exiting table:', err);
        } finally {
            setIsMarkingDone(false);
        }
    };

    const handleBackToMenu = () => {
        const { restaurantId } = getDineInContext();
        if (!restaurantId) {
            router.back();
            return;
        }

        const params = new URLSearchParams();
        const isCarOrder = orderData?.order?.deliveryType === 'car-order' || orderData?.order?.isCarOrder === true;

        if (isCarOrder) {
            params.set('orderType', 'car');
            if (orderData?.order?.carSpot) params.set('spot', orderData.order.carSpot);
            if (sessionToken) params.set('token', sessionToken);
            const tabId = orderData?.order?.dineInTabId || orderData?.order?.tabId;
            if (tabId) params.set('tabId', tabId);
        } else {
            const { tableId, tabId, trackingToken } = getDineInContext();
            if (tableId) params.set('table', tableId);
            if (tabId) params.set('tabId', tabId);
            if (trackingToken) params.set('token', trackingToken);
        }

        router.replace(`/order/${restaurantId}${params.toString() ? `?${params.toString()}` : ''}`);
    };


    const [cancelModalOpen, setCancelModalOpen] = useState(false);
    const [batchToCancel, setBatchToCancel] = useState(null);
    const [isExitModalOpen, setIsExitModalOpen] = useState(false);

    const initiateCancel = (batchId) => {
        setBatchToCancel(batchId);
        setCancelModalOpen(true);
    };

    const handleCancelConfirmation = async () => {
        if (!batchToCancel) return;
        setCancellingId(batchToCancel);
        setCancelModalOpen(false); // Close modal immediately
        try {
            const res = await fetch('/api/order/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    orderId: batchToCancel,
                    cancelledBy: 'customer',
                    restaurantId: orderData.restaurant?.id,
                    dineInTabId: orderData.order?.dineInTabId
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to cancel');
            fetchData(true);
        } catch (err) {
            alert(err.message);
        } finally {
            setCancellingId(null);
            setBatchToCancel(null);
        }
    };

    if (loading && !orderData) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4 green-theme">
                <GoldenCoinSpinner />
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4 green-theme">
                <h1 className="text-2xl font-bold text-destructive">Error Loading Order</h1>
                <p className="text-muted-foreground mt-2">{error}</p>
                <Button onClick={() => router.back()} className="mt-6"><ArrowLeft className="mr-2 h-4 w-4" /> Go Back</Button>
            </div>
        )
    }

    if (!orderData || !orderData.order) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4 green-theme">
                <h1 className="text-2xl font-bold">Order Not Found</h1>
                <Button onClick={() => router.back()} className="mt-6"><ArrowLeft className="mr-2 h-4 w-4" /> Go Back</Button>
            </div>
        )
    }

    const isCarOrder = orderData?.order?.deliveryType === 'car-order' || orderData?.order?.isCarOrder === true;

    // ✅ FULL-SCREEN CANCELLATION VIEW - When ALL orders cancelled
    if (allOrdersCancelled) {
        const cancellationReason = orderData.order?.rejectionReason ||
            orderData.order?.batches?.find(b => b.rejectionReason)?.rejectionReason ||
            'This order was cancelled by the restaurant.';

        return (
            <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background p-6 text-center green-theme font-sans text-foreground">
                <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.5 }}
                    className="w-full max-w-md"
                >
                    <div className="bg-destructive/10 border-2 border-destructive rounded-full w-24 h-24 mx-auto flex items-center justify-center mb-6">
                        <XCircle className="w-16 h-16 text-destructive" />
                    </div>
                    <h1 className="text-3xl font-bold text-foreground mb-2">
                        {orderData.order?.batches?.length > 1 ? 'All Orders Cancelled' : 'Order Cancelled'}
                    </h1>
                    <p className="text-muted-foreground text-lg mb-6">
                        {cancellationReason}
                    </p>
                    <div className="flex flex-col gap-3">
                        <Button
                            onClick={handleBackToMenu}
                            className="w-full h-12 text-lg bg-primary hover:bg-primary/90"
                        >
                            <Home className="mr-2 h-5 w-5" />
                            Back to Menu
                        </Button>
                        {!isCarOrder && (
                            <Button
                                onClick={() => setIsExitModalOpen(true)}
                                variant="outline"
                                className="w-full h-12 text-lg bg-transparent border-2 border-foreground/20 hover:bg-foreground/10 text-foreground"
                                disabled={isMarkingDone}
                            >
                                {isMarkingDone ? 'Exiting...' : 'Exit Table'}
                            </Button>
                        )}
                    </div>
                </motion.div>
            </div>
        );
    }

    // ✅ FULL-SCREEN CELEBRATION VIEW - When ALL orders PAID!
    if (allOrdersPaid) {
        return (
            <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background p-6 text-center relative overflow-hidden green-theme font-sans text-foreground">
                {/* Balloons */}
                {Array.from({ length: 12 }).map((_, i) => (
                    <div
                        key={`balloon-${i}`}
                        className="balloon"
                        style={{
                            left: `${Math.random() * 100}%`,
                            animationDelay: `${Math.random() * 2}s`,
                            animationDuration: `${4 + Math.random() * 3}s`,
                            background: ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F'][Math.floor(Math.random() * 6)]
                        }}
                    />
                ))}

                {/* Confetti */}
                {Array.from({ length: 25 }).map((_, i) => (
                    <div
                        key={`confetti-${i}`}
                        className="confetti-celebration"
                        style={{
                            left: `${Math.random() * 100}%`,
                            animationDelay: `${Math.random() * 3}s`,
                            animationDuration: `${3 + Math.random() * 2}s`,
                            background: ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#FFD700'][Math.floor(Math.random() * 7)]
                        }}
                    />
                ))}

                <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.6 }}
                    className="w-full max-w-md relative z-10"
                >
                    <div className="bg-green-500/10 border-2 border-green-500 rounded-full w-24 h-24 mx-auto flex items-center justify-center mb-6">
                        <CheckCircle className="w-16 h-16 text-green-500" />
                    </div>
                    <h1 className="text-4xl font-bold text-foreground mb-2">
                        Payment Successful! 🎉
                    </h1>
                    <p className="text-muted-foreground text-lg mb-4">
                        Your bill has been paid successfully
                    </p>
                    <p className="text-2xl font-bold text-primary mb-6">
                        Thank you for dining with us!
                    </p>
                    <div className="flex flex-col gap-3">
                        <Button
                            onClick={handleBackToMenu}
                            className="w-full h-12 text-lg bg-primary hover:bg-primary/90"
                        >
                            <Home className="mr-2 h-5 w-5" />
                            Back to Menu
                        </Button>
                        {!isCarOrder && (
                            <Button
                                onClick={() => setIsExitModalOpen(true)}
                                variant="outline"
                                className="w-full h-12 text-lg bg-transparent border-2 border-foreground/20 hover:bg-foreground/10 text-foreground"
                                disabled={isMarkingDone}
                            >
                                {isMarkingDone ? 'Exiting...' : 'Exit Table'}
                            </Button>
                        )}
                    </div>

                    {/* Exit Confirmation Dialog */}
                    <Dialog open={isExitModalOpen} onOpenChange={setIsExitModalOpen}>
                        <DialogContent className="sm:max-w-md w-11/12 rounded-xl bg-card border-border">
                            <DialogHeader>
                                <DialogTitle className="text-xl">Exit Table?</DialogTitle>
                                <DialogDescription>
                                    Thank you for visiting {orderData?.restaurant?.name || 'our restaurant'}! Are you sure you are ready to give up your seat and exit the table?
                                </DialogDescription>
                            </DialogHeader>
                            <DialogFooter className="flex-row sm:justify-end gap-3 pt-4">
                                <Button
                                    variant="outline"
                                    onClick={() => setIsExitModalOpen(false)}
                                    className="flex-1 sm:flex-none"
                                    disabled={isMarkingDone}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    variant="default"
                                    onClick={handleExitTable}
                                    className="flex-1 sm:flex-none bg-primary hover:bg-primary/90"
                                    disabled={isMarkingDone}
                                >
                                    {isMarkingDone ? 'Exiting...' : 'Yes, Exit'}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    {/* Exit Confirmation Dialog */}
                    <Dialog open={isExitModalOpen} onOpenChange={setIsExitModalOpen}>
                        <DialogContent className="sm:max-w-md w-11/12 rounded-xl bg-card border-border">
                            <DialogHeader>
                                <DialogTitle className="text-xl">Exit Table?</DialogTitle>
                                <DialogDescription>
                                    Thank you for visiting {orderData?.restaurant?.name || 'our restaurant'}! Are you sure you are ready to give up your seat and exit the table?
                                </DialogDescription>
                            </DialogHeader>
                            <DialogFooter className="flex-row sm:justify-end gap-3 pt-4">
                                <Button
                                    variant="outline"
                                    onClick={() => setIsExitModalOpen(false)}
                                    className="flex-1 sm:flex-none"
                                    disabled={isMarkingDone}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    variant="default"
                                    onClick={handleExitTable}
                                    className="flex-1 sm:flex-none bg-primary hover:bg-primary/90"
                                    disabled={isMarkingDone}
                                >
                                    {isMarkingDone ? 'Exiting...' : 'Yes, Exit'}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </motion.div>
            </div>
        );
    }

    const currentStatusInfo = statusConfig[orderData.order.status] || statusConfig.pending;
    const isServed = orderData.order.status === 'delivered';

    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col green-theme font-sans pb-safe">
            {/* Payment Gateway Scripts */}
            <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />
            <Script src="https://mercury.phonepe.com/web/bundle/checkout.js" strategy="lazyOnload" />

            {/* Payment Choice Modal */}
            <Dialog open={isPaymentChoiceModalOpen} onOpenChange={setIsPaymentChoiceModalOpen}>
                <DialogContent className="sm:max-w-md w-11/12 rounded-xl bg-card border-border">
                    <DialogHeader>
                        <DialogTitle className="text-xl">How would you like to pay?</DialogTitle>
                        <DialogDescription>
                            Select a payment method to settle your bill.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col gap-3 py-4">
                        <Button
                            variant="outline"
                            className="h-20 flex items-center justify-start gap-4 px-6 border border-border hover:border-primary hover:bg-primary/5 transition-all shadow-sm"
                            onClick={handlePayOnline}
                        >
                            <div className="bg-primary/10 p-2.5 rounded-full text-primary">
                                <QrCode className="h-6 w-6" />
                            </div>
                            <div className="flex flex-col items-start text-left">
                                <span className="font-bold text-base text-foreground">Pay Online</span>
                                <span className="text-xs text-muted-foreground mt-0.5">UPI, Cards, Wallets directly</span>
                            </div>
                        </Button>
                        <Button
                            variant="outline"
                            className="h-20 flex items-center justify-start gap-4 px-6 border border-border hover:border-primary hover:bg-primary/5 transition-all shadow-sm"
                            onClick={handlePayAtCounter}
                            disabled={isMarkingDone}
                        >
                            <div className="bg-primary/10 p-2.5 rounded-full text-primary">
                                <HandCoins className="h-6 w-6" />
                            </div>
                            <div className="flex flex-col items-start text-left">
                                <span className="font-bold text-base text-foreground">Pay at Counter</span>
                                <span className="text-xs text-muted-foreground mt-0.5">Cash, UPI, or Card at the desk</span>
                            </div>
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Confirm Pay at Counter Modal */}
            <Dialog open={isConfirmPayOpen} onOpenChange={setIsConfirmPayOpen}>
                <DialogContent className="sm:max-w-md w-11/12 rounded-xl bg-card border-border">
                    <DialogHeader>
                        <DialogTitle className="text-xl">Are you ready to pay?</DialogTitle>
                        <DialogDescription>
                            We will notify the staff to prepare your bill at the counter.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex justify-end gap-3 py-4">
                        <Button
                            variant="outline"
                            onClick={() => setIsConfirmPayOpen(false)}
                            disabled={isMarkingDone}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={executePayAtCounter}
                            disabled={isMarkingDone}
                        >
                            {isMarkingDone ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Confirm'}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <header className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm p-4 border-b border-border flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <Button
                        onClick={() => {
                            // ✅ Preserve table & tab context for dine-in session
                            const { restaurantId, tableId, tabId, trackingToken } = getDineInContext();

                            if (restaurantId) {
                                const params = new URLSearchParams();
                                if (tableId) params.set('table', tableId);
                                if (tabId) params.set('tabId', tabId);
                                if (trackingToken) params.set('token', trackingToken);

                                const url = `/order/${restaurantId}${params.toString() ? '?' + params.toString() : ''}`;
                                console.log('[DineInTrack] Back navigation to:', url);
                                router.replace(url);
                            } else {
                                router.back(); // Fallback
                            }
                        }}
                        variant="ghost"
                        size="icon"
                    >
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div>
                        <p className="text-xs text-muted-foreground">Tracking Dine-In Order</p>
                        <h1 className="font-bold text-lg">{orderData.restaurant?.name}</h1>
                        {orderData.order?.customerOrderId && (
                            <p className="text-xs text-primary font-mono font-semibold mt-0.5">
                                Order ID: {orderData.order.customerOrderId}
                            </p>
                        )}
                    </div>
                </div>
                <Button onClick={() => fetchData(true)} variant="outline" size="icon" disabled={loading}>
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
            </header>

            <main className="flex-grow flex flex-col p-4 md:p-8 pb-40">
                <div className="w-full max-w-2xl mx-auto">
                    {/* NEW: Welcome Message for Returning Users */}
                    {(() => {
                        const restaurantId = orderData.restaurant?.id;
                        const tableId = orderData.order?.tableId;
                        if (restaurantId && tableId) {
                            const savedDetails = getDineInDetails(restaurantId, tableId);
                            if (savedDetails) {
                                return (
                                    <motion.div
                                        initial={{ opacity: 0, y: -10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="mb-4 bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 rounded-lg p-4 flex items-center gap-3"
                                    >
                                        <Users className="h-5 w-5 text-green-600 dark:text-green-400" />
                                        <div>
                                            <h3 className="font-semibold text-foreground">
                                                Welcome back, {savedDetails.tab_name}!
                                            </h3>
                                            <p className="text-sm text-muted-foreground">
                                                Party of {savedDetails.pax_count}
                                            </p>
                                        </div>
                                    </motion.div>
                                );
                            }
                        }
                        return null;
                    })()}

                    {/* Premium Info Card - Token + Summary */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-primary/90 to-primary/80 p-6 shadow-2xl"
                    >
                        {/* Decorative Background Pattern */}
                        <div className="absolute inset-0 opacity-10">
                            <div className="absolute top-0 right-0 w-64 h-64 bg-white rounded-full -mr-32 -mt-32" />
                            <div className="absolute bottom-0 left-0 w-48 h-48 bg-white rounded-full -ml-24 -mb-24" />
                        </div>

                        {/* Content */}
                        <div className="relative z-10">
                            {/* Top Row - Table & Orders Info */}
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    <div className="bg-white/20 backdrop-blur-sm rounded-xl p-2.5">
                                        <UtensilsCrossed className="h-6 w-6 text-white" />
                                    </div>
                                    <div>
                                        <p className="text-white/80 text-sm font-medium">
                                            {orderData.order?.deliveryType === 'car-order'
                                                ? `Slot ${orderData.order?.carSpot || 'N/A'}`
                                                : `Table ${orderData.order?.tableId || 'N/A'}`}
                                        </p>
                                        <p className="text-white text-lg font-bold">{orderData.order?.batches?.length || 0} Active Orders</p>
                                    </div>
                                </div>
                                <div className="text-right bg-white/10 backdrop-blur-sm rounded-xl px-4 py-2">
                                    <p className="text-white/80 text-xs font-medium">Pending Amount</p>
                                    <p className="text-white text-2xl font-bold">{formatCurrency(orderData.order?.batches?.reduce((sum, b) => sum + (b.totalAmount || 0), 0) || 0)}</p>
                                </div>
                            </div>

                            {/* Token Display - Centered & Prominent */}
                            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 text-center border border-white/20">
                                <p className="text-white/90 text-sm font-semibold mb-2 tracking-wider">YOUR TOKEN</p>
                                <motion.p
                                    initial={{ scale: 0.9 }}
                                    animate={{ scale: 1 }}
                                    className="text-white text-5xl md:text-6xl font-black tracking-wider drop-shadow-2xl"
                                    style={{ textShadow: '0 4px 20px rgba(0,0,0,0.3)' }}
                                >
                                    {orderData.order.dineInToken || "N/A"}
                                </motion.p>
                            </div>
                        </div>
                    </motion.div>

                    {/* Status Message */}
                    <motion.div
                        key={orderData.order.status}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.3 }}
                        className="mt-6 text-center bg-card p-4 rounded-lg border border-border"
                    >
                        <h3 className="text-xl font-bold">{currentStatusInfo.title}</h3>
                        <p className="mt-1 text-sm text-muted-foreground">{currentStatusInfo.description}</p>
                    </motion.div>

                    {/* Batches List */}
                    {orderData.order?.batches?.length > 0 && (
                        <div className="mt-8 space-y-4">
                            <h3 className="font-bold flex items-center gap-2 text-lg">
                                <History className="w-5 h-5 text-primary" /> Order History
                            </h3>
                            <div className="space-y-4">
                                {orderData.order.batches.map((batch, index) => {
                                    const batchStatus = statusConfig[batch.status] || statusConfig.pending;
                                    const isPending = batch.status === 'pending';
                                    const items = batch.items || [];
                                    const batchTotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

                                    return (
                                        <div key={batch.id} className="bg-card border-2 border-border rounded-xl shadow-md overflow-hidden hover:shadow-lg transition-shadow">
                                            {/* Timeline Header - Inside Card */}
                                            <div className="bg-gradient-to-r from-primary/5 to-primary/10 px-4 py-3 border-b border-border/50">
                                                <div className="scale-90 origin-center">
                                                    <StatusTimeline currentStatus={batch.status} />
                                                </div>
                                            </div>

                                            {/* Order Details */}
                                            <div className="p-4">
                                                <div className="flex justify-between items-start mb-3">
                                                    <div>
                                                        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
                                                            Order #{index + 1}
                                                        </p>
                                                        <div className="flex items-center gap-2">
                                                            {batchStatus.icon && React.cloneElement(batchStatus.icon, { size: 16, className: batchStatus.isError ? "text-destructive" : "text-primary" })}
                                                            <span className={`text-base font-bold ${batchStatus.isError ? "text-destructive" : "text-foreground"}`}>
                                                                {batchStatus.title}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-xl font-bold text-primary">{formatCurrency(batch.totalAmount || batchTotal)}</p>
                                                        <p className="text-xs text-muted-foreground flex items-center justify-end gap-1 mt-1">
                                                            <Clock size={12} />
                                                            {new Date(batch.createdAt?._seconds * 1000 || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="space-y-2 pt-3 border-t border-border/30">
                                                    {items.map((item, i) => {
                                                        // Calculate price - check Firestore fields (camelCase!)
                                                        const unitPrice = item.serverVerifiedTotal || item.totalPrice || item.portion?.price || item.price || 0;

                                                        // NEW: Calculate addon total to subtract from unit price for display
                                                        // Handle Addons (support both property names)
                                                        const addons = item.addons || item.selectedAddOns || [];

                                                        const addonTotal = addons.reduce((sum, addon) =>
                                                            sum + (addon.price * (addon.quantity || 1)), 0) || 0;

                                                        const basePrice = unitPrice - addonTotal;

                                                        return (
                                                            <div key={i} className="bg-muted/30 rounded-md px-3 py-2">
                                                                <div className="flex justify-between text-sm">
                                                                    <span className="font-medium">
                                                                        {item.quantity}x {item.name}
                                                                        {item.portion?.name ? ` (${item.portion.name})` : (item.variant ? ` (${item.variant})` : '')}
                                                                    </span>
                                                                    <span className="text-muted-foreground font-semibold">{formatCurrency(basePrice)}</span>
                                                                </div>
                                                                {/* ✅ Show Addons */}
                                                                {addons.length > 0 && (
                                                                    <div className="ml-4 mt-1 space-y-0.5">
                                                                        {addons.map((addon, addonIdx) => (
                                                                            <div key={addonIdx} className="flex justify-between text-xs text-muted-foreground">
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

                                                {/* Cancel Button - Always visible but disabled during preparing */}
                                                <div className="mt-4 pt-3 border-t border-border/50 space-y-2">
                                                    <div className="flex gap-2">
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => {
                                                                if (['pending', 'confirmed'].includes(batch.status)) {
                                                                    initiateCancel(batch.id);
                                                                } else {
                                                                    // Show info when disabled button is clicked
                                                                    const infoBox = document.getElementById(`cancel-info-${batch.id}`);
                                                                    if (infoBox) {
                                                                        infoBox.classList.remove('hidden');
                                                                        setTimeout(() => infoBox.classList.add('hidden'), 5000);
                                                                    }
                                                                }
                                                            }}
                                                            disabled={cancellingId === batch.id}
                                                            className={`flex-1 ${['pending', 'confirmed'].includes(batch.status)
                                                                ? 'text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30'
                                                                : 'text-muted-foreground border-muted opacity-60'
                                                                }`}
                                                        >
                                                            {cancellingId === batch.id ? (
                                                                <><RefreshCw className="h-4 w-4 animate-spin mr-2" /> Cancelling...</>
                                                            ) : (
                                                                <><XCircle className="h-4 w-4 mr-2" /> Cancel Order</>
                                                            )}
                                                        </Button>

                                                        {/* Info Icon - Shows on tap when cancel not available */}
                                                        {!['pending', 'confirmed'].includes(batch.status) && (
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={() => {
                                                                    const infoBox = document.getElementById(`cancel-info-${batch.id}`);
                                                                    if (infoBox) {
                                                                        infoBox.classList.toggle('hidden');
                                                                    }
                                                                }}
                                                                className="px-3 border-muted-foreground/30 text-muted-foreground hover:bg-muted"
                                                            >
                                                                <Info className="h-4 w-4" />
                                                            </Button>
                                                        )}
                                                    </div>

                                                    {/* Info message - Hidden by default, shows on tap */}
                                                    {!['pending', 'confirmed'].includes(batch.status) && (
                                                        <div
                                                            id={`cancel-info-${batch.id}`}
                                                            className="hidden flex items-start gap-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg p-3 text-xs text-amber-900 dark:text-amber-200 animate-in fade-in slide-in-from-top-2 duration-300"
                                                        >
                                                            <Info className="h-4 w-4 flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                                                            <p>
                                                                <strong className="font-semibold block mb-1">This order is currently being prepared 🍳</strong>
                                                                To avoid food wastage, cancellation is no longer available at this stage.
                                                                <span className="block mt-1.5">If you need any assistance, please reach out to the restaurant—they can help you directly.</span>
                                                            </p>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <Dialog open={cancelModalOpen} onOpenChange={setCancelModalOpen}>
                        <DialogContent className="bg-card border-border text-foreground max-w-sm">
                            <DialogHeader>
                                <DialogTitle>Cancel Order?</DialogTitle>
                                <DialogDescription>
                                    Are you sure you want to cancel this order? This action cannot be undone.
                                </DialogDescription>
                            </DialogHeader>
                            <DialogFooter className="flex gap-2 mt-4">
                                <Button variant="outline" onClick={() => setCancelModalOpen(false)}>
                                    No, Keep It
                                </Button>
                                <Button variant="destructive" onClick={handleCancelConfirmation}>
                                    Yes, Cancel Order
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    {/* Bill Details Section */}
                    {billDetails && (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.4 }}
                            className="mt-6 bg-card rounded-lg border border-border overflow-hidden"
                        >
                            <div className="p-4 border-b border-border bg-muted/30">
                                <h3 className="font-bold flex items-center gap-2">
                                    <Sparkles size={16} className="text-primary" /> Your Bill
                                </h3>
                            </div>
                            <div className="p-4 space-y-2">
                                {billDetails.items.map((item, i) => (
                                    <div key={i} className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">{item.quantity}x {item.name}</span>
                                        <span>{formatCurrency(item.totalPrice || item.price * item.quantity)}</span>
                                    </div>
                                ))}
                                <div className="border-t border-dashed border-border pt-2 mt-2 space-y-1">
                                    <div className="flex justify-between text-sm text-muted-foreground">
                                        <span>Subtotal</span>
                                        <span>{formatCurrency(billDetails.subtotal)}</span>
                                    </div>
                                    {billDetails.cgst > 0 && (
                                        <div className="flex justify-between text-sm text-muted-foreground">
                                            <span>CGST</span>
                                            <span>{formatCurrency(billDetails.cgst)}</span>
                                        </div>
                                    )}
                                    {billDetails.sgst > 0 && (
                                        <div className="flex justify-between text-sm text-muted-foreground">
                                            <span>SGST</span>
                                            <span>{formatCurrency(billDetails.sgst)}</span>
                                        </div>
                                    )}
                                    {billDetails.discount > 0 && (
                                        <div className="flex justify-between text-sm text-green-500">
                                            <span>Discount</span>
                                            <span>-{formatCurrency(billDetails.discount)}</span>
                                        </div>
                                    )}
                                </div>
                                <div className="flex justify-between font-bold text-lg pt-2 border-t border-border">
                                    <span>Total</span>
                                    <span className="text-primary">{formatCurrency(billDetails.grandTotal)}</span>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </div>
            </main>

            <footer className="fixed bottom-0 left-0 w-full bg-background/95 backdrop-blur-lg border-t border-border z-10">
                <div className="container mx-auto p-4 space-y-3">
                    <Button
                        onClick={handleAddMoreItems}
                        variant="outline"
                        className="w-full h-12 border-primary text-primary hover:bg-primary/10"
                    >
                        <Plus className="mr-2 h-5 w-5" /> {isServed ? 'Order Again' : 'Add More Items'}
                    </Button>

                    {/* Pay Bill Button OR Status Message */}
                    {/* Pay Bill Button OR Status Message */}
                    {!isCarOrder && (
                        <>
                            {orderData?.order?.paymentStatus === 'paid' ? (
                                <div className="w-full h-14 bg-green-100 text-green-800 border-green-200 border rounded flex items-center justify-center font-bold text-lg">
                                    ✅ Bill Paid
                                </div>
                            ) : (orderData?.order?.paymentStatus === 'pay_at_counter' || paymentHash === 'counter') ? (
                                <div className="w-full h-14 bg-orange-100 text-orange-800 border-orange-200 border rounded flex items-center justify-center font-bold text-lg animate-pulse">
                                    🏪 Please Pay at Counter
                                </div>
                            ) : isServed ? (
                                <Button
                                    onClick={handleRequestBillClick} // Modified to handle Choice Modal
                                    disabled={isProcessingPayment}
                                    className="w-full h-14 text-lg bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                                >
                                    {isProcessingPayment ? (
                                        <>
                                            <Loader2 className="mr-3 h-6 w-6 animate-spin" /> Processing Payment...
                                        </>
                                    ) : (
                                        <>
                                            <Wallet className="mr-3 h-6 w-6" />
                                            Pay Bill - {formatCurrency(billDetails?.grandTotal || 0)}
                                        </>
                                    )}
                                </Button>
                            ) : null}
                        </>
                    )}
                </div>
            </footer>
        </div>
    );
}

export default function DineInTrackingPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><GoldenCoinSpinner /></div>}>
            <DineInTrackingContent />
        </Suspense>
    )
}
