
import { NextResponse } from 'next/server';

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

export async function GET(req) {
     if (!GOOGLE_MAPS_API_KEY) {
        console.error("[API search] Google Maps API Key is not configured for the backend.");
        return NextResponse.json({ message: "Search service is not configured on the server." }, { status: 500 });
    }

    console.log("[API search] Request received for location search via Google Maps Places API.");
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('query');

    if (!query) {
        return NextResponse.json({ message: "Search query is required." }, { status: 400 });
    }

    const trimmedQuery = String(query || '').trim();
    // Using the Places API Autocomplete
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(trimmedQuery)}&key=${GOOGLE_MAPS_API_KEY}&components=country:in`;
    console.log(`[API search] Calling Google Maps Places Autocomplete API.`);

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
            const errorMessage = data.error_message || `Google Maps returned status ${data.status}`;
            console.error(`[API search] Google Maps API error:`, errorMessage);
            return NextResponse.json({ message: errorMessage }, { status: response.status });
        }

        const firstPredictionDescription = data?.predictions?.[0]?.description || '';

        // We need another call to get lat/lng for each prediction
        const suggestedLocationsPromises = (data.predictions || []).map(async (prediction) => {
            const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${prediction.place_id}&fields=geometry,name,formatted_address&key=${GOOGLE_MAPS_API_KEY}`;
            const detailsRes = await fetch(detailsUrl);
            const detailsData = await detailsRes.json();
            
            if (detailsData.status === 'OK') {
                return {
                    placeName: prediction.structured_formatting.main_text,
                    placeAddress: prediction.structured_formatting.secondary_text,
                    latitude: detailsData.result.geometry.location.lat,
                    longitude: detailsData.result.geometry.location.lng,
                    eLoc: prediction.place_id
                };
            }
            return null;
        });

        let suggestedLocations = (await Promise.all(suggestedLocationsPromises)).filter(Boolean);

        // Fallback: if autocomplete returns no predictions, try direct geocoding on full query.
        if (suggestedLocations.length === 0 && trimmedQuery) {
            try {
                const geocodeInput = firstPredictionDescription || trimmedQuery;
                const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(geocodeInput)}&region=in&key=${GOOGLE_MAPS_API_KEY}`;
                const geocodeRes = await fetch(geocodeUrl);
                const geocodeData = await geocodeRes.json();

                if (geocodeData.status === 'OK' && Array.isArray(geocodeData.results) && geocodeData.results.length > 0) {
                    const first = geocodeData.results[0];
                    const lat = first?.geometry?.location?.lat;
                    const lng = first?.geometry?.location?.lng;

                    if (typeof lat === 'number' && typeof lng === 'number') {
                        suggestedLocations = [{
                            placeName: first.formatted_address?.split(',')?.[0] || trimmedQuery,
                            placeAddress: first.formatted_address || trimmedQuery,
                            latitude: lat,
                            longitude: lng,
                            eLoc: `geocode_${lat}_${lng}`
                        }];
                    }
                }
            } catch (geocodeErr) {
                console.warn('[API search] Geocode fallback failed:', geocodeErr?.message || geocodeErr);
            }
        }
        
        console.log("[API search] Google Maps response successful, transformed to expected format.");
        return NextResponse.json(suggestedLocations, { status: 200 });

    } catch (error) {
        console.error(`[API search] CRITICAL Error calling Google Maps API: ${error.message}`);
        return NextResponse.json({ message: "Failed to fetch search results from geocoding service.", error: error.message }, { status: 500 });
    }
}
