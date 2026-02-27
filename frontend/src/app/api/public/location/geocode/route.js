
import { NextResponse } from 'next/server';

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

export async function GET(req) {
    if (!GOOGLE_MAPS_API_KEY) {
        console.error("[API geocode] Google Maps API Key is not configured for the backend.");
        return NextResponse.json({ message: "Geocoding service is not configured on the server." }, { status: 500 });
    }

    console.log("[API geocode] Request received for Reverse Geocoding via Google Maps.");
    const { searchParams } = new URL(req.url);
    const lat = searchParams.get('lat');
    const lng = searchParams.get('lng');

    if (!lat || !lng) {
        return NextResponse.json({ message: "Latitude and longitude are required." }, { status: 400 });
    }

    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`;
    console.log(`[API geocode] Calling Google Maps Geocode API.`);

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.status === 'OK' && data.results && data.results.length > 0) {
            const addr = data.results[0];
            const components = addr.address_components;
            
            const getComponent = (type, preferShort = false) => {
                const component = components.find(c => c.types.includes(type));
                if (!component) return '';
                return preferShort ? component.short_name : component.long_name;
            };

            const result = {
                street: getComponent('route') || getComponent('sublocality_level_1') || '',
                city: getComponent('locality') || getComponent('administrative_area_level_2'),
                state: getComponent('administrative_area_level_1'),
                pincode: getComponent('postal_code'),
                country: getComponent('country', true),
                formatted_address: addr.formatted_address || 'Address not found'
            };
            console.log("[API geocode] Google Maps response successful:", result.formatted_address);
            return NextResponse.json(result, { status: 200 });
        } else {
            const errorMessage = data.error_message || `Google Maps returned status ${data.status}`;
            console.warn(`[API geocode] Google Maps API returned an error:`, errorMessage);
            return NextResponse.json({ message: errorMessage }, { status: response.status });
        }
    } catch (error) {
        console.error(`[API geocode] CRITICAL Error calling Google Maps API:`, error);
        return NextResponse.json({ message: "Failed to fetch address from geocoding service.", error: error.message }, { status: 500 });
    }
}
