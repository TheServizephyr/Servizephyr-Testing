
'use client';

import React from 'react';
import { APIProvider, Map, AdvancedMarker } from '@vis.gl/react-google-maps';
import { Loader2 } from 'lucide-react';

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

const GoogleMap = ({ center, onPinDragEnd }) => {
    if (!GOOGLE_MAPS_API_KEY) {
        return <div className="w-full h-full bg-muted flex items-center justify-center"><p className="text-destructive">Google Maps API Key not found.</p></div>;
    }

    return (
        <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
            <Map
                mapId="servizephyr_map"
                style={{ width: '100%', height: '100%' }}
                defaultCenter={center}
                center={center}
                defaultZoom={15}
                gestureHandling={'greedy'}
                disableDefaultUI={true}
                draggable={true}
                zoomable={true}
            >
                <AdvancedMarker 
                    position={center}
                    draggable={true}
                    onDragEnd={(e) => onPinDragEnd(e.latLng.toJSON())}
                >
                    <div style={{ fontSize: '2.5rem' }}>📍</div>
                </AdvancedMarker>
            </Map>
        </APIProvider>
    );
};

export default GoogleMap;
