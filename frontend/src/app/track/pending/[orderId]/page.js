"use client";

import { useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle, Clock, Loader2 } from 'lucide-react';
import { isFinalState, getPollingStartTime, clearPollingTimer, POLLING_MAX_TIME } from '@/lib/trackingConstants';

export default function PaymentPendingPage({ params }) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const orderId = params.orderId;
    const token = searchParams.get('token');
    const [error, setError] = useState('');
    const [isVisible, setIsVisible] = useState(true);

    // Use ref to avoid useEffect dependency issues
    const pollingCountRef = useRef(0);
    const maxPolls = 60; // 60 × 10 seconds = 10 minutes max (was 20 × 3s = 60s)

    // RULE 1: Visibility API
    useEffect(() => {
        const handleVisibilityChange = () => {
            const visible = !document.hidden;
            setIsVisible(visible);

            if (visible) {
                console.log('[Pending] Page visible - resuming check');
            } else {
                console.log('[Pending] Page hidden - pausing check');
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);

    useEffect(() => {
        // Validate params - redirect if missing
        if (!orderId || !token) {
            console.error('[Pending] Missing orderId or token, redirecting to orders');
            router.replace('/customer-dashboard/orders');
            return;
        }

        // RULE 4: Get polling start time (localStorage-based, refresh-safe)
        const pollingStartTime = getPollingStartTime(orderId);
        let pollingInterval;

        const pollOrderStatus = async () => {
            // Don't poll if page is hidden (RULE 1)
            if (!isVisible || document.hidden) {
                console.log('[Pending] Skipping poll - page hidden');
                return;
            }

            // RULE 4: Check hard timeout (60 minutes)
            if (Date.now() - pollingStartTime > POLLING_MAX_TIME) {
                console.warn('[Pending] Max polling time (60min) exceeded');
                setError('Taking longer than expected. Please check "My Orders".');
                clearInterval(pollingInterval);
                clearPollingTimer(orderId);
                return;
            }

            try {
                pollingCountRef.current += 1;

                // Soft timeout check (legacy - keeping for compatibility)
                if (pollingCountRef.current > maxPolls) {
                    setError('Taking longer than expected. Check "My Orders" in a minute.');
                    clearInterval(pollingInterval);
                    clearPollingTimer(orderId);
                    return;
                }

                const res = await fetch(`/api/order/status/${orderId}?token=${token}`);

                if (!res.ok) {
                    console.error('[Pending] Order status fetch failed:', res.status);
                    return; // Continue polling, might be transient
                }

                const data = await res.json();

                // RULE 2: Check if order reached valid state
                if (data.order.status === 'pending' || data.order.status === 'confirmed' || isFinalState(data.order.status)) {
                    clearInterval(pollingInterval);
                    clearPollingTimer(orderId); // Clean up localStorage

                    // Clear payment pending flag from localStorage
                    localStorage.removeItem('payment_pending_order');

                    // Determine tracking path based on delivery type
                    const deliveryType = data.order.deliveryType;
                    const businessType = data.order.businessType;

                    let trackingPath = 'delivery';
                    if (deliveryType === 'dine-in') trackingPath = 'dine-in';
                    else if (businessType === 'street-vendor') trackingPath = 'pre-order';

                    console.log(`[Pending] Order confirmed, redirecting to /track/${trackingPath}/${orderId}`);
                    router.replace(`/track/${trackingPath}/${orderId}?token=${token}`);
                }

            } catch (err) {
                console.error('[Pending] Polling error:', err);
                // Don't stop polling on single error - might be network glitch
            }
        };

        // RULE 3: Adaptive interval - for payment pending, 10s is sufficient (was 3s!)
        // Payment confirmations usually happen in 5-30 seconds
        const PAYMENT_POLL_INTERVAL = 10000; // 10 seconds (70% reduction from 3s!)

        // Start polling immediately and every 10 seconds
        pollOrderStatus();
        pollingInterval = setInterval(pollOrderStatus, PAYMENT_POLL_INTERVAL);

        return () => {
            if (pollingInterval) {
                clearInterval(pollingInterval);
            }
        };
    }, [orderId, token, router, isVisible]); // Added isVisible dependency

    return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-card border border-border rounded-lg p-8 text-center space-y-6">
                {error ? (
                    <>
                        <Clock className="w-16 h-16 text-yellow-500 mx-auto" />
                        <h1 className="text-2xl font-bold">Still Processing...</h1>
                        <p className="text-muted-foreground">{error}</p>
                        <button
                            onClick={() => router.push('/customer-dashboard/orders')}
                            className="bg-primary text-primary-foreground px-6 py-2 rounded-lg hover:bg-primary/90 transition-colors"
                        >
                            View My Orders
                        </button>
                    </>
                ) : (
                    <>
                        <CheckCircle className="w-16 h-16 text-green-500 mx-auto animate-pulse" />
                        <h1 className="text-2xl font-bold">Payment Received!</h1>
                        <div className="space-y-2">
                            <div className="flex items-center justify-center gap-2 text-muted-foreground">
                                <Loader2 className="w-5 h-5 animate-spin" />
                                <span>Confirming your order with the kitchen...</span>
                            </div>
                        </div>
                        <div className="text-sm text-muted-foreground bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
                            <strong>Please do not refresh or close this page</strong>
                        </div>
                        <div className="text-xs text-muted-foreground">
                            This usually takes 5-10 seconds
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
