
"use client";

import React from 'react';
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';

// FIX: Default icon issue with Webpack
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});


export default function DeliveryMap({ boys, restaurantLocation, trackedBoyId }) {
    if (typeof window === 'undefined') {
        return <div className="w-full h-full bg-gray-700 flex items-center justify-center text-gray-400"><p>Loading map...</p></div>;
    }
    
    const center = restaurantLocation ? [restaurantLocation.lat, restaurantLocation.lng] : [28.6139, 77.2090]; // Default to Delhi

    return (
        <MapContainer center={center} zoom={12} style={{ height: '100%', width: '100%' }}>
            <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            />
            {restaurantLocation && (
                <Marker position={[restaurantLocation.lat, restaurantLocation.lng]}>
                    <Popup>Your Restaurant</Popup>
                </Marker>
            )}
            {boys && boys.map(boy => {
                if (boy.location) {
                    return (
                        <Marker key={boy.id} position={[boy.location.lat, boy.location.lng]}>
                            <Popup>{boy.name} - {boy.status}</Popup>
                        </Marker>
                    );
                }
                return null;
            })}
        </MapContainer>
    );
}
