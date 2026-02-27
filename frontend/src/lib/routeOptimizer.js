/**
 * Route Optimizer - Travelling Salesman Problem (TSP) Solver
 * Optimizes delivery routes to minimize total distance and save rider fuel costs
 * Performance: < 60ms for up to 9 deliveries
 */

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param {number} lat1 - Latitude of point 1
 * @param {number} lon1 - Longitude of point 1
 * @param {number} lat2 - Latitude of point 2
 * @param {number} lon2 - Longitude of point 2
 * @returns {number} Distance in kilometers
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Generate all permutations of an array
 * @param {Array} arr - Array to permute
 * @returns {Array} Array of all permutations
 */
function generatePermutations(arr) {
    if (arr.length === 0) return [[]];
    if (arr.length === 1) return [arr];

    const result = [];
    for (let i = 0; i < arr.length; i++) {
        const current = arr[i];
        const remaining = arr.slice(0, i).concat(arr.slice(i + 1));
        const remainingPerms = generatePermutations(remaining);

        for (const perm of remainingPerms) {
            result.push([current, ...perm]);
        }
    }
    return result;
}

/**
 * Build distance matrix for all locations (Cache distances)
 * @param {Object} restaurant - Restaurant location {lat, lng}
 * @param {Array} customers - Array of customer locations [{lat, lng, orderId, ...}]
 * @returns {Object} Distance matrix and location map
 */
function buildDistanceMatrix(restaurant, customers) {
    const locations = [restaurant, ...customers];
    const n = locations.length;
    const distanceMatrix = Array(n).fill(null).map(() => Array(n).fill(0));

    // Calculate distances between all pairs
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const dist = haversineDistance(
                locations[i].lat,
                locations[i].lng,
                locations[j].lat,
                locations[j].lng
            );
            distanceMatrix[i][j] = dist;
            distanceMatrix[j][i] = dist;
        }
    }

    return { distanceMatrix, locations };
}

/**
 * Calculate total distance for a given route
 * @param {Array} route - Array of location indices
 * @param {Array} distanceMatrix - Precomputed distance matrix
 * @param {boolean} returnToOrigin - Whether to return to starting point
 * @returns {number} Total distance in km
 */
function calculateRouteDistance(route, distanceMatrix, returnToOrigin = true) {
    let totalDistance = 0;

    // Distance from origin (0 = restaurant) to first customer
    totalDistance += distanceMatrix[0][route[0]];

    // Distances between consecutive customers
    for (let i = 0; i < route.length - 1; i++) {
        totalDistance += distanceMatrix[route[i]][route[i + 1]];
    }

    // Distance from last customer back to restaurant
    if (returnToOrigin) {
        totalDistance += distanceMatrix[route[route.length - 1]][0];
    }

    return totalDistance;
}

/**
 * Find the optimal delivery route using TSP brute-force
 * @param {Object} restaurant - Restaurant location {lat, lng}
 * @param {Array} customers - Array of customer orders with locations
 * @param {Object} options - Optional settings
 * @returns {Object} Optimized route with details
 */
export function optimizeDeliveryRoute(restaurant, customers, options = {}) {
    const startTime = Date.now();

    // Validate inputs
    if (!restaurant || !restaurant.lat || !restaurant.lng) {
        throw new Error('Invalid restaurant location');
    }
    if (!customers || customers.length === 0) {
        throw new Error('No customers to optimize');
    }
    if (customers.length > 9) {
        console.warn('⚠️ More than 9 deliveries - using greedy approximation instead of exact TSP');
        return greedyRouteOptimization(restaurant, customers);
    }

    // Build distance matrix (cache all distances)
    const { distanceMatrix, locations } = buildDistanceMatrix(restaurant, customers);

    // Generate all permutations of customer indices (1 to n, excluding 0 which is restaurant)
    const customerIndices = customers.map((_, i) => i + 1);
    const allPermutations = generatePermutations(customerIndices);

    let bestRoute = null;
    let bestDistance = Infinity;

    // Find the route with minimum total distance
    for (const route of allPermutations) {
        const distance = calculateRouteDistance(route, distanceMatrix, options.returnToOrigin !== false);

        if (distance < bestDistance) {
            bestDistance = distance;
            bestRoute = route;
        }
    }

    // Map indices back to customer objects
    const optimizedSequence = bestRoute.map(idx => customers[idx - 1]);

    const computationTime = Date.now() - startTime;

    return {
        success: true,
        optimizedRoute: optimizedSequence,
        totalDistance: bestDistance,
        computationTime,
        metrics: {
            restaurantLocation: restaurant,
            deliveryCount: customers.length,
            permutationsEvaluated: allPermutations.length,
            distanceSaved: calculateDistanceSaved(customers, optimizedSequence, distanceMatrix)
        }
    };
}

/**
 * Calculate distance saved by optimization (vs simple sequential order)
 */
function calculateDistanceSaved(originalOrder, optimizedOrder, distanceMatrix) {
    const originalIndices = originalOrder.map((_, i) => i + 1);
    const optimizedIndices = optimizedOrder.map(order => originalOrder.indexOf(order) + 1);

    const originalDistance = calculateRouteDistance(originalIndices, distanceMatrix);
    const optimizedDistance = calculateRouteDistance(optimizedIndices, distanceMatrix);

    return originalDistance - optimizedDistance;
}

/**
 * Greedy approximation for > 9 deliveries (Nearest Neighbor algorithm)
 * Fast but not guaranteed optimal
 */
function greedyRouteOptimization(restaurant, customers) {
    const startTime = Date.now();
    const visitedSet = new Set();
    const route = [];
    let currentLocation = restaurant;
    let totalDistance = 0;

    // Start from restaurant, always go to nearest unvisited customer
    while (route.length < customers.length) {
        let nearestCustomer = null;
        let nearestDistance = Infinity;
        let nearestIndex = -1;

        customers.forEach((customer, index) => {
            if (!visitedSet.has(index)) {
                const dist = haversineDistance(
                    currentLocation.lat,
                    currentLocation.lng,
                    customer.lat,
                    customer.lng
                );

                if (dist < nearestDistance) {
                    nearestDistance = dist;
                    nearestCustomer = customer;
                    nearestIndex = index;
                }
            }
        });

        if (nearestCustomer) {
            route.push(nearestCustomer);
            visitedSet.add(nearestIndex);
            totalDistance += nearestDistance;
            currentLocation = {
                lat: nearestCustomer.lat,
                lng: nearestCustomer.lng
            };
        }
    }

    // Return to restaurant
    totalDistance += haversineDistance(
        currentLocation.lat,
        currentLocation.lng,
        restaurant.lat,
        restaurant.lng
    );

    return {
        success: true,
        optimizedRoute: route,
        totalDistance,
        computationTime: Date.now() - startTime,
        method: 'greedy',
        metrics: {
            restaurantLocation: restaurant,
            deliveryCount: customers.length,
            note: 'Used greedy approximation for > 9 deliveries'
        }
    };
}

/**
 * Helper to format route for Google Maps waypoints (ROUND TRIP)
 * Uses COORDINATES ONLY for 100% reliability (no address parsing issues!)
 * @param {Array} optimizedRoute - Array of orders in optimal sequence
 * @param {Object} restaurantLocation - Restaurant coordinates {lat, lng}
 * @returns {string} Google Maps URL with coordinate-based navigation
 */
export function formatRouteForGoogleMaps(optimizedRoute, restaurantLocation = null) {
    if (!optimizedRoute || optimizedRoute.length === 0) return '';

    const allCustomers = optimizedRoute;

    let url = `https://www.google.com/maps/dir/?api=1&travelmode=driving`;

    // ✅ COORDINATES ONLY - No spelling/parsing issues!
    if (allCustomers.length > 0) {
        const waypointStr = allCustomers
            .map(order => `${order.lat},${order.lng}`)
            .join('|');

        url += `&waypoints=${waypointStr}`;
    }

    // Add restaurant as final destination (ROUND TRIP!)
    console.log('[formatRouteForGoogleMaps] Restaurant location param:', restaurantLocation);

    if (restaurantLocation && restaurantLocation.lat && restaurantLocation.lng) {
        console.log('[formatRouteForGoogleMaps] Adding restaurant as destination (coordinates only)');
        url += `&destination=${restaurantLocation.lat},${restaurantLocation.lng}`;
    } else {
        console.warn('[formatRouteForGoogleMaps] No restaurant! Using last customer');
        const lastCustomer = allCustomers[allCustomers.length - 1];
        url += `&destination=${lastCustomer.lat},${lastCustomer.lng}`;
    }

    console.log('[formatRouteForGoogleMaps] Final URL:', url);
    return url;
}

/**
 * Example usage:
 * 
 * const restaurant = { lat: 28.6139, lng: 77.2090 };
 * const orders = [
 *   { orderId: '1', customerLocation: { _latitude: 28.6200, _longitude: 77.2150 }, ... },
 *   { orderId: '2', customerLocation: { _latitude: 28.6100, _longitude: 77.2050 }, ... },
 *   { orderId: '3', customerLocation: { _latitude: 28.6250, _longitude: 77.2200 }, ... }
 * ];
 * 
 * const result = optimizeDeliveryRoute(restaurant, orders);
 * console.log('Optimal sequence:', result.optimizedRoute);
 * console.log('Total distance:', result.totalDistance, 'km');
 * console.log('Computation time:', result.computationTime, 'ms');
 * 
 * // Generate Google Maps URL
 * const mapsUrl = formatRouteForGoogleMaps(result.optimizedRoute);
 */
