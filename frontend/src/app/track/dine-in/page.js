
'use client';

import React, { useState, useEffect, Suspense, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Check, CookingPot, Home, Star, RefreshCw, Loader2, ArrowLeft, XCircle, Wallet, Split, ConciergeBell, ShoppingBag, Bike } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter, useSearchParams } from 'next/navigation';
import { getPollingStartTime, clearPollingTimer, POLLING_MAX_TIME } from '@/lib/trackingConstants';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';

const statusConfig = {
    pending: { title: 'Order Placed', icon: <Check size={24} />, step: 0, description: "Your order has been sent to the restaurant." },
    confirmed: { title: 'Order Confirmed', icon: <Check size={24} />, step: 1, description: "The restaurant has confirmed your order and will start preparing it soon." },
    preparing: { title: 'Preparing Your Order', icon: <CookingPot size={24} />, step: 2, description: "The kitchen is currently preparing your delicious food." },
    ready_for_pickup: { title: 'Ready', icon: <ShoppingBag size={24} />, step: 3, description: "Your order is ready at the counter." },
    delivered: { title: 'Served', icon: <Home size={24} />, step: 4, description: "Enjoy your meal!" },
    rejected: { title: 'Order Rejected', icon: <XCircle size={24} />, step: 4, isError: true, description: "We're sorry, the restaurant could not accept your order." },
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
    const searchParams = useSearchParams();
    // In a real app, you'd get the order ID from the URL, e.g., using useParams()
    const orderId = "DINE_IN_123";
    const sessionToken = searchParams.get('token');

    const [orderData, setOrderData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isVisible, setIsVisible] = useState(true); // RULE 1

    const fetchData = useCallback(async () => {
        // Mocking API call
        setTimeout(() => {
            const statuses = ['pending', 'confirmed', 'preparing', 'ready_for_pickup', 'delivered'];
            const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];
            setOrderData({
                order: { status: randomStatus, deliveryType: 'dine-in' },
                restaurant: { name: 'The Food Palace' },
            });
            setLoading(false);
        }, 1000);
    }, []);

    // RULE 1: Visibility API
    useEffect(() => {
        const handleVisibilityChange = () => {
            const visible = !document.hidden;
            setIsVisible(visible);
            if (visible) {
                console.log('[DineInList] Visible - resuming');
                fetchData();
            } else {
                console.log('[DineInList] Hidden - pausing');
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [fetchData]);

    // Initial fetch
    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // RULE 3, 4: Polling with timeout (no final state for list)
    useEffect(() => {
        if (!isVisible) return;

        const pollingStartTime = getPollingStartTime('dine-in-list');
        const pollingInterval = 15000; // 15s for list page

        const interval = setInterval(() => {
            if (document.hidden) return;
            if (Date.now() - pollingStartTime > POLLING_MAX_TIME) {
                console.warn('[DineInList] 60min exceeded');
                clearInterval(interval);
                clearPollingTimer('dine-in-list');
                return;
            }
            fetchData();
        }, pollingInterval);

        return () => clearInterval(interval);
    }, [fetchData, isVisible]);

    const handleConfirmPayment = () => {
        const params = new URLSearchParams();
        if (orderData.restaurant?.id) params.set('restaurantId', orderData.restaurant.id);
        if (orderData.order?.tableId) params.set('table', orderData.order.tableId);
        if (orderData.order?.dineInTabId) params.set('tabId', orderData.order.dineInTabId);
        if (sessionToken) params.set('session_token', sessionToken);
        router.push(`/checkout?${params.toString()}`);
    }


    if (loading && !orderData) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4">
                <GoldenCoinSpinner />
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4">
                <h1 className="text-2xl font-bold text-destructive">Error Loading Order</h1>
                <p className="text-muted-foreground mt-2">{error}</p>
                <Button onClick={() => router.back()} className="mt-6"><ArrowLeft className="mr-2 h-4 w-4" /> Go Back</Button>
            </div>
        )
    }

    if (!orderData || !orderData.order) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4">
                <h1 className="text-2xl font-bold">Order Not Found</h1>
                <Button onClick={() => router.back()} className="mt-6"><ArrowLeft className="mr-2 h-4 w-4" /> Go Back</Button>
            </div>
        )
    }

    const currentStatusInfo = statusConfig[orderData.order.status] || statusConfig.pending;

    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col">
            <header className="p-4 border-b border-border flex justify-between items-center">
                <div>
                    <p className="text-xs text-muted-foreground">Tracking Dine-In Order</p>
                    <h1 className="font-bold text-lg">{orderData.restaurant?.name}</h1>
                </div>
                <Button onClick={() => fetchData()} variant="outline" size="icon" disabled={loading}>
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
            </header>

            <main className="flex-grow flex flex-col items-center p-4 md:p-8">
                <div className="w-full max-w-2xl mx-auto">
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                        <div className="p-4 bg-card border-b border-border text-center">
                            <h2 className="text-lg font-semibold text-muted-foreground">Order ID</h2>
                            <p className="text-2xl font-mono tracking-widest text-foreground">{orderId}</p>
                        </div>
                        <div className="p-6 bg-card">
                            <StatusTimeline currentStatus={orderData.order.status} />
                        </div>
                    </motion.div>

                    <motion.div
                        key={orderData.order.status}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.3 }}
                        className="mt-8 text-center bg-card p-6 rounded-lg border border-border"
                    >
                        <h3 className="text-2xl font-bold">{currentStatusInfo.title}</h3>
                        <p className="mt-2 text-muted-foreground">{currentStatusInfo.description}</p>
                    </motion.div>
                </div>

                <div className="w-full max-w-2xl mx-auto mt-8 flex-grow">
                    <div className="bg-card border border-border rounded-lg p-6 text-center">
                        <h3 className="font-bold text-lg">Fun Fact while you wait</h3>
                        <p className="text-muted-foreground mt-2 italic">&quot;The world&apos;s most expensive pizza costs $12,000 and takes 72 hours to make.&quot;</p>
                    </div>
                </div>
            </main>

            <footer className="sticky bottom-0 left-0 w-full bg-background/80 backdrop-blur-lg border-t border-border z-10">
                <div className="container mx-auto p-4 flex justify-center">
                    <Button onClick={handleConfirmPayment} className="w-full max-w-md h-14 text-lg bg-primary hover:bg-primary/90 text-primary-foreground">
                        <Wallet className="mr-3 h-6 w-6" /> View Bill & Pay
                    </Button>
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
