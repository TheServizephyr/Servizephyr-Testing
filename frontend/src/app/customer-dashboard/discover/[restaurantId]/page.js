'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
    ArrowLeft,
    Bike,
    Clock3,
    ConciergeBell,
    ExternalLink,
    Flame,
    Loader2,
    MapPin,
    Navigation,
    ShieldCheck,
    Soup,
    Sparkles,
    Star,
    Store,
    TrendingUp,
    X,
} from 'lucide-react';
import { APIProvider, Map, AdvancedMarker } from '@vis.gl/react-google-maps';
import { useUser } from '@/firebase';
import InfoDialog from '@/components/InfoDialog';
import { Button } from '@/components/ui/button';

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const FALLBACK_CENTER = { lat: 28.6139, lng: 77.2090 };

const MetricCard = ({ icon, label, value, subValue }) => (
    <div className="rounded-xl border border-border/80 bg-card/80 p-4 backdrop-blur-sm">
        <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider font-semibold">
            {icon}
            <span>{label}</span>
        </div>
        <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
        {subValue ? <p className="text-xs text-muted-foreground mt-1">{subValue}</p> : null}
    </div>
);

const ServiceBadge = ({ enabled, icon, label }) => (
    <div
        className={`px-3 py-2 rounded-lg border text-sm font-semibold flex items-center gap-2 ${enabled
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-border bg-muted/40 text-muted-foreground'
            }`}
    >
        {icon}
        <span>{label}</span>
    </div>
);

const RestaurantMapModal = ({ restaurant, onClose }) => {
    if (!restaurant) return null;

    const lat = Number(restaurant?.coordinates?.lat);
    const lng = Number(restaurant?.coordinates?.lng);
    const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lng);
    const mapCenter = hasCoordinates ? { lat, lng } : FALLBACK_CENTER;
    const googleMapsSearchUrl = hasCoordinates
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`
        : null;

    return (
        <div className="fixed inset-0 z-50 bg-black/80 p-4 flex items-center justify-center">
            <div className="w-full max-w-4xl rounded-xl overflow-hidden border border-border bg-background shadow-2xl">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
                    <div>
                        <h3 className="font-bold text-foreground">{restaurant?.name || 'Restaurant'}</h3>
                        <p className="text-sm text-muted-foreground line-clamp-1">{restaurant?.address || 'Address not available'}</p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={onClose}>
                        <X className="h-5 w-5" />
                    </Button>
                </div>
                <div className="h-[58vh] bg-muted">
                    {!GOOGLE_MAPS_API_KEY ? (
                        <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-5">
                            <p className="text-sm text-muted-foreground">Map key missing. Use external map to navigate.</p>
                            {googleMapsSearchUrl ? (
                                <Button asChild>
                                    <a href={googleMapsSearchUrl} target="_blank" rel="noopener noreferrer">
                                        Open in Google Maps <ExternalLink className="ml-2 h-4 w-4" />
                                    </a>
                                </Button>
                            ) : null}
                        </div>
                    ) : (
                        <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
                            <Map
                                mapId="discover_restaurant_details"
                                defaultCenter={mapCenter}
                                defaultZoom={15}
                                gestureHandling="greedy"
                                disableDefaultUI={true}
                                style={{ width: '100%', height: '100%' }}
                            >
                                {hasCoordinates ? (
                                    <AdvancedMarker position={mapCenter}>
                                        <div className="w-11 h-11 rounded-full bg-primary text-primary-foreground flex items-center justify-center border-2 border-background shadow-lg">
                                            <Soup className="h-4 w-4" />
                                        </div>
                                    </AdvancedMarker>
                                ) : null}
                            </Map>
                        </APIProvider>
                    )}
                </div>
            </div>
        </div>
    );
};

const RatingStars = ({ value = 0 }) => {
    const safeValue = Number.isFinite(Number(value)) ? Number(value) : 0;
    const whole = Math.round(safeValue);
    return (
        <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((item) => (
                <Star
                    key={item}
                    className={`h-4 w-4 ${item <= whole ? 'text-amber-400 fill-amber-400' : 'text-muted-foreground/40'}`}
                />
            ))}
        </div>
    );
};

export default function DiscoverRestaurantDetailsPage() {
    const router = useRouter();
    const params = useParams();
    const searchParams = useSearchParams();
    const { user } = useUser();

    const restaurantId = String(params?.restaurantId || '').trim();
    const distanceLabel = searchParams.get('distance') || null;

    const [details, setDetails] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [isOrdering, setIsOrdering] = useState(false);
    const [isMapOpen, setIsMapOpen] = useState(false);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    useEffect(() => {
        const fetchDetails = async () => {
            if (!restaurantId) {
                setError('Restaurant ID missing.');
                setLoading(false);
                return;
            }

            try {
                setLoading(true);
                const response = await fetch(`/api/public/restaurant-overview/${encodeURIComponent(restaurantId)}`, {
                    cache: 'no-store',
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.message || 'Could not load restaurant details.');
                setDetails(data);
            } catch (err) {
                setError(err.message || 'Failed to load restaurant details.');
            } finally {
                setLoading(false);
            }
        };

        fetchDetails();
    }, [restaurantId]);

    const restaurant = details?.restaurant || {};
    const insights = details?.insights || {};
    const topDishes = Array.isArray(insights?.topDishes) ? insights.topDishes : [];
    const topCategories = Array.isArray(insights?.topCategories) ? insights.topCategories : [];
    const metrics = insights?.metrics || {};

    const priceRangeText = useMemo(() => {
        const min = Number(metrics?.priceRange?.min);
        const max = Number(metrics?.priceRange?.max);
        if (Number.isFinite(min) && Number.isFinite(max)) {
            return `₹${Math.round(min)} - ₹${Math.round(max)}`;
        }
        if (Number.isFinite(min)) return `From ₹${Math.round(min)}`;
        return 'N/A';
    }, [metrics?.priceRange?.min, metrics?.priceRange?.max]);

    const handleOrderNow = async () => {
        if (!user) {
            setInfoDialog({ isOpen: true, title: 'Authentication Error', message: 'Please log in again to continue.' });
            return;
        }

        setIsOrdering(true);
        try {
            const idToken = await user.getIdToken();
            const response = await fetch('/api/auth/generate-session-token', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${idToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({}),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message || 'Failed to create secure session.');

            const { ref, phone, token } = data;
            const identityParam = ref
                ? `ref=${encodeURIComponent(ref)}`
                : (phone ? `phone=${encodeURIComponent(phone)}` : null);

            if (!identityParam || !token) {
                throw new Error('Session identity could not be generated.');
            }

            router.push(`/order/${restaurantId}?${identityParam}&token=${encodeURIComponent(token)}&source=discover&intent=order_now`);
        } catch (err) {
            setInfoDialog({ isOpen: true, title: 'Navigation Error', message: err.message || 'Failed to open order page.' });
            setIsOrdering(false);
        }
    };

    if (loading) {
        return (
            <div className="p-5 min-h-[70vh] flex flex-col items-center justify-center gap-3 text-muted-foreground">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <p>Preparing restaurant experience...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-5 min-h-[70vh] flex flex-col items-center justify-center text-center gap-3">
                <p className="text-destructive font-semibold">{error}</p>
                <Button variant="outline" onClick={() => router.push('/customer-dashboard/discover')}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to Discover
                </Button>
            </div>
        );
    }

    return (
        <>
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />

            {isMapOpen ? <RestaurantMapModal restaurant={restaurant} onClose={() => setIsMapOpen(false)} /> : null}

            {isOrdering ? (
                <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center">
                    <Loader2 className="h-11 w-11 text-white animate-spin" />
                </div>
            ) : null}

            <div className="p-4 md:p-6 pb-28 space-y-5">
                <div className="flex items-center justify-between gap-2">
                    <Button variant="ghost" onClick={() => router.push('/customer-dashboard/discover')}>
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back
                    </Button>
                    <Button variant="outline" onClick={() => setIsMapOpen(true)}>
                        <Navigation className="mr-2 h-4 w-4" />
                        View in Map
                    </Button>
                </div>

                <motion.section
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/15 via-background to-emerald-400/10 p-5 md:p-6"
                >
                    <div className="absolute -top-10 -right-10 h-36 w-36 rounded-full bg-primary/20 blur-3xl" />
                    <div className="absolute -bottom-8 -left-6 h-32 w-32 rounded-full bg-emerald-400/20 blur-3xl" />

                    <div className="relative flex flex-col gap-4">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${restaurant?.isOpen ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-red-500/20 text-red-300 border border-red-500/30'}`}>
                                {restaurant?.isOpen ? 'Open Now' : 'Currently Closed'}
                            </span>
                            {distanceLabel ? (
                                <span className="px-3 py-1 rounded-full text-xs font-semibold border border-primary/30 bg-primary/10 text-primary">
                                    {distanceLabel} away
                                </span>
                            ) : null}
                            <span className="px-3 py-1 rounded-full text-xs font-semibold border border-border bg-card/70 text-muted-foreground">
                                Powered by ServiZephyr Discovery
                            </span>
                        </div>

                        <div>
                            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-foreground">
                                {restaurant?.name || 'Restaurant'}
                            </h1>
                            <p className="mt-2 text-muted-foreground flex items-start gap-2">
                                <MapPin className="h-4 w-4 mt-1 flex-shrink-0" />
                                <span>{restaurant?.address || 'Address not available'}</span>
                            </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-4">
                            <div className="flex items-center gap-2">
                                <RatingStars value={restaurant?.rating?.value} />
                                <span className="text-sm font-semibold text-foreground">
                                    {Number(restaurant?.rating?.value || 0).toFixed(1)}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                    ({Math.max(0, Number(restaurant?.rating?.count || 0))} reviews)
                                </span>
                            </div>
                            <div className="text-xs text-muted-foreground">
                                Top dishes are based on recent order trends (roti excluded).
                            </div>
                        </div>
                    </div>
                </motion.section>

                <motion.section
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 }}
                    className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
                >
                    <MetricCard
                        icon={<TrendingUp className="h-4 w-4" />}
                        label="Fulfilment Rate"
                        value={`${Math.max(0, Number(metrics?.fulfilledRate || 0))}%`}
                        subValue={`${Math.max(0, Number(metrics?.ordersSampled || 0))} recent orders analysed`}
                    />
                    <MetricCard
                        icon={<Clock3 className="h-4 w-4" />}
                        label="Avg Prep Time"
                        value={metrics?.avgPrepMins ? `${metrics.avgPrepMins} min` : 'N/A'}
                        subValue="Based on recent kitchen timelines"
                    />
                    <MetricCard
                        icon={<Flame className="h-4 w-4" />}
                        label="Avg Dish Price"
                        value={metrics?.avgItemPrice ? `₹${Math.round(metrics.avgItemPrice)}` : 'N/A'}
                        subValue={priceRangeText}
                    />
                    <MetricCard
                        icon={<Sparkles className="h-4 w-4" />}
                        label="Menu Strength"
                        value={`${Math.max(0, Number(metrics?.menuItems || 0))} dishes`}
                        subValue={`${Math.max(0, Number(metrics?.vegItems || 0))} veg · ${Math.max(0, Number(metrics?.nonVegItems || 0))} non-veg`}
                    />
                </motion.section>

                <motion.section
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="rounded-2xl border border-border bg-card p-5"
                >
                    <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
                        <ShieldCheck className="h-5 w-5 text-primary" />
                        Service Options
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1">Choose the experience you want with this restaurant.</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                        <ServiceBadge enabled={restaurant?.services?.delivery} icon={<Bike className="h-4 w-4" />} label="Delivery" />
                        <ServiceBadge enabled={restaurant?.services?.pickup} icon={<Store className="h-4 w-4" />} label="Pickup" />
                        <ServiceBadge enabled={restaurant?.services?.dineIn} icon={<ConciergeBell className="h-4 w-4" />} label="Dine-In" />
                    </div>
                </motion.section>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <motion.section
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.15 }}
                        className="rounded-2xl border border-border bg-card p-5"
                    >
                        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
                            <Flame className="h-5 w-5 text-primary" />
                            Top 3 Dishes
                        </h2>
                        <p className="text-sm text-muted-foreground mt-1">Most ordered dishes right now.</p>

                        <div className="mt-4 space-y-2">
                            {topDishes.length > 0 ? topDishes.map((dish, index) => (
                                <div key={`${dish.name}-${index}`} className="flex items-center justify-between rounded-lg border border-border/80 bg-muted/30 px-3 py-3">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="h-8 w-8 rounded-full bg-primary/15 text-primary text-sm font-bold flex items-center justify-center shrink-0">
                                            {index + 1}
                                        </div>
                                        <p className="font-semibold text-foreground truncate">{dish.name}</p>
                                    </div>
                                    <p className="text-xs font-semibold text-muted-foreground shrink-0">
                                        {Number(dish.orders || 0) > 0 ? `${dish.orders} orders` : 'Trending'}
                                    </p>
                                </div>
                            )) : (
                                <p className="text-sm text-muted-foreground">No dish data available yet.</p>
                            )}
                        </div>
                    </motion.section>

                    <motion.section
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="rounded-2xl border border-border bg-card p-5"
                    >
                        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
                            <Sparkles className="h-5 w-5 text-primary" />
                            Cuisine Highlights
                        </h2>
                        <p className="text-sm text-muted-foreground mt-1">Popular menu clusters people are ordering from.</p>
                        <div className="mt-4 flex flex-wrap gap-2">
                            {topCategories.length > 0 ? topCategories.map((category) => (
                                <div
                                    key={category.name}
                                    className="px-3 py-2 rounded-full border border-primary/30 bg-primary/10 text-primary text-sm font-semibold"
                                >
                                    {category.name} ({category.count})
                                </div>
                            )) : (
                                <p className="text-sm text-muted-foreground">Category data not available yet.</p>
                            )}
                        </div>
                    </motion.section>
                </div>
            </div>

            <div className="fixed bottom-20 md:bottom-6 left-4 right-4 z-30">
                <div className="max-w-3xl mx-auto rounded-2xl border border-primary/25 bg-background/90 backdrop-blur-md p-3 shadow-2xl">
                    <div className="flex flex-col sm:flex-row items-center gap-3">
                        <div className="flex-1 w-full">
                            <p className="text-sm text-muted-foreground">Ready to place your order?</p>
                            <p className="font-bold text-foreground">Open full menu and checkout in one tap.</p>
                        </div>
                        <div className="w-full sm:w-auto flex gap-2">
                            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setIsMapOpen(true)}>
                                <MapPin className="mr-2 h-4 w-4" />
                                Map
                            </Button>
                            <Button
                                className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground"
                                onClick={handleOrderNow}
                                disabled={isOrdering}
                            >
                                {isOrdering ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                Order Now
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}

