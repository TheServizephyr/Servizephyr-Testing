'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { APIProvider, Map, AdvancedMarker, useMap } from '@vis.gl/react-google-maps';

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

const MapComponent = ({ restaurantLocation, customerLocations, riderLocation, onMapLoad }) => {
    const map = useMap();
    const routeLinesRef = useRef([]);

    const toLatLngLiteral = (loc) => {
        if (!loc) return null;
        const lat = loc.lat ?? loc.latitude ?? loc._latitude;
        const lng = loc.lng ?? loc.longitude ?? loc._longitude;

        if (typeof lat === 'number' && typeof lng === 'number') {
            return { lat, lng };
        }
        return null;
    };

    const restaurantLatLng = useMemo(() => toLatLngLiteral(restaurantLocation), [restaurantLocation]);
    const riderLatLng = useMemo(() => toLatLngLiteral(riderLocation), [riderLocation]);
    const customerLatLngs = useMemo(() =>
        (customerLocations || [])
            .map(loc => ({ ...toLatLngLiteral(loc), id: loc.id }))
            .filter(loc => typeof loc.lat === 'number' && typeof loc.lng === 'number'),
        [customerLocations]
    );

    const getCurvedPath = (start, end, curveIntensity = 0.32, points = 24) => {
        const dx = end.lng - start.lng;
        const dy = end.lat - start.lat;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (!distance) return [start, end];

        // Perpendicular offset for a smooth arc
        const nx = -dy / distance;
        const ny = dx / distance;
        const offset = distance * curveIntensity;

        // Use opposite bend direction for the arc
        const control = {
            lat: (start.lat + end.lat) / 2 - ny * offset,
            lng: (start.lng + end.lng) / 2 - nx * offset,
        };

        const path = [];
        for (let i = 0; i <= points; i++) {
            const t = i / points;
            // Quadratic Bezier interpolation
            const oneMinusT = 1 - t;
            path.push({
                lat: oneMinusT * oneMinusT * start.lat + 2 * oneMinusT * t * control.lat + t * t * end.lat,
                lng: oneMinusT * oneMinusT * start.lng + 2 * oneMinusT * t * control.lng + t * t * end.lng,
            });
        }
        return path;
    };

    // Auto-fit bounds to show all markers
    useEffect(() => {
        if (map && window.google) {
            const bounds = new window.google.maps.LatLngBounds();
            let extendCount = 0;
            if (restaurantLatLng) { bounds.extend(restaurantLatLng); extendCount++; }
            if (riderLatLng) { bounds.extend(riderLatLng); extendCount++; }
            customerLatLngs.forEach(loc => { bounds.extend(loc); extendCount++; });

            if (extendCount > 1) {
                map.fitBounds(bounds, 80);
            } else if (extendCount === 1) {
                map.setCenter(bounds.getCenter());
                map.setZoom(15);
            }
        }
    }, [restaurantLatLng, customerLatLngs, riderLatLng, map]);

    // Draw curved dashed connector between restaurant and customer points
    useEffect(() => {
        if (!map || !window.google) return;

        // Clear previous lines
        routeLinesRef.current.forEach(line => line.setMap(null));
        routeLinesRef.current = [];

        if (!restaurantLatLng || customerLatLngs.length === 0) return;

        const dashSymbol = {
            path: 'M 0,-1 0,1',
            strokeOpacity: 1,
            scale: 3,
        };

        customerLatLngs.forEach((customerPoint) => {
            const path = getCurvedPath(restaurantLatLng, customerPoint);
            const connector = new window.google.maps.Polyline({
                path,
                geodesic: false,
                strokeColor: '#111111',
                strokeOpacity: 0,
                strokeWeight: 3,
                icons: [{
                    icon: dashSymbol,
                    offset: '0',
                    repeat: '14px',
                }],
                zIndex: 1,
            });

            connector.setMap(map);
            routeLinesRef.current.push(connector);
        });

        return () => {
            routeLinesRef.current.forEach(line => line.setMap(null));
            routeLinesRef.current = [];
        };
    }, [map, restaurantLatLng, customerLatLngs]);

    useEffect(() => {
        if (map && onMapLoad) {
            onMapLoad(map);
        }
    }, [map, onMapLoad]);

    const markerContainerStyle = {
        backgroundColor: 'white',
        borderRadius: '50%',
        padding: '8px',
        boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '40px',
        height: '40px',
        fontSize: '1.5rem',
        border: '2px solid white'
    };

    return (
        <>
            {restaurantLatLng && (
                <AdvancedMarker position={restaurantLatLng} title="Restaurant">
                    <div style={markerContainerStyle}>
                        🍴
                    </div>
                </AdvancedMarker>
            )}
            {customerLatLngs.map(loc => (
                <AdvancedMarker key={loc.id} position={loc} title="Customer">
                    <div style={markerContainerStyle}>
                    🤵
                </div>
            </AdvancedMarker>
        ))}
            {riderLatLng && (
                <AdvancedMarker position={riderLatLng} title="Delivery Partner">
                    <div style={{ fontSize: '2.5rem' }}>🛵</div>
                </AdvancedMarker>
            )}
        </>
    );
}

const LiveTrackingMap = (props) => {
    const { restaurantLocation, riderLocation, customerLocation, mapRef, isInteractive = true } = props; // Default to true if not provided

    if (!GOOGLE_MAPS_API_KEY) {
        return <div className="w-full h-full bg-muted flex items-center justify-center"><p className="text-destructive">Google Maps API Key not found.</p></div>;
    }

    const getCenter = () => {
        const riderLat = riderLocation?.lat ?? riderLocation?.latitude ?? riderLocation?._latitude;
        const riderLng = riderLocation?.lng ?? riderLocation?.longitude ?? riderLocation?._longitude;
        if (riderLat && riderLng) return { lat: riderLat, lng: riderLng };

        const restoLat = restaurantLocation?.lat ?? restaurantLocation?.latitude ?? restaurantLocation?._latitude;
        const restoLng = restaurantLocation?.lng ?? restaurantLocation?.longitude ?? restaurantLocation?._longitude;
        if (restoLat && restoLng) return { lat: restoLat, lng: restoLng };

        const firstCustomer = Array.isArray(props.customerLocations) && props.customerLocations[0] ? props.customerLocations[0] : customerLocation;
        const custLat = firstCustomer?.lat ?? firstCustomer?.latitude ?? firstCustomer?._latitude;
        const custLng = firstCustomer?.lng ?? firstCustomer?.longitude ?? firstCustomer?._longitude;
        if (custLat && custLng) return { lat: custLat, lng: custLng };

        return { lat: 28.6139, lng: 77.2090 };
    }

    const center = getCenter();

    const handleMapLoad = (mapInstance) => {
        if (mapRef) {
            mapRef.current = mapInstance;
        }
    };

    return (
        <APIProvider apiKey={GOOGLE_MAPS_API_KEY} libraries={['marker']}>
            <Map
                mapId={'live_tracking_map'}
                style={{ width: '100%', height: '100%' }}
                defaultCenter={center}
                defaultZoom={12}
                gestureHandling={isInteractive ? 'greedy' : 'none'} // Disable gestures if not interactive to allow page scroll
                disableDefaultUI={!isInteractive} // Hide controls if not interactive
                options={{
                    zoomControl: isInteractive, // Only show zoom if interactive
                    streetViewControl: false,
                    mapTypeControl: false,
                    fullscreenControl: false,
                }}
            >
                <MapComponent
                    restaurantLocation={restaurantLocation}
                    customerLocations={Array.isArray(props.customerLocations) ? props.customerLocations : (customerLocation ? [customerLocation] : [])}
                    riderLocation={riderLocation}
                    onMapLoad={handleMapLoad}
                />
            </Map>
        </APIProvider>
    );
};

export default LiveTrackingMap;
