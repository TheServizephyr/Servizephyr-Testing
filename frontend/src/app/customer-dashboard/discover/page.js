'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
    Loader2,
    MapPin,
    Soup,
    AlertTriangle,
    Navigation,
    LocateFixed,
    ChevronDown,
    ExternalLink,
    X,
    Sparkles,
    Clock3,
    ArrowRight,
} from 'lucide-react';
import { APIProvider, Map, AdvancedMarker } from '@vis.gl/react-google-maps';
import { useUser } from '@/firebase';
import { useRouter } from 'next/navigation';
import InfoDialog from '@/components/InfoDialog';
import { Button } from '@/components/ui/button';

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const DEFAULT_CENTER = { lat: 28.6139, lng: 77.2090 };
const APPROX_ROAD_DISTANCE_FACTOR = 1.3;

const isRestaurantLocation = (location) => {
    const type = String(location?.businessType || '').toLowerCase();
    return type !== 'shop' && type !== 'store';
};

const isValidCoordinatePair = (lat, lng) => (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
);

const haversineDistanceKm = (lat1, lng1, lat2, lng2) => {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const earthRadiusKm = 6371;

    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusKm * c;
};

const formatDistance = (distanceKm) => {
    if (!Number.isFinite(distanceKm)) return null;
    if (distanceKm < 1) return `${Math.round(distanceKm * 1000)} m`;
    return `${distanceKm.toFixed(distanceKm < 10 ? 1 : 0)} km`;
};

const resolveRestaurantCoordinates = (rawLat, rawLng, referenceCenter) => {
    const candidates = [];

    if (isValidCoordinatePair(rawLat, rawLng)) {
        candidates.push({ lat: rawLat, lng: rawLng, swapped: false });
    }
    if (isValidCoordinatePair(rawLng, rawLat)) {
        candidates.push({ lat: rawLng, lng: rawLat, swapped: true });
    }

    if (candidates.length === 0) {
        return { lat: null, lng: null, swapped: false };
    }

    if (!isValidCoordinatePair(referenceCenter?.lat, referenceCenter?.lng)) {
        return candidates[0];
    }

    const scored = candidates.map((candidate) => ({
        ...candidate,
        distance: haversineDistanceKm(
            referenceCenter.lat,
            referenceCenter.lng,
            candidate.lat,
            candidate.lng
        ),
    }));

    scored.sort((a, b) => a.distance - b.distance);
    return scored[0];
};

const RestaurantMapModal = ({ location, userCenter, onClose }) => {
    if (!location) return null;

    const lat = Number(location.lat);
    const lng = Number(location.lng);
    const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lng);
    const googleMapsSearchUrl = hasCoordinates
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`
        : null;

    return (
        <div className="fixed inset-0 z-50 bg-black/80 p-4 flex items-center justify-center">
            <div className="w-full max-w-4xl bg-background border border-border rounded-2xl overflow-hidden shadow-2xl">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-4">
                    <div>
                        <h3 className="text-lg font-bold text-foreground">{location.name}</h3>
                        <p className="text-sm text-muted-foreground">{location.address || 'Address not available'}</p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full border border-border/60">
                        <X className="h-5 w-5" />
                    </Button>
                </div>

                <div className="h-[60vh] bg-muted">
                    {!GOOGLE_MAPS_API_KEY ? (
                        <div className="w-full h-full flex flex-col items-center justify-center text-center p-6 gap-4">
                            <AlertTriangle className="text-destructive h-10 w-10" />
                            <p className="text-muted-foreground">Map key missing. Please configure Google Maps API key.</p>
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
                                mapId="discover_single_restaurant"
                                defaultCenter={hasCoordinates ? { lat, lng } : DEFAULT_CENTER}
                                defaultZoom={15}
                                gestureHandling="greedy"
                                disableDefaultUI={true}
                                style={{ width: '100%', height: '100%' }}
                            >
                                {hasCoordinates ? (
                                    <AdvancedMarker position={{ lat, lng }}>
                                        <div className="w-11 h-11 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg border-2 border-background">
                                            <Soup size={18} />
                                        </div>
                                    </AdvancedMarker>
                                ) : null}

                                {userCenter?.lat && userCenter?.lng ? (
                                    <AdvancedMarker position={userCenter}>
                                        <div className="px-2 py-1 rounded-md bg-blue-600 text-white text-xs font-bold shadow-lg">
                                            You
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

export default function DiscoverPage() {
    const { user } = useUser();
    const router = useRouter();

    const [allLocations, setAllLocations] = useState([]);
    const [center, setCenter] = useState(DEFAULT_CENTER);
    const [hasExactLocation, setHasExactLocation] = useState(false);
    const [locationNotice, setLocationNotice] = useState('');
    const [locationsLoading, setLocationsLoading] = useState(true);
    const [isLocating, setIsLocating] = useState(true);
    const [fetchError, setFetchError] = useState('');

    const [expandedRestaurantId, setExpandedRestaurantId] = useState(null);
    const [mapRestaurant, setMapRestaurant] = useState(null);

    const [isNavigating, setIsNavigating] = useState(false);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    useEffect(() => {
        const fetchLocations = async () => {
            try {
                setLocationsLoading(true);
                const res = await fetch('/api/public/locations', { cache: 'no-store' });
                const data = await res.json();
                if (!res.ok) throw new Error(data.message || 'Failed to fetch locations');
                setAllLocations(Array.isArray(data.locations) ? data.locations : []);
            } catch (err) {
                setFetchError(err.message || 'Could not load nearby restaurants.');
            } finally {
                setLocationsLoading(false);
            }
        };

        fetchLocations();
    }, []);

    useEffect(() => {
        if (!navigator.geolocation) {
            setIsLocating(false);
            setLocationNotice('Live location is not supported by this browser. Showing all restaurants.');
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const currentCenter = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                };
                setCenter(currentCenter);
                setHasExactLocation(true);
                setIsLocating(false);
            },
            () => {
                setIsLocating(false);
                setHasExactLocation(false);
                setLocationNotice('Location permission denied. Showing all restaurants in your city list.');
            },
            {
                enableHighAccuracy: true,
                timeout: 8000,
                maximumAge: 60000,
            }
        );
    }, []);

    const restaurants = useMemo(() => {
        const filtered = allLocations
            .filter(isRestaurantLocation)
            .map((location) => {
                const rawLat = Number(location.lat);
                const rawLng = Number(location.lng);
                const resolvedCoordinates = resolveRestaurantCoordinates(rawLat, rawLng, center);
                const lat = resolvedCoordinates.lat;
                const lng = resolvedCoordinates.lng;
                const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

                const straightLineDistanceKm = (hasExactLocation && hasCoords)
                    ? haversineDistanceKm(center.lat, center.lng, lat, lng)
                    : null;
                const distanceKm = Number.isFinite(straightLineDistanceKm)
                    ? straightLineDistanceKm * APPROX_ROAD_DISTANCE_FACTOR
                    : null;

                return {
                    ...location,
                    lat,
                    lng,
                    distanceKm,
                    distanceLabel: formatDistance(distanceKm),
                    coordinatesAutoCorrected: resolvedCoordinates.swapped,
                };
            });

        if (hasExactLocation) {
            filtered.sort((a, b) => (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY));
        } else {
            filtered.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
        }

        return filtered;
    }, [allLocations, center, hasExactLocation]);

    const handleNavigation = async (restaurantId, intent = 'order_now') => {
        if (!user) {
            setInfoDialog({ isOpen: true, title: 'Authentication Error', message: 'Please log in again to continue.' });
            return;
        }

        setIsNavigating(true);
        try {
            const idToken = await user.getIdToken();
            const res = await fetch('/api/auth/generate-session-token', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${idToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({}),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to create a secure session.');

            const { ref, phone, token } = data;
            const identityParam = ref
                ? `ref=${encodeURIComponent(ref)}`
                : (phone ? `phone=${encodeURIComponent(phone)}` : null);

            if (!identityParam || !token) {
                throw new Error('Session identity could not be generated.');
            }

            const baseUrl = `/order/${restaurantId}?${identityParam}&token=${encodeURIComponent(token)}`;
            const finalUrl = `${baseUrl}&source=discover&intent=${encodeURIComponent(intent)}`;
            router.push(finalUrl);
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Navigation Error', message: error.message || 'Failed to open restaurant.' });
            setIsNavigating(false);
        }
    };

    const toggleRestaurantActions = (restaurantId) => {
        setExpandedRestaurantId((prev) => (prev === restaurantId ? null : restaurantId));
    };

    const handleExploreRestaurant = (restaurant) => {
        if (!restaurant?.id) return;
        const params = new URLSearchParams();
        if (restaurant.distanceLabel) {
            params.set('distance', restaurant.distanceLabel);
        }
        const query = params.toString();
        router.push(`/customer-dashboard/discover/${restaurant.id}${query ? `?${query}` : ''}`);
    };

    return (
        <div className="px-4 py-5 md:px-6 md:py-7 space-y-5">
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />

            {isNavigating ? (
                <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center">
                    <Loader2 className="animate-spin text-white h-12 w-12" />
                </div>
            ) : null}

            <RestaurantMapModal
                location={mapRestaurant}
                userCenter={hasExactLocation ? center : null}
                onClose={() => setMapRestaurant(null)}
            />

            <motion.header
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-br from-primary/15 via-card/80 to-blue-500/10 p-5 md:p-6"
            >
                <div className="absolute -right-10 -top-10 h-44 w-44 rounded-full bg-primary/20 blur-3xl" />
                <div className="relative">
                    <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                        <Sparkles className="h-3.5 w-3.5" />
                        Live Discovery
                    </div>
                    <h1 className="mt-3 font-[family-name:var(--font-customer-display)] text-3xl md:text-4xl font-bold tracking-tight">
                        Discover Restaurants
                    </h1>
                    <p className="mt-2 text-sm md:text-base text-muted-foreground max-w-2xl">
                        {hasExactLocation
                            ? 'Nearby restaurants are ranked using estimated road distance from your location.'
                            : 'Restaurants available in your area. Enable location for better sorting.'}
                    </p>

                    <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                        {isLocating ? (
                            <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3 py-1 text-muted-foreground">
                                <LocateFixed className="h-3.5 w-3.5" />
                                Detecting live location...
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-emerald-300">
                                <Clock3 className="h-3.5 w-3.5" />
                                Updated just now
                            </span>
                        )}
                    </div>
                </div>
            </motion.header>

            {locationNotice ? (
                <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-700 dark:text-yellow-300">
                    {locationNotice}
                </div>
            ) : null}

            {locationsLoading ? (
                <div className="min-h-[44vh] flex flex-col items-center justify-center gap-3 text-muted-foreground rounded-3xl border border-border/70 bg-card/40">
                    <Loader2 className="animate-spin h-10 w-10 text-primary" />
                    <p>Loading nearby restaurants...</p>
                </div>
            ) : fetchError ? (
                <div className="min-h-[44vh] flex flex-col items-center justify-center gap-3 text-center p-4 rounded-3xl border border-destructive/30 bg-destructive/5">
                    <AlertTriangle className="text-destructive h-10 w-10" />
                    <p className="text-destructive font-semibold">{fetchError}</p>
                </div>
            ) : restaurants.length === 0 ? (
                <div className="min-h-[44vh] flex flex-col items-center justify-center gap-2 text-center text-muted-foreground border border-dashed border-border rounded-3xl p-6 bg-card/30">
                    <Soup className="h-10 w-10" />
                    <p className="font-semibold">No restaurants found in this area yet.</p>
                    <p className="text-sm">Try again in a few minutes.</p>
                </div>
            ) : (
                <div className="space-y-3 pb-4">
                    {restaurants.map((restaurant, index) => {
                        const isExpanded = expandedRestaurantId === restaurant.id;

                        return (
                            <motion.div
                                key={restaurant.id}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.03 }}
                                className="rounded-2xl border border-border/70 bg-card/65 p-4 shadow-[0_20px_40px_-32px_rgba(2,6,23,0.9)]"
                            >
                                <div
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => toggleRestaurantActions(restaurant.id)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                            event.preventDefault();
                                            toggleRestaurantActions(restaurant.id);
                                        }
                                    }}
                                    className="cursor-pointer"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <h3 className="text-lg font-bold text-foreground truncate">{restaurant.name}</h3>
                                            <p className="text-sm text-muted-foreground flex items-start gap-2 mt-1">
                                                <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0" />
                                                <span className="line-clamp-2">{restaurant.address || 'Address not available'}</span>
                                            </p>
                                        </div>

                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            {restaurant.distanceLabel ? (
                                                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-primary/15 text-primary border border-primary/25">
                                                    {restaurant.distanceLabel}
                                                </span>
                                            ) : null}
                                            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                        </div>
                                    </div>
                                </div>

                                {isExpanded ? (
                                    <div className="mt-4 pt-4 border-t border-dashed border-border flex flex-wrap gap-2">
                                        <Button
                                            variant="outline"
                                            className="rounded-xl"
                                            onClick={() => handleExploreRestaurant(restaurant)}
                                            disabled={isNavigating}
                                        >
                                            Explore Restaurant
                                        </Button>
                                        <Button
                                            onClick={() => handleNavigation(restaurant.id, 'order_now')}
                                            disabled={isNavigating}
                                            className="rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground"
                                        >
                                            {isNavigating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                                            Order Now
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            className="rounded-xl"
                                            onClick={() => setMapRestaurant(restaurant)}
                                        >
                                            <Navigation className="mr-2 h-4 w-4" />
                                            View in Map
                                        </Button>
                                    </div>
                                ) : null}
                            </motion.div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
