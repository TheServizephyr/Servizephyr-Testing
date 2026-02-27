import { optimizeDeliveryRoute, formatRouteForGoogleMaps } from '@/lib/routeOptimizer';
import { getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';
import { findBusinessById } from '@/services/business/businessService';

export const dynamic = 'force-dynamic';

/**
 * POST /api/rider/optimize-route
 * Optimize delivery route for multiple orders assigned to a rider
 */
export async function POST(request) {
    try {
        // Verify rider authentication
        const riderId = await verifyAndGetUid(request);
        const db = await getFirestore();
        const body = await request.json();
        const { orderIds, restaurantId } = body;

        console.log('[Route Optimizer] Request received:', { riderId, orderCount: orderIds?.length, restaurantId });

        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            console.error('[Route Optimizer] Invalid orderIds:', orderIds);
            return Response.json({ error: 'Order IDs required' }, { status: 400 });
        }

        if (!restaurantId) {
            console.error('[Route Optimizer] Missing restaurantId');
            return Response.json({ error: 'Restaurant ID required' }, { status: 400 });
        }

        if (orderIds.length > 9) {
            console.warn(`[Route Optimizer] ${orderIds.length} orders - using greedy approximation`);
        }

        // Fetch business location (restaurant/shop/street-vendor)
        const business = await findBusinessById(db, restaurantId);
        if (!business) {
            console.error('[Route Optimizer] Business not found:', restaurantId);
            return Response.json({ error: 'Business not found' }, { status: 404 });
        }

        const restaurantData = business.data || {};
        console.log('[Route Optimizer] Restaurant data keys:', Object.keys(restaurantData));
        console.log('[Route Optimizer] Restaurant location field:', restaurantData.location);
        console.log('[Route Optimizer] Restaurant address field:', restaurantData.address);
        console.log('[Route Optimizer] Restaurant restaurantLocation field:', restaurantData.restaurantLocation);

        // Try multiple possible location fields
        let restaurantLocation = { lat: null, lng: null };

        // Option 1: location field (GeoPoint)
        if (restaurantData.location) {
            restaurantLocation.lat = restaurantData.location._latitude || restaurantData.location.latitude || restaurantData.location.lat;
            restaurantLocation.lng = restaurantData.location._longitude || restaurantData.location.longitude || restaurantData.location.lng;
        }

        // Option 2: address.latitude/longitude
        if (!restaurantLocation.lat && restaurantData.address) {
            restaurantLocation.lat = restaurantData.address.latitude || restaurantData.address.lat || restaurantData.address._latitude;
            restaurantLocation.lng = restaurantData.address.longitude || restaurantData.address.lng || restaurantData.address._longitude;
        }

        // Option 3: restaurantLocation field
        if (!restaurantLocation.lat && restaurantData.restaurantLocation) {
            restaurantLocation.lat = restaurantData.restaurantLocation._latitude || restaurantData.restaurantLocation.latitude || restaurantData.restaurantLocation.lat;
            restaurantLocation.lng = restaurantData.restaurantLocation._longitude || restaurantData.restaurantLocation.longitude || restaurantData.restaurantLocation.lng;
        }

        // Option 4: coordinates field
        if (!restaurantLocation.lat && restaurantData.coordinates) {
            restaurantLocation.lat = restaurantData.coordinates._latitude || restaurantData.coordinates.latitude || restaurantData.coordinates.lat;
            restaurantLocation.lng = restaurantData.coordinates._longitude || restaurantData.coordinates.longitude || restaurantData.coordinates.lng;
        }

        console.log('[Route Optimizer] Extracted restaurant location:', restaurantLocation);

        // Extract restaurant FULL ADDRESS for Google Maps (CRITICAL for auto-resolution!)
        // Priority: Full address > Street address > Restaurant name (last resort)
        if (typeof restaurantData.address === 'object' && restaurantData.address.full) {
            // Best option: Use full formatted address
            restaurantLocation.address = restaurantData.address.full;
        } else if (typeof restaurantData.address === 'string') {
            // Fallback: Plain address string
            restaurantLocation.address = restaurantData.address;
        } else if (restaurantData.restaurantName) {
            // Last resort: Restaurant name + coordinates (Google might still struggle)
            restaurantLocation.address = restaurantData.restaurantName;
        } else if (restaurantData.name) {
            restaurantLocation.address = restaurantData.name;
        }

        console.log('[Route Optimizer] Restaurant address for Maps:', restaurantLocation.address);

        if (!restaurantLocation.lat || !restaurantLocation.lng) {
            console.error('[Route Optimizer] Could not extract restaurant coordinates:', {
                lat: restaurantLocation.lat,
                lng: restaurantLocation.lng,
                availableFields: Object.keys(restaurantData)
            });
            return Response.json({
                error: 'Restaurant location not configured. Please add restaurant address in settings.'
            }, { status: 400 });
        }

        // Fetch all orders
        const ordersPromises = orderIds.map(orderId =>
            db.collection('orders').doc(orderId).get()
        );
        const orderDocs = await Promise.all(ordersPromises);

        const orders = orderDocs
            .filter(doc => doc.exists)
            .map(doc => {
                const data = doc.data();

                // Extract coordinates from various possible fields
                let lat, lng;

                // Try customerLocation first
                if (data.customerLocation) {
                    lat = data.customerLocation._latitude || data.customerLocation.latitude || data.customerLocation.lat;
                    lng = data.customerLocation._longitude || data.customerLocation.longitude || data.customerLocation.lng;
                }

                // Fallback to deliveryLocation
                if (!lat && data.deliveryLocation) {
                    lat = data.deliveryLocation._latitude || data.deliveryLocation.latitude;
                    lng = data.deliveryLocation._longitude || data.deliveryLocation.longitude;
                }

                // Fallback to address.coordinates
                if (!lat && data.address?.coordinates) {
                    lat = data.address.coordinates._latitude || data.address.coordinates.latitude;
                    lng = data.address.coordinates._longitude || data.address.coordinates.longitude;
                }

                return {
                    orderId: doc.id,
                    ...data,
                    // Add flat lat/lng for optimizer
                    lat: parseFloat(lat),
                    lng: parseFloat(lng)
                };
            })
            .filter(order => !isNaN(order.lat) && !isNaN(order.lng)); // Filter out orders with invalid coordinates

        console.log('[Route Optimizer] Orders fetched:', orders.length);
        console.log('[Route Optimizer] Sample order coords:', orders[0] ? { lat: orders[0].lat, lng: orders[0].lng } : 'none');

        if (orders.length === 0) {
            console.error('[Route Optimizer] No valid orders found for IDs:', orderIds);
            return Response.json({ error: 'No valid orders found' }, { status: 404 });
        }

        // Optimize route
        const optimizationResult = optimizeDeliveryRoute(restaurantLocation, orders);

        // Generate Google Maps URL with optimized waypoints (ROUND TRIP - includes restaurant at end)
        console.log('[Route Optimizer] Passing restaurant to Maps formatter:', restaurantLocation);
        const googleMapsUrl = formatRouteForGoogleMaps(optimizationResult.optimizedRoute, restaurantLocation);
        console.log('[Route Optimizer] Generated Maps URL:', googleMapsUrl);

        // Log optimization for analytics
        console.log(`[Route Optimizer] SUCCESS for Rider ${riderId}:`, {
            deliveries: orders.length,
            totalDistance: optimizationResult.totalDistance.toFixed(2) + ' km',
            distanceSaved: optimizationResult.metrics.distanceSaved?.toFixed(2) + ' km',
            computationTime: optimizationResult.computationTime + 'ms'
        });

        return Response.json({
            success: true,
            optimizedRoute: optimizationResult.optimizedRoute.map((order, index) => ({
                sequence: index + 1,
                orderId: order.orderId,
                customerName: order.customerName,
                customerAddress: order.customerAddress,
                customerLocation: order.customerLocation,
                totalAmount: order.totalAmount,
                paymentMethod: order.paymentMethod,
                deliveryPriority: order.deliveryPriority
            })),
            metrics: {
                totalDistance: optimizationResult.totalDistance,
                distanceSaved: optimizationResult.metrics.distanceSaved,
                deliveryCount: orders.length,
                computationTime: optimizationResult.computationTime,
                fuelSavings: calculateFuelSavings(optimizationResult.metrics.distanceSaved)
            },
            googleMapsUrl,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('[Route Optimizer] FATAL ERROR:', error);
        console.error('[Route Optimizer] Error stack:', error.stack);

        // Handle specific auth errors
        if (error.status === 401 || error.code === 'auth/id-token-expired') {
            return Response.json(
                { error: 'Authentication failed', message: error.message || 'Please login again' },
                { status: 401 }
            );
        }

        return Response.json(
            { error: 'Failed to optimize route', message: error.message, details: error.toString() },
            { status: 500 }
        );
    }
}

/**
 * Calculate estimated fuel savings based on distance saved
 * Assumptions: Average bike mileage = 40 km/L, Petrol price = ₹100/L
 */
function calculateFuelSavings(distanceSavedKm) {
    if (!distanceSavedKm || distanceSavedKm <= 0) return 0;

    const MILEAGE_KM_PER_LITER = 40;
    const PETROL_PRICE_PER_LITER = 100;

    const fuelSavedLiters = distanceSavedKm / MILEAGE_KM_PER_LITER;
    const moneySaved = fuelSavedLiters * PETROL_PRICE_PER_LITER;

    return {
        distanceKm: parseFloat(distanceSavedKm.toFixed(2)),
        fuelLiters: parseFloat(fuelSavedLiters.toFixed(3)),
        moneyRupees: parseFloat(moneySaved.toFixed(2))
    };
}
