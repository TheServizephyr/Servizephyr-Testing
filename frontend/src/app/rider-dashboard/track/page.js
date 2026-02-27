
'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, ArrowLeft, RefreshCw, Loader2, Navigation, Phone, CheckCircle, IndianRupee } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useUser } from '@/firebase';
import InfoDialog from '@/components/InfoDialog';
import { usePolling } from '@/lib/usePolling';

const LiveTrackingMap = dynamic(() => import('@/components/LiveTrackingMap'), {
    ssr: false,
    loading: () => <div className="w-full h-full bg-muted flex items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>
});

const OrderDeliveryCard = ({ order, onMarkDelivered, isMarking }) => (
    <Card className="shadow-lg">
        <CardContent className="p-4">
            <div className="flex justify-between items-start">
                <div>
                    <p className="text-xs text-muted-foreground">Order ID: #{order.id.substring(0, 8)}</p>
                    <h3 className="font-bold text-lg text-foreground">{order.customerName}</h3>
                    <p className="text-sm text-muted-foreground flex items-center gap-2 mt-1"><MapPin size={14} /> {order.customerAddress}</p>
                </div>
                <div className="text-right">
                    <p className="font-bold text-lg text-primary">₹{order.totalAmount.toFixed(2)}</p>
                    {order.paymentDetails.method === 'cod' && (
                        <p className="text-xs font-semibold text-yellow-500 bg-yellow-500/10 px-2 py-1 rounded-full">Collect Cash</p>
                    )}
                </div>
            </div>
            <div className="mt-4 pt-4 border-t border-dashed flex justify-between items-center gap-4">
                <Button asChild variant="outline" size="sm" className="flex-1">
                    <a href={`tel:${order.customerPhone}`}><Phone className="mr-2 h-4 w-4" /> Call Customer</a>
                </Button>
                <Button onClick={() => onMarkDelivered(order.id)} disabled={isMarking} className="flex-1 bg-primary hover:bg-primary/90">
                    {isMarking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                    Mark as Delivered
                </Button>
            </div>
        </CardContent>
    </Card>
);

export default function RiderTrackPage() {
    const { user, isUserLoading } = useUser();
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeOrders, setActiveOrders] = useState([]);
    const [riderData, setRiderData] = useState(null);
    const [markingOrderId, setMarkingOrderId] = useState(null);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    // START: Ref for manual recentering
    const mapRef = useRef(null);

    const handleApiCall = useCallback(async (endpoint, method = 'GET', body) => {
        if (!user) throw new Error('Authentication Error');
        const idToken = await user.getIdToken();
        const response = await fetch(endpoint, {
            method,
            headers: {
                'Authorization': `Bearer ${idToken}`,
                ...(method !== 'GET' && { 'Content-Type': 'application/json' })
            },
            body: body ? JSON.stringify(body) : undefined
        });
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.message || 'An API error occurred.');
        }
        return await response.json();
    }, [user]);

    const fetchData = useCallback(async (isBackground = false) => {
        if (!isBackground) setLoading(true);
        try {
            const data = await handleApiCall('/api/rider/dashboard', 'GET');
            setActiveOrders(data.activeOrders || []);
            setRiderData(data.driver || null);
        } catch (err) {
            setError(err.message);
        } finally {
            if (!isBackground) setLoading(false);
        }
    }, [handleApiCall]);

    useEffect(() => {
        if (isUserLoading) return;
        if (!user) {
            router.push('/rider-auth');
        } else {
            fetchData();
        }
    }, [user, isUserLoading, router, fetchData]);

    // Use adaptive polling for location tracking
    usePolling(() => fetchData(true), {
        interval: 60000,
        enabled: !!user && !isUserLoading,
        deps: [user]
    });

    const handleMarkDelivered = async (orderId) => {
        setMarkingOrderId(orderId);
        try {
            await handleApiCall('/api/rider/update-order-status', 'PATCH', {
                orderId: orderId,
                newStatus: 'delivered'
            });
            // Optimistically remove from list
            setActiveOrders(prev => prev.filter(o => o.id !== orderId));
            if (activeOrders.length === 1) { // If it was the last order
                setInfoDialog({ isOpen: true, title: "All Deliveries Complete!", message: "Great job! You have no more active orders." });
                router.push('/rider-dashboard');
            }
        } catch (err) {
            setInfoDialog({ isOpen: true, title: "Update Failed", message: `Could not mark order as delivered: ${err.message}` });
        } finally {
            setMarkingOrderId(null);
        }
    };

    const mapLocations = useMemo(() => {
        const toLatLngLiteral = (loc) => {
            if (!loc) return null;
            const lat = loc.lat ?? loc._latitude;
            const lng = loc.lng ?? loc._longitude;
            return (typeof lat === 'number' && typeof lng === 'number') ? { lat, lng } : null;
        };

        if (!activeOrders || activeOrders.length === 0) {
            return { restaurant: null, customers: [], rider: toLatLngLiteral(riderData?.currentLocation) };
        }

        const restaurant = toLatLngLiteral(activeOrders[0].restaurantLocation);

        const customers = activeOrders
            .map(order => ({
                id: order.id,
                name: order.customerName,
                ...toLatLngLiteral(order.customerLocation)
            }))
            .filter(loc => loc.lat && loc.lng);

        const rider = toLatLngLiteral(riderData?.currentLocation);

        return { restaurant, customers, rider };
    }, [activeOrders, riderData]);

    // START: Manual recenter function
    const handleRecenter = () => {
        if (mapRef.current) {
            const bounds = new window.google.maps.LatLngBounds();
            if (mapLocations.restaurant) bounds.extend(mapLocations.restaurant);
            if (mapLocations.rider) bounds.extend(mapLocations.rider);
            mapLocations.customers.forEach(loc => bounds.extend(loc));

            if (!bounds.isEmpty()) {
                mapRef.current.fitBounds(bounds, 80); // 80px padding
            }
        }
    };


    if (loading && activeOrders.length === 0) {
        return <div className="h-screen w-screen flex items-center justify-center"><Loader2 className="animate-spin text-primary h-16 w-16" /></div>;
    }

    if (error) {
        return <div className="h-screen w-screen flex items-center justify-center text-red-500">{error}</div>;
    }

    return (
        <>
            <InfoDialog isOpen={infoDialog.isOpen} onClose={() => setInfoDialog({ isOpen: false })} title={infoDialog.title} message={infoDialog.message} />
            <div className="min-h-screen bg-background text-foreground flex flex-col">
                <header className="p-4 border-b border-border flex justify-between items-center">
                    <Button variant="ghost" size="icon" onClick={() => router.push('/rider-dashboard')}><ArrowLeft /></Button>
                    <h1 className="font-bold text-lg">Active Deliveries ({activeOrders.length})</h1>
                    <Button onClick={() => fetchData()} variant="outline" size="icon" disabled={loading}>
                        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                    </Button>
                </header>

                <main className="flex-grow flex flex-col md:flex-row">
                    <div className="w-full md:w-1/2 lg:w-2/3 h-64 md:h-auto relative">
                        <LiveTrackingMap
                            restaurantLocation={mapLocations.restaurant}
                            customerLocations={mapLocations.customers}
                            riderLocation={mapLocations.rider}
                            mapRef={mapRef}
                        />
                        <Button
                            onClick={handleRecenter}
                            variant="secondary"
                            size="icon"
                            className="absolute top-4 right-4 z-10 h-12 w-12 rounded-full shadow-lg"
                            aria-label="Recenter map"
                        >
                            <Navigation />
                        </Button>
                    </div>
                    <div className="w-full md:w-1/2 lg:w-1/3 flex-shrink-0 p-4 space-y-4 overflow-y-auto h-[calc(100vh-200px)] md:h-auto">
                        {activeOrders.length > 0 ? activeOrders.map(order => (
                            <OrderDeliveryCard
                                key={order.id}
                                order={order}
                                onMarkDelivered={handleMarkDelivered}
                                isMarking={markingOrderId === order.id}
                            />
                        )) : (
                            <div className="flex flex-col items-center justify-center text-center text-muted-foreground h-full">
                                <CheckCircle size={48} className="text-green-500 mb-4" />
                                <h2 className="text-xl font-bold">All Deliveries Complete!</h2>
                                <p>You have no active orders. Your status has been set to &quot;Online&quot;.</p>
                            </div>
                        )}
                    </div>
                </main>
            </div>
        </>
    );
}
